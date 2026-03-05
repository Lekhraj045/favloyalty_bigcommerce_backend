// queues/eventQueue.js
const { Agenda } = require("@hokify/agenda");
const mongoose = require("mongoose");

// Import required models and modules
const CollectSettings = require("../models/CollectSettings");
const Customer = require("../models/Customer");
const Transaction = require("../models/Transaction");
const Point = require("../models/Point");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const { sendFestivalEmail, getExpiryDate } = require("../helpers/emailHelpers");
const {
  calculateAndUpdateCustomerTier,
  checkAndScheduleTierUpgradeEmail,
} = require("../helpers/tierHelper");

// ============================================================
// Initialize Agenda with MongoDB
// ============================================================

let agenda;
let isAgendaInitialized = false;

async function initializeAgenda() {
  if (isAgendaInitialized) {
    return agenda;
  }

  try {
    console.log("🔄 Initializing Event Agenda job processor...");

    // Ensure database connection is ready
    if (mongoose.connection.readyState !== 1) {
      await new Promise((resolve, reject) => {
        if (mongoose.connection.readyState === 1) {
          resolve();
        } else {
          const timeout = setTimeout(() => {
            reject(new Error("MongoDB connection timeout"));
          }, 30000);
          mongoose.connection.once("connected", () => {
            clearTimeout(timeout);
            resolve();
          });
          mongoose.connection.once("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        }
      });
    }

    // Wait a bit to ensure database is fully ready
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Use the database object directly from Mongoose connection
    const nativeDb = mongoose.connection.db;

    if (!nativeDb) {
      throw new Error("MongoDB database object is not available");
    }

    // Create Agenda instance using the MongoDB Db object
    agenda = new Agenda({
      mongo: nativeDb,
      db: {
        collection: "eventAgendaJobs",
      },
      processEvery: "1 minute",
      defaultLockLifetime: 20 * 60 * 1000, // 20 minutes
      maxConcurrency: 1,
      defaultConcurrency: 1,
      lockLimit: 1,
      defaultLockLimit: 1,
    });

    // Define job processing logic
    agenda.define("process event points", async (job) => {
      const { data } = job.attrs;
      return await processEventPoints(job, data);
    });

    // Define job for sending event emails (scheduled for later)
    agenda.define("send event email", async (job) => {
      const { data } = job.attrs;
      return await sendEventEmailJob(job, data);
    });

    // Error handling - suppress common errors that occur when no jobs exist
    agenda.on("error", (error) => {
      // Only log if it's not a common "no jobs" error
      if (
        !error.message ||
        (!error.message.includes("value") && !error.message.includes("null"))
      ) {
        console.error("Event Agenda error:", error);
      }
    });

    agenda.on("fail", (err, job) => {
      console.error(
        `Event Job ${job.attrs.name} failed with error:`,
        err.message,
      );
    });

    agenda.on("success", (job) => {
      console.log(`✅ Event Job ${job.attrs.name} completed successfully`);
    });

    // Start agenda
    await agenda.start();

    isAgendaInitialized = true;
    console.log("✅ Event Agenda initialized successfully");

    return agenda;
  } catch (error) {
    console.error("❌ Failed to initialize Event Agenda:", error);
    throw error;
  }
}

// ============================================================
// Main Processing Function
// ============================================================

async function processEventPoints(job = null, jobData = {}) {
  const startTime = Date.now();
  let processedCount = 0;
  let failedCount = 0;
  let errors = [];
  let totalCustomers = 0;

  try {
    const jobId = job?.attrs?._id?.toString() || "direct-call";
    console.log(`🔄 Processing event points job (ID: ${jobId})`);

    // Get today's date (or specified date from job data)
    const today = jobData.targetDate
      ? new Date(jobData.targetDate)
      : new Date();
    const todayDateOnly = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );

    console.log(
      `📅 Processing event points for date: ${todayDateOnly.toDateString()}`,
    );

    // Get all CollectSettings with active events
    // Check both event.active and top-level active to be more flexible
    const activeSettings = await CollectSettings.find({
      $or: [
        { "event.active": true },
        { active: true, "event.events": { $exists: true, $ne: [] } },
      ],
    })
      .populate("store_id")
      .populate("channel_id");

    console.log(`Found ${activeSettings.length} channels with active events`);

    let totalEvents = 0;
    let activeEvents = [];

    // First pass: collect all active events for today
    for (const settings of activeSettings) {
      try {
        if (!settings.event?.events || settings.event.events.length === 0) {
          continue;
        }

        const store = settings.store_id;
        const channel = settings.channel_id;

        if (!store || !channel) {
          console.warn(`Missing store or channel for settings ${settings._id}`);
          continue;
        }

        // Get numeric channel_id from Channel model
        const numericChannelId = channel.channel_id;

        for (const event of settings.event.events) {
          try {
            const eventDate = new Date(event.eventDate);
            const eventDateOnly = new Date(
              eventDate.getFullYear(),
              eventDate.getMonth(),
              eventDate.getDate(),
            );

            // Check if event is for today and status is scheduled
            // Also allow events that are in "processing" status (might have been interrupted and need retry)
            if (
              todayDateOnly.getTime() === eventDateOnly.getTime() &&
              (event.status === "scheduled" ||
                (event.status === "processing" &&
                  !event.processingInfo?.completedAt))
            ) {
              // Get customers for this store and channel
              const customers = await Customer.find({
                store_id: store._id,
                channel_id: numericChannelId,
              });

              activeEvents.push({
                event,
                settings,
                store,
                channel,
                numericChannelId,
                customers: customers.length,
              });

              totalCustomers += customers.length;
              totalEvents++;

              console.log(
                `📌 Active event "${event.name}" for store ${store.store_name || store._id}, channel ${numericChannelId}: ${customers.length} customers`,
              );
            }
          } catch (eventCheckError) {
            console.error(
              `❌ Error checking event ${event.name}:`,
              eventCheckError,
            );
            errors.push({
              eventName: event.name,
              storeId: store._id,
              error: eventCheckError.message,
              type: "event_check",
            });
          }
        }
      } catch (settingsError) {
        console.error(
          `❌ Error processing settings ${settings._id}:`,
          settingsError,
        );
        errors.push({
          settingsId: settings._id,
          error: settingsError.message,
          type: "settings_check",
        });
        continue;
      }
    }

    console.log(
      `📊 Found ${totalEvents} active events affecting ${totalCustomers} customers`,
    );

    // If no active events, complete the job early
    if (totalEvents === 0) {
      const result = {
        message: "No active events found for today",
        skipped: true,
        processDate: todayDateOnly.toDateString(),
      };
      return result;
    }

    // Process each active event
    for (const {
      event,
      settings,
      store,
      channel,
      numericChannelId,
    } of activeEvents) {
      try {
        // Update event status to processing
        const eventIndex = settings.event.events.findIndex(
          (e) => e._id.toString() === event._id.toString(),
        );

        if (eventIndex === -1) continue;

        settings.event.events[eventIndex].status = "processing";
        settings.event.events[eventIndex].processingInfo = {
          startedAt: new Date(),
          jobID: job?.attrs?._id?.toString() || "direct-call",
        };
        await settings.save();

        // Get point model for this store and channel
        const pointModel = await Point.findOne({
          store_id: store._id,
          channel_id: channel._id, // Use Channel ObjectId for Point model
        });

        if (!pointModel) {
          console.warn(
            `⚠️ No point model found for store ${store._id}, channel ${channel._id}`,
          );
          settings.event.events[eventIndex].status = "failed";
          settings.event.events[eventIndex].processingInfo.error =
            "Point model not found";
          await settings.save();
          failedCount++;
          continue;
        }

        // Get all customers for this channel
        const customers = await Customer.find({
          store_id: store._id,
          channel_id: numericChannelId,
        });

        console.log(
          `🔄 Processing event "${event.name}" for ${customers.length} customers`,
        );
        console.log(
          `📋 Event details: isImmediate=${event.isImmediate}, point=${event.point}, status=${event.status}`,
        );
        console.log(
          `📋 Query details: store_id=${store._id}, channel_id=${numericChannelId}, channel._id=${channel._id}`,
        );

        if (customers.length === 0) {
          console.warn(
            `⚠️ No customers found for store ${store._id}, channel ${numericChannelId}`,
          );
        } else {
          console.log(
            `👥 Found ${customers.length} customers: ${customers.map((c) => c.email).join(", ")}`,
          );
        }

        let eventProcessedCount = 0;
        let eventFailedCount = 0;

        // Process each customer
        for (const customer of customers) {
          try {
            console.log(
              `\n👤 Processing customer: ${customer._id} (${customer.email}), current points: ${customer.points || 0}`,
            );

            // Check for existing transaction for this event today
            const startOfDay = new Date(todayDateOnly);
            const endOfDay = new Date(todayDateOnly);
            endOfDay.setDate(endOfDay.getDate() + 1);

            const existingTransaction = await Transaction.findOne({
              customerId: customer._id,
              store_id: store._id,
              channel_id: numericChannelId,
              description: `Event: ${event.name}`,
              createdAt: {
                $gte: startOfDay,
                $lt: endOfDay,
              },
            });

            if (existingTransaction) {
              // Transaction already exists, skip points but check if email should be sent
              console.log(
                `⏭️  Customer ${customer._id} already received points for event "${event.name}"`,
              );

              // Recalculate tier even if points were already distributed (to ensure tier is up to date)
              try {
                const freshCustomer = await Customer.findById(customer._id);
                if (freshCustomer) {
                  // Capture previous tier before recalculation
                  const previousTier = freshCustomer.currentTier
                    ? {
                        ...(freshCustomer.currentTier.toObject?.() ||
                          freshCustomer.currentTier),
                      }
                    : null;

                  const tierResult = await calculateAndUpdateCustomerTier(
                    freshCustomer,
                    pointModel,
                  );
                  if (tierResult.tierUpdated) {
                    console.log(
                      `🎯 Tier updated for customer ${customer._id} (${customer.email}) during retry: ${tierResult.message}`,
                    );

                    // Schedule tier upgrade email if tier was upgraded
                    await checkAndScheduleTierUpgradeEmail(
                      tierResult,
                      previousTier,
                      freshCustomer._id,
                      store._id,
                      channel._id,
                      pointModel,
                    );
                  }
                }
              } catch (tierError) {
                // Log error but don't fail the process
                console.error(
                  `⚠️  Error recalculating tier for customer ${customer._id} during retry:`,
                  tierError.message || tierError,
                );
              }

              // Check if email was already sent (stored in transaction metadata)
              const emailAlreadySent =
                existingTransaction.metadata?.emailSent === true;
              if (emailAlreadySent) {
                console.log(
                  `⏭️  Email already sent to customer ${customer._id} (${customer.email}) for event "${event.name}" - skipping duplicate email`,
                );
                eventProcessedCount++;
                continue;
              }

              // Check if email should still be sent (if isImmediate is true and email not sent yet)
              const isImmediate =
                event.isImmediate || event.processingInfo?.isImmediate || false;
              if (isImmediate) {
                console.log(
                  `📧 Customer already has points but email not sent yet. Scheduling email for 2 minutes later (isImmediate=${isImmediate})`,
                );
                try {
                  // Ensure agenda is ready
                  const readyAgenda = await ensureAgendaReady();

                  // Schedule email to be sent after 2 minutes
                  const emailScheduleTime = new Date(
                    Date.now() + 2 * 60 * 1000,
                  ); // 2 minutes from now

                  // Prepare job data - ensure all values are primitives and valid
                  const emailJobData = {
                    customerId: String(customer._id),
                    storeId: String(store._id),
                    channelId: String(channel._id),
                    pointPerEvent: Number(event.point || 0),
                    eventName: String(event.name || ""),
                    transactionId: String(existingTransaction._id),
                  };

                  // Validate all required fields
                  if (
                    !emailJobData.customerId ||
                    !emailJobData.storeId ||
                    !emailJobData.channelId ||
                    !emailJobData.transactionId
                  ) {
                    throw new Error("Missing required fields for email job");
                  }

                  // Try to schedule with Agenda - if it fails, use setTimeout as fallback
                  try {
                    // Use agenda.schedule() directly
                    const emailJob = await readyAgenda.schedule(
                      emailScheduleTime,
                      "send event email",
                      emailJobData,
                    );
                    console.log(
                      `✅ Festival email scheduled via Agenda for customer ${customer._id} (${customer.email}) - will be sent in 2 minutes (Job ID: ${emailJob?.attrs?._id || "unknown"})`,
                    );
                  } catch (agendaError) {
                    // Fallback: Use setTimeout to schedule email sending
                    console.warn(
                      `⚠️ Agenda scheduling failed, using setTimeout fallback for customer ${customer._id}:`,
                      agendaError.message,
                    );

                    // Store job data in transaction metadata for reference
                    existingTransaction.metadata =
                      existingTransaction.metadata || {};
                    existingTransaction.metadata.emailScheduledAt =
                      emailScheduleTime.toISOString();
                    existingTransaction.metadata.emailScheduledVia =
                      "setTimeout";
                    await existingTransaction.save();

                    // Schedule email using setTimeout (runs in background)
                    setTimeout(
                      async () => {
                        try {
                          console.log(
                            `📧 Sending delayed email to customer ${customer._id} (${customer.email}) for event "${event.name}"`,
                          );
                          await sendEventEmailJob(null, emailJobData);
                        } catch (emailError) {
                          console.error(
                            `❌ Error sending delayed email to customer ${customer._id}:`,
                            emailError.message || emailError,
                          );
                        }
                      },
                      2 * 60 * 1000,
                    ); // 2 minutes

                    console.log(
                      `✅ Festival email scheduled via setTimeout fallback for customer ${customer._id} (${customer.email}) - will be sent in 2 minutes`,
                    );
                  }
                } catch (emailScheduleError) {
                  console.error(
                    `❌ Error scheduling email for customer ${customer._id}:`,
                    emailScheduleError.message || emailScheduleError,
                  );
                  console.error(`❌ Error stack:`, emailScheduleError.stack);
                }
              } else {
                console.log(
                  `⏭️  Skipping email for customer ${customer._id} - event "${event.name}" isImmediate=${isImmediate}`,
                );
              }

              eventProcessedCount++;
              continue;
            }

            // Award points
            const pointPerEvent = event.point || 0;
            if (pointPerEvent <= 0) {
              console.log(
                `⏭️  Event "${event.name}" has no points to award, skipping`,
              );
              eventProcessedCount++;
              continue;
            }

            // Calculate expiry date
            const { currentDate, expiryDate } = getExpiryDate(
              pointModel.expiriesInDays,
            );

            // Create transaction first
            const transaction = new Transaction({
              customerId: customer._id,
              store_id: store._id,
              channel_id: numericChannelId,
              bcCustomerId: customer.bcCustomerId,
              type: "earn",
              transactionCategory: "other",
              points: pointPerEvent,
              description: `Event: ${event.name}`,
              status: "completed",
              expiresAt: expiryDate,
              source: "event",
              metadata: {
                eventId: event._id.toString(),
                eventName: event.name,
                eventDate: event.eventDate,
              },
            });

            // STEP 1: Verify customer exists before attempting update
            const customerExists = await Customer.findById(customer._id);
            if (!customerExists) {
              console.error(
                `❌ CRITICAL: Customer ${customer._id} (${customer.email}) not found in database`,
              );
              throw new Error(
                `Customer ${customer._id} not found - cannot distribute points`,
              );
            }

            // STEP 2: Atomically update customer points FIRST (before transaction)
            // This ensures points are distributed before we create any records
            const previousPoints = customerExists.points || 0;
            console.log(
              `💰 Attempting to update points for customer ${customer._id} (${customer.email}): ${previousPoints} + ${pointPerEvent}`,
            );

            let updatedCustomer;
            try {
              // Try using findByIdAndUpdate first (atomic operation)
              updatedCustomer = await Customer.findByIdAndUpdate(
                customer._id,
                {
                  $inc: {
                    points: pointPerEvent,
                    pointsEarned: pointPerEvent,
                  },
                },
                { new: true, runValidators: true }, // Return updated document and run validators
              );

              // If that fails, try using the Customer.updatePoints method as fallback
              if (!updatedCustomer) {
                console.warn(
                  `⚠️ findByIdAndUpdate returned null, trying Customer.updatePoints method for customer ${customer._id}`,
                );
                updatedCustomer = await Customer.updatePoints(
                  customer._id,
                  pointPerEvent,
                  "earn",
                );
              }
            } catch (updateError) {
              console.error(
                `❌ Error updating customer points using findByIdAndUpdate:`,
                updateError,
              );
              console.error(`❌ Error details:`, {
                customerId: customer._id,
                email: customer.email,
                pointsToAdd: pointPerEvent,
                error: updateError.message,
                stack: updateError.stack,
              });
              // Try fallback method
              try {
                console.log(
                  `🔄 Trying fallback: Customer.updatePoints method for customer ${customer._id}`,
                );
                updatedCustomer = await Customer.updatePoints(
                  customer._id,
                  pointPerEvent,
                  "earn",
                );
              } catch (fallbackError) {
                console.error(`❌ Fallback method also failed:`, fallbackError);
                throw new Error(
                  `Failed to update customer points: ${updateError.message || updateError}. Fallback also failed: ${fallbackError.message || fallbackError}`,
                );
              }
            }

            // STEP 3: Verify points were actually updated
            if (!updatedCustomer) {
              console.error(
                `❌ CRITICAL: Failed to update customer points - customer ${customer._id} not found or update returned null`,
              );
              throw new Error(
                `Customer ${customer._id} not found or update failed - points NOT distributed`,
              );
            }

            // Verify the points were actually incremented
            const expectedPoints = previousPoints + pointPerEvent;
            if (updatedCustomer.points !== expectedPoints) {
              console.error(
                `❌ CRITICAL: Points mismatch! Expected: ${expectedPoints}, Got: ${updatedCustomer.points} for customer ${customer._id}`,
              );
              // Revert the update
              try {
                await Customer.findByIdAndUpdate(customer._id, {
                  $inc: {
                    points: -pointPerEvent,
                    pointsEarned: -pointPerEvent,
                  },
                });
              } catch (revertError) {
                console.error(
                  `❌ Failed to revert points update:`,
                  revertError,
                );
              }
              throw new Error(
                `Points update verification failed - points NOT distributed correctly. Expected ${expectedPoints}, got ${updatedCustomer.points}`,
              );
            }

            console.log(
              `✅ Points distributed successfully for customer ${customer._id} (${customer.email}): ${previousPoints} + ${pointPerEvent} = ${updatedCustomer.points} points`,
            );

            // Double-check: Verify customer points in database one more time
            const verifyCustomer = await Customer.findById(customer._id);
            if (!verifyCustomer || verifyCustomer.points !== expectedPoints) {
              console.error(
                `❌ CRITICAL: Points verification failed after update! Customer ${customer._id}: Expected ${expectedPoints}, Database shows ${verifyCustomer?.points || "null"}`,
              );
              throw new Error(
                `Points verification failed - database shows ${verifyCustomer?.points || "null"} but expected ${expectedPoints}`,
              );
            }
            console.log(
              `✅ Points verified in database for customer ${customer._id}: ${verifyCustomer.points} points`,
            );

            // STEP 3: Calculate and update customer tier if tier system is enabled
            try {
              // Capture previous tier before recalculation
              const previousTier = verifyCustomer.currentTier
                ? {
                    ...(verifyCustomer.currentTier.toObject?.() ||
                      verifyCustomer.currentTier),
                  }
                : null;

              const tierResult = await calculateAndUpdateCustomerTier(
                verifyCustomer,
                pointModel,
              );
              if (tierResult.tierUpdated) {
                console.log(
                  `🎯 Tier updated for customer ${customer._id} (${customer.email}): ${tierResult.message}`,
                );

                // Schedule tier upgrade email if tier was upgraded
                await checkAndScheduleTierUpgradeEmail(
                  tierResult,
                  previousTier,
                  verifyCustomer._id,
                  store._id,
                  channel._id,
                  pointModel,
                );
              } else {
                console.log(
                  `ℹ️  Tier check for customer ${customer._id} (${customer.email}): ${tierResult.message}`,
                );
              }
            } catch (tierError) {
              // Log error but don't fail the point distribution
              console.error(
                `⚠️  Error calculating/updating tier for customer ${customer._id}:`,
                tierError.message || tierError,
              );
            }

            // STEP 4: Create and save transaction AFTER points are confirmed
            await transaction.save();
            console.log(
              `💾 Transaction saved for customer ${customer._id} (${customer.email}): ${pointPerEvent} points`,
            );

            // Update the customer object reference for email sending
            customer.points = updatedCustomer.points;
            customer.pointsEarned = updatedCustomer.pointsEarned;

            // STEP 4: Schedule email to be sent later (5 minutes for testing)
            // Points are already distributed, so we can return success quickly
            const isImmediate =
              event.isImmediate || event.processingInfo?.isImmediate || false;

            console.log(
              `📋 Email check for customer ${customer._id} (${customer.email}): isImmediate=${isImmediate}, points distributed=${updatedCustomer.points}`,
            );

            if (isImmediate) {
              try {
                // Ensure agenda is ready
                const readyAgenda = await ensureAgendaReady();

                // Schedule email to be sent after 2 minutes
                const emailScheduleTime = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes from now

                console.log(
                  `📧 Scheduling festival email for customer ${customer._id} (${customer.email}) for event "${event.name}" to be sent at ${emailScheduleTime.toISOString()}`,
                );

                // Prepare job data - ensure all values are primitives and valid
                const emailJobData = {
                  customerId: String(customer._id),
                  storeId: String(store._id),
                  channelId: String(channel._id),
                  pointPerEvent: Number(pointPerEvent),
                  eventName: String(event.name || ""),
                  transactionId: String(transaction._id),
                };

                // Validate all required fields
                if (
                  !emailJobData.customerId ||
                  !emailJobData.storeId ||
                  !emailJobData.channelId ||
                  !emailJobData.transactionId
                ) {
                  throw new Error("Missing required fields for email job");
                }

                // Try to schedule with Agenda - if it fails, use setTimeout as fallback
                try {
                  // Use agenda.schedule() directly
                  const emailJob = await readyAgenda.schedule(
                    emailScheduleTime,
                    "send event email",
                    emailJobData,
                  );
                  console.log(
                    `✅ Festival email scheduled via Agenda for customer ${customer._id} (${customer.email}) - will be sent in 2 minutes (Job ID: ${emailJob?.attrs?._id || "unknown"})`,
                  );
                } catch (agendaError) {
                  // Fallback: Use setTimeout to schedule email sending
                  console.warn(
                    `⚠️ Agenda scheduling failed, using setTimeout fallback for customer ${customer._id}:`,
                    agendaError.message,
                  );

                  // Store job data in transaction metadata for reference
                  transaction.metadata = transaction.metadata || {};
                  transaction.metadata.emailScheduledAt =
                    emailScheduleTime.toISOString();
                  transaction.metadata.emailScheduledVia = "setTimeout";
                  await transaction.save();

                  // Schedule email using setTimeout (runs in background)
                  setTimeout(
                    async () => {
                      try {
                        console.log(
                          `📧 Sending delayed email to customer ${customer._id} (${customer.email}) for event "${event.name}"`,
                        );
                        await sendEventEmailJob(null, emailJobData);
                      } catch (emailError) {
                        console.error(
                          `❌ Error sending delayed email to customer ${customer._id}:`,
                          emailError.message || emailError,
                        );
                      }
                    },
                    2 * 60 * 1000,
                  ); // 2 minutes

                  console.log(
                    `✅ Festival email scheduled via setTimeout fallback for customer ${customer._id} (${customer.email}) - will be sent in 2 minutes`,
                  );
                }
              } catch (emailScheduleError) {
                console.error(
                  `❌ Error scheduling email for customer ${customer._id} (${customer.email}):`,
                  emailScheduleError.message || emailScheduleError,
                );
                console.error(`❌ Error stack:`, emailScheduleError.stack);
                // Points were already distributed, so we don't fail the job if email scheduling fails
                console.log(
                  `⚠️ Email scheduling failed but points were successfully distributed to customer ${customer._id}: ${updatedCustomer.points} points`,
                );
              }
            } else {
              console.log(
                `⏭️  Skipping email for customer ${customer._id} (${customer.email}) - event "${event.name}" isImmediate=${isImmediate}. Points distributed: ${updatedCustomer.points}`,
              );
            }

            eventProcessedCount++;
            processedCount++;

            console.log(
              `✅ Processed event "${event.name}" for customer ${customer._id}: ${pointPerEvent} points`,
            );
          } catch (customerError) {
            console.error(
              `❌ Error processing customer ${customer._id}:`,
              customerError,
            );
            eventFailedCount++;
            failedCount++;
            errors.push({
              customerId: customer._id,
              eventName: event.name,
              error: customerError.message,
              type: "customer_processing",
            });
            continue;
          }
        }

        // Update event status to completed
        settings.event.events[eventIndex].status = "completed";
        settings.event.events[eventIndex].processingInfo = {
          ...settings.event.events[eventIndex].processingInfo,
          completedAt: new Date(),
          processedCount: eventProcessedCount,
          failedCount: eventFailedCount,
          totalCustomers: customers.length,
        };
        await settings.save();

        console.log(
          `✅ Event "${event.name}" completed: ${eventProcessedCount} processed, ${eventFailedCount} failed`,
        );
      } catch (eventError) {
        console.error(`❌ Error processing event ${event.name}:`, eventError);

        // Update event status to failed
        try {
          const eventIndex = settings.event.events.findIndex(
            (e) => e._id.toString() === event._id.toString(),
          );
          if (eventIndex !== -1) {
            settings.event.events[eventIndex].status = "failed";
            settings.event.events[eventIndex].processingInfo = {
              ...settings.event.events[eventIndex].processingInfo,
              error: eventError.message,
            };
            await settings.save();
          }
        } catch (updateError) {
          console.error("❌ Error updating event status:", updateError);
        }

        failedCount++;
        errors.push({
          eventName: event.name,
          storeId: store._id,
          error: eventError.message,
          type: "event_processing",
        });
        continue;
      }
    }

    const duration = Date.now() - startTime;
    const result = {
      message: "Event points processed successfully",
      processDate: todayDateOnly.toDateString(),
      totalEvents,
      totalCustomers,
      processedCount,
      failedCount,
      duration,
      errors: errors.length > 0 ? errors : undefined,
    };

    console.log(`✅ Event points processing completed:`, {
      processDate: todayDateOnly.toDateString(),
      totalEvents,
      totalCustomers,
      processedCount,
      failedCount,
      duration: `${Math.round(duration / 1000)}s`,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("❌ Error in event points processing:", error);

    throw error; // Re-throw the error so Agenda knows the job failed
  }
}

// ============================================================
// Helper function to ensure Agenda is ready for scheduling
// ============================================================

async function ensureAgendaReady() {
  // If agenda is not initialized, initialize it
  if (!agenda || !isAgendaInitialized) {
    console.log("🔄 Agenda not initialized, initializing now...");
    await initializeAgenda();
  }

  // Wait a bit to ensure Agenda is fully started and ready
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Verify Agenda exists and is initialized
  if (!agenda) {
    throw new Error("Agenda instance is null");
  }

  if (!isAgendaInitialized) {
    throw new Error("Agenda is not initialized");
  }

  // Try to verify Agenda is ready by checking if we can access its internal state
  // If agenda has been started, it should be ready
  try {
    // Just verify agenda exists and has the define method (basic sanity check)
    if (typeof agenda.create !== "function") {
      throw new Error("Agenda instance is not properly initialized");
    }
  } catch (checkError) {
    console.error("❌ Agenda readiness check failed:", checkError);
    throw new Error("Agenda is not ready for scheduling jobs");
  }

  return agenda;
}

// ============================================================
// Send Event Email Job Function
// ============================================================

async function sendEventEmailJob(job, jobData) {
  try {
    // Extract data from job or use jobData directly
    const data = job?.attrs?.data || jobData || {};
    const {
      customerId,
      storeId,
      channelId,
      pointPerEvent,
      eventName,
      transactionId,
    } = data;

    console.log(
      `📧 Processing scheduled email job for customer ${customerId}, event: ${eventName}`,
    );

    // Fetch required data
    const customer = await Customer.findById(customerId);
    if (!customer) {
      throw new Error(`Customer ${customerId} not found`);
    }

    const store = await Store.findById(storeId);
    if (!store) {
      throw new Error(`Store ${storeId} not found`);
    }

    const channel = await Channel.findById(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    // Get Point model for email - use channel._id (ObjectId) not channel.channel_id (numeric)
    const pointModel = await Point.findOne({
      store_id: store._id,
      channel_id: channel._id, // Use Channel ObjectId for Point model (same as main processing)
    });

    // Check if email was already sent (prevent duplicates)
    const transaction = await Transaction.findById(transactionId);
    if (transaction) {
      const emailAlreadySent = transaction.metadata?.emailSent === true;
      if (emailAlreadySent) {
        console.log(
          `⏭️  Email already sent for transaction ${transactionId}, skipping duplicate send`,
        );
        return { success: true, message: "Email already sent", skipped: true };
      }
    }

    // Send the email
    console.log(
      `📧 Sending festival email to customer ${customer._id} (${customer.email}) for event "${eventName}"`,
    );

    const emailSent = await sendFestivalEmail(
      customer,
      store,
      pointModel,
      pointPerEvent,
      eventName,
      channel._id,
    );

    if (emailSent && transaction) {
      // Mark email as sent in transaction metadata
      transaction.metadata = transaction.metadata || {};
      transaction.metadata.emailSent = true;
      transaction.metadata.emailSentAt = new Date();
      await transaction.save();
      console.log(
        `✅ Festival email sent successfully to customer ${customer._id} (${customer.email}) for event "${eventName}"`,
      );
    } else if (!emailSent) {
      console.warn(
        `⚠️ Festival email function returned false for customer ${customer._id} (${customer.email}) - check email settings and templates`,
      );
    }

    return {
      success: true,
      message: "Email sent successfully",
      customerId,
      eventName,
    };
  } catch (error) {
    console.error(`❌ Error in sendEventEmailJob:`, error);
    throw error; // Re-throw so Agenda knows the job failed
  }
}

// ============================================================
// Add Job Function with Deduplication
// ============================================================

async function addEventPointsJob(jobData = {}, options = {}) {
  try {
    // Initialize Agenda if not already done
    if (!agenda) {
      await initializeAgenda();
    }

    const targetDate = jobData.targetDate
      ? new Date(jobData.targetDate)
      : new Date();
    const dateString = targetDate.toISOString().split("T")[0]; // YYYY-MM-DD format

    // Create unique job ID to prevent duplicates
    const uniqueId = `eventPoints-${dateString}`;

    // Check if job already exists for this date (for deduplication)
    const existingJobs = await agenda.jobs({
      name: "process event points",
      "data.uniqueId": uniqueId,
      nextRunAt: { $ne: null }, // Job is scheduled to run
    });

    if (existingJobs.length > 0) {
      console.log(
        `⏭️  Event points job already exists for date ${dateString}, skipping duplicate`,
      );
      return existingJobs[0];
    }

    // Schedule the job with customizable delay
    let scheduleTime;
    if (options.delay === "now" || options.delay === undefined) {
      // Schedule immediately (in 5 seconds to allow for processing)
      scheduleTime = new Date(Date.now() + 5000);
    } else if (typeof options.delay === "string") {
      // Parse delay string like "in 30 seconds" or use as-is
      scheduleTime = options.delay;
    } else if (options.delay instanceof Date) {
      scheduleTime = options.delay;
    } else {
      // Default: schedule in 30 seconds
      scheduleTime = new Date(Date.now() + 30000);
    }

    const job = await agenda.schedule(scheduleTime, "process event points", {
      ...jobData,
      uniqueId, // Add unique ID to job data for tracking
      scheduledDate: new Date().toISOString(),
      targetDate: targetDate.toISOString(),
    });

    console.log(
      `📅 Event points job scheduled: ${job.attrs._id} for date: ${dateString}`,
    );

    return job;
  } catch (error) {
    console.error("❌ Error adding event points job:", error);
    throw error;
  }
}

// ============================================================
// Recurring Job Setup
// ============================================================

async function setupRecurringEventJob() {
  try {
    if (!agenda) {
      await initializeAgenda();
    }

    // Cancel existing recurring jobs to avoid duplicates
    try {
      const existingJobs = await agenda.jobs({
        name: "event points recurring",
      });
      if (existingJobs && existingJobs.length > 0) {
        await agenda.cancel({ name: "event points recurring" });
      }
    } catch (cancelError) {
      // Ignore cancel errors if no jobs exist
      console.warn(
        "⚠️  Could not cancel existing recurring jobs:",
        cancelError.message,
      );
    }

    // Define recurring job (runs daily at 10:00 AM to check for events)
    agenda.define("event points recurring", async (job) => {
      console.log("🔄 Checking for active events from recurring schedule");
      await addEventPointsJob({ triggeredBy: "recurring" });
    });

    // Schedule recurring job to run daily at 10:00 AM using repeatEvery
    try {
      // Check if job already exists
      const existingRecurringJobs = await agenda.jobs({
        name: "event points recurring",
      });

      if (existingRecurringJobs && existingRecurringJobs.length > 0) {
        // Update existing job
        const job = existingRecurringJobs[0];
        job.repeatEvery("0 10 * * *", { skipImmediate: true });
        await job.save();
        console.log(
          "✅ Event points recurring job updated (daily at 10:00 AM)",
        );
      } else {
        // Create new recurring job
        const job = agenda.create("event points recurring", {
          triggeredBy: "recurring",
        });
        job.repeatEvery("0 10 * * *", { skipImmediate: true });
        await job.save();
        console.log(
          "✅ Event points recurring job scheduled (daily at 10:00 AM)",
        );
      }
    } catch (everyError) {
      // If scheduling fails, log warning but don't throw
      console.warn(
        "⚠️  Could not schedule recurring job, error:",
        everyError.message,
      );
      // Don't throw - let the system continue without recurring job for now
    }
  } catch (error) {
    console.error("❌ Error setting up recurring event points job:", error);
    throw error;
  }
}

// ============================================================
// Schedule Upcoming Events
// ============================================================

async function scheduleUpcomingEvents() {
  try {
    if (!agenda) {
      await initializeAgenda();
    }

    console.log("🔄 Scheduling upcoming events...");

    // Get all CollectSettings with active events
    // Check both event.active and top-level active to be more flexible
    const activeSettings = await CollectSettings.find({
      $or: [
        { "event.active": true },
        { active: true, "event.events": { $exists: true, $ne: [] } },
      ],
    }).populate("channel_id");

    let scheduledCount = 0;

    for (const settings of activeSettings) {
      if (!settings.event?.events || settings.event.events.length === 0) {
        continue;
      }

      for (const event of settings.event.events) {
        try {
          const eventDate = new Date(event.eventDate);
          const now = new Date();

          // Only schedule future events that are in scheduled status
          if (eventDate > now && event.status === "scheduled") {
            // Check if job already exists for this event
            const eventId = event._id.toString();
            const existingJobs = await agenda.jobs({
              name: "process event points",
              "data.eventId": eventId,
              nextRunAt: { $ne: null },
            });

            if (existingJobs.length === 0) {
              await agenda.schedule(eventDate, "process event points", {
                eventId: eventId,
                storeId: settings.store_id.toString(),
                channelId: settings.channel_id.toString(),
                targetDate: eventDate.toISOString(),
                triggeredBy: "scheduled",
              });

              scheduledCount++;
              console.log(
                `📅 Scheduled event "${event.name}" for ${eventDate.toDateString()}`,
              );
            }
          }
        } catch (eventError) {
          console.error(`❌ Error scheduling event ${event.name}:`, eventError);
        }
      }
    }

    console.log(`✅ Scheduled ${scheduledCount} upcoming events`);
  } catch (error) {
    console.error("❌ Error scheduling upcoming events:", error);
  }
}

// ============================================================
// Graceful Shutdown
// ============================================================

async function gracefulShutdown() {
  console.log("🛑 Gracefully shutting down Event Agenda...");

  if (agenda) {
    await agenda.stop();
    console.log("✅ Event Agenda stopped");
  }
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// ============================================================
// Utility Functions for Queue Management
// ============================================================

async function getQueueStats() {
  if (!agenda) {
    await initializeAgenda();
  }

  const jobs = await agenda.jobs({ name: "process event points" });
  const pending = await agenda.jobs({
    name: "process event points",
    nextRunAt: { $ne: null },
  });
  const running = await agenda.jobs({
    name: "process event points",
    lockedAt: { $ne: null },
  });
  const failed = await agenda.jobs({
    name: "process event points",
    failedAt: { $ne: null },
  });
  const completed = await agenda.jobs({
    name: "process event points",
    lastFinishedAt: { $ne: null },
    failedAt: null,
  });

  return {
    total: jobs.length,
    pending: pending.length,
    running: running.length,
    failed: failed.length,
    completed: completed.length,
  };
}

async function removeOldJobs(daysOld = 7) {
  if (!agenda) {
    await initializeAgenda();
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const result = await agenda.cancel({
    name: "process event points",
    lastFinishedAt: { $lt: cutoffDate },
  });

  console.log(`🗑️  Removed ${result} old event points jobs`);
  return result;
}

/**
 * Cancel all scheduled event points jobs for a specific channel.
 * Called when resetting channel settings and deleting all events.
 */
async function cancelEventJobsForChannel(channelId) {
  if (!agenda) {
    await initializeAgenda();
  }

  const channelIdStr =
    typeof channelId === "string" ? channelId : channelId?.toString?.();
  if (!channelIdStr) return 0;

  try {
    const jobs = await agenda.jobs({
      name: "process event points",
      "data.channelId": channelIdStr,
      nextRunAt: { $ne: null },
    });

    let cancelledCount = 0;
    for (const job of jobs) {
      await job.remove();
      cancelledCount++;
    }

    if (cancelledCount > 0) {
      console.log(
        `🗑️  Cancelled ${cancelledCount} event jobs for channel ${channelIdStr}`,
      );
    }
    return cancelledCount;
  } catch (error) {
    console.error("Error cancelling event jobs for channel:", error);
    return 0;
  }
}

// ============================================================
// Initialize on module load
// ============================================================

(async () => {
  try {
    await initializeAgenda();
  } catch (error) {
    console.error(
      "❌ Failed to initialize Event Agenda on module load:",
      error,
    );
  }
})();

module.exports = {
  addEventPointsJob,
  processEventPoints, // Export for direct calls
  scheduleUpcomingEvents,
  setupRecurringEventJob,
  initializeAgenda,
  gracefulShutdown,
  getQueueStats,
  removeOldJobs,
  cancelEventJobsForChannel,
  agenda,
};
