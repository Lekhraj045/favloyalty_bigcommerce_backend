// queues/birthdayQueue.js
const { Agenda } = require("@hokify/agenda");
const mongoose = require("mongoose");

// Import required models and modules
const Customer = require("../models/Customer");
const CollectSettings = require("../models/CollectSettings");
const Transaction = require("../models/Transaction");
const Point = require("../models/Point");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const { sendBirthdayEmail, getExpiryDate } = require("../helpers/emailHelpers");

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
    console.log("🔄 Initializing Birthday Agenda job processor...");

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
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Use the database object directly from Mongoose connection
    const nativeDb = mongoose.connection.db;
    
    if (!nativeDb) {
      throw new Error("MongoDB database object is not available");
    }

    // Create Agenda instance
    agenda = new Agenda({
      mongo: nativeDb,
      db: {
        collection: "birthdayAgendaJobs",
      },
      processEvery: "1 minute",
      defaultLockLifetime: 20 * 60 * 1000,
      maxConcurrency: 1,
      defaultConcurrency: 1,
      lockLimit: 1,
      defaultLockLimit: 1,
    });

    // Define job processing logic
    agenda.define("process birthday points", async (job) => {
      const { data } = job.attrs;
      return await processBirthdayPoints(job, data);
    });

    // Error handling - suppress common errors that occur when no jobs exist
    agenda.on("error", (error) => {
      // Only log if it's not a common "no jobs" error
      if (!error.message || (!error.message.includes("value") && !error.message.includes("null"))) {
        console.error("Birthday Agenda error:", error);
      }
    });

    agenda.on("fail", (err, job) => {
      console.error(
        `Birthday Job ${job.attrs.name} failed with error:`,
        err.message
      );
    });

    agenda.on("success", (job) => {
      console.log(`✅ Birthday Job ${job.attrs.name} completed successfully`);
    });

    // Start agenda
    await agenda.start();

    isAgendaInitialized = true;
    console.log("✅ Birthday Agenda initialized successfully");

    return agenda;
  } catch (error) {
    console.error("❌ Failed to initialize Birthday Agenda:", error);
    throw error;
  }
}

// ============================================================
// Main Processing Function
// ============================================================

async function processBirthdayPoints(job, jobData = {}) {
  const startTime = Date.now();
  let processedCount = 0;
  let failedCount = 0;
  let errors = [];

  try {
    console.log("🔄 Processing birthday points job");

    // Use provided date or current date
    const targetDate = jobData.targetDate
      ? new Date(jobData.targetDate)
      : new Date();
    const month = targetDate.getMonth() + 1; // 1-12
    const day = targetDate.getDate(); // 1-31
    const currentYear = targetDate.getFullYear();

    console.log(
      `📅 Processing birthday points for ${month}/${day}/${currentYear}`
    );

    // Find customers with birthdays today
    // Note: DOB should be stored in customer profile - checking profile fields
    // For now, we'll query customers and filter by birthday
    // TODO: Add dob field to Customer profile schema if not present
    const allCustomers = await Customer.find({}).populate("store_id");

    const birthdayCustomers = [];

    for (const customer of allCustomers) {
      // Check if customer has DOB - this might be stored in profile or as a separate field
      // For now, check if there's any date field we can use
      // In the future, add a dob field to the Customer model
      let dob = null;
      
      // Check various possible locations for DOB
      if (customer.profile?.dob) {
        dob = customer.profile.dob;
      } else if (customer.dob) {
        dob = customer.dob;
      } else if (customer.dateOfBirth) {
        dob = customer.dateOfBirth;
      }
      
      if (!dob) continue;

      try {
        const dobDate = new Date(dob);
        if (isNaN(dobDate.getTime())) continue; // Invalid date

        const dobMonth = dobDate.getMonth() + 1;
        const dobDay = dobDate.getDate();

        if (dobMonth === month && dobDay === day) {
          birthdayCustomers.push(customer);
        }
      } catch (dateError) {
        console.warn(`⚠️  Invalid DOB for customer ${customer._id}:`, dateError);
        continue;
      }
    }

    const totalCustomers = birthdayCustomers.length;
    console.log(
      `🎂 Found ${totalCustomers} customers with birthdays on ${month}/${day}`
    );

    // If no birthday customers, complete the job early
    if (totalCustomers === 0) {
      const result = {
        message: "No birthday customers found for today",
        skipped: true,
        processDate: targetDate.toISOString().split("T")[0],
        totalCustomers: 0,
      };
      return result;
    }

    // Group customers by store and channel
    const customersByStoreChannel = {};

    for (const customer of birthdayCustomers) {
      const key = `${customer.store_id}_${customer.channel_id}`;
      if (!customersByStoreChannel[key]) {
        customersByStoreChannel[key] = [];
      }
      customersByStoreChannel[key].push(customer);
    }

    // Process each store/channel combination
    for (const [key, customers] of Object.entries(customersByStoreChannel)) {
      const [storeId, numericChannelId] = key.split("_");

      try {
        const store = await Store.findById(storeId);
        if (!store) {
          console.warn(`⚠️  Store not found: ${storeId}`);
          continue;
        }

        // Find Channel by numeric channel_id
        const channel = await Channel.findOne({
          store_id: storeId,
          channel_id: parseInt(numericChannelId),
        });

        if (!channel) {
          console.warn(
            `⚠️  Channel not found: store ${storeId}, channel ${numericChannelId}`
          );
          continue;
        }

        // Get CollectSettings
        const collectSettings = await CollectSettings.findOne({
          store_id: storeId,
          channel_id: channel._id, // Use Channel ObjectId
        });

        if (!collectSettings) {
          console.warn(
            `⚠️  CollectSettings not found for store ${storeId}, channel ${channel._id}`
          );
          continue;
        }

        // Check if birthday points are active
        if (!collectSettings.basic?.birthday?.active) {
          console.log(
            `⏭️  Birthday points not active for store ${storeId}, channel ${numericChannelId}`
          );
          continue;
        }

        // Get point model
        const pointModel = await Point.findOne({
          store_id: storeId,
          channel_id: channel._id, // Use Channel ObjectId
        });

        if (!pointModel) {
          console.warn(
            `⚠️  Point model not found for store ${storeId}, channel ${channel._id}`
          );
          continue;
        }

        const birthdayPoints = collectSettings.basic.birthday.point || 0;

        if (birthdayPoints <= 0) {
          console.log(
            `⏭️  No birthday points configured for store ${storeId}, channel ${numericChannelId}`
          );
          continue;
        }

        // Process each customer
        for (const customer of customers) {
          try {
            // Check for existing birthday transaction this year
            const yearStart = new Date(currentYear, 0, 1);
            const yearEnd = new Date(currentYear, 11, 31, 23, 59, 59);

            const existingTransaction = await Transaction.findOne({
              customerId: customer._id,
              store_id: storeId,
              channel_id: parseInt(numericChannelId),
              description: "Birthday Celebration",
              createdAt: {
                $gte: yearStart,
                $lte: yearEnd,
              },
            });

            if (existingTransaction) {
              // Already received birthday points this year
              console.log(
                `⏭️  Customer ${customer._id} already received birthday points this year`
              );
              processedCount++;
              continue;
            }

            // Award birthday points
            customer.points = (customer.points || 0) + birthdayPoints;
            customer.pointsEarned =
              (customer.pointsEarned || 0) + birthdayPoints;

            // Calculate expiry date
            const { currentDate, expiryDate } = getExpiryDate(
              pointModel.expiriesInDays
            );

            // Create transaction
            const transaction = new Transaction({
              customerId: customer._id,
              store_id: storeId,
              channel_id: parseInt(numericChannelId),
              bcCustomerId: customer.bcCustomerId,
              type: "earn",
              transactionCategory: "other",
              points: birthdayPoints,
              description: "Birthday Celebration",
              status: "completed",
              expiresAt: expiryDate,
              source: "birthday",
              metadata: {
                birthdayYear: currentYear,
              },
            });

            // Save transaction and customer
            await Promise.all([transaction.save(), customer.save()]);

            // Send birthday email
            try {
              await sendBirthdayEmail(
                customer,
                store,
                pointModel,
                birthdayPoints,
                channel._id // Pass Channel ObjectId
              );
            } catch (emailError) {
              console.error(
                `⚠️  Error sending birthday email to customer ${customer._id}:`,
                emailError
              );
              // Don't fail the job if email fails
            }

            processedCount++;
            console.log(
              `✅ Processed birthday for customer ${customer._id}: ${birthdayPoints} points`
            );
          } catch (customerError) {
            console.error(
              `❌ Error processing customer ${customer._id}:`,
              customerError
            );
            failedCount++;
            errors.push({
              customerId: customer._id,
              error: customerError.message,
              type: "customer_processing",
            });
            continue;
          }
        }
      } catch (storeChannelError) {
        console.error(
          `❌ Error processing store/channel ${key}:`,
          storeChannelError
        );
        failedCount += customers.length;
        errors.push({
          storeId,
          channelId: numericChannelId,
          error: storeChannelError.message,
          type: "store_channel_processing",
        });
        continue;
      }
    }

    const duration = Date.now() - startTime;
    const result = {
      message: "Birthday points processed successfully",
      processDate: targetDate.toISOString().split("T")[0],
      totalCustomers,
      processedCount,
      failedCount,
      duration,
      errors: errors.length > 0 ? errors : undefined,
    };

    console.log(`✅ Birthday points processing completed:`, {
      processDate: targetDate.toISOString().split("T")[0],
      totalCustomers,
      processedCount,
      failedCount,
      duration: `${Math.round(duration / 1000)}s`,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("❌ Error in birthday points processing:", error);

    throw error; // Re-throw the error so Agenda knows the job failed
  }
}

// ============================================================
// Add Job Function with Deduplication
// ============================================================

async function addBirthdayPointsJob(jobData = {}, options = {}) {
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
    const uniqueId = `birthdayPoints-${dateString}`;

    // Check if job already exists for this date
    const existingJobs = await agenda.jobs({
      name: "process birthday points",
      "data.uniqueId": uniqueId,
      nextRunAt: { $ne: null },
    });

    if (existingJobs.length > 0) {
      console.log(
        `⏭️  Birthday points job already exists for date ${dateString}, skipping duplicate`
      );
      return existingJobs[0];
    }

    // Schedule the job
    const delay = options.delay || "in 30 seconds";
    const job = await agenda.schedule(delay, "process birthday points", {
      ...jobData,
      uniqueId,
      scheduledDate: new Date().toISOString(),
      targetDate: targetDate.toISOString(),
    });

    console.log(
      `📅 Birthday points job scheduled: ${job.attrs._id} for date: ${dateString}`
    );

    return job;
  } catch (error) {
    console.error("❌ Error adding birthday points job:", error);
    throw error;
  }
}

// ============================================================
// Recurring Job Setup
// ============================================================

async function setupRecurringBirthdayJob() {
  try {
    if (!agenda) {
      await initializeAgenda();
    }

    // Cancel existing recurring jobs
    try {
      const existingJobs = await agenda.jobs({ name: "birthday points recurring" });
      if (existingJobs && existingJobs.length > 0) {
        await agenda.cancel({ name: "birthday points recurring" });
      }
    } catch (cancelError) {
      // Ignore cancel errors if no jobs exist
      console.warn("⚠️  Could not cancel existing recurring jobs:", cancelError.message);
    }

    // Define recurring job (runs daily at 9:00 AM)
    agenda.define("birthday points recurring", async (job) => {
      console.log("🔄 Checking for birthdays from recurring schedule");
      await addBirthdayPointsJob({ triggeredBy: "recurring" });
    });

    // Schedule recurring job to run daily at 9:00 AM using repeatEvery
    try {
      // Check if job already exists
      const existingRecurringJobs = await agenda.jobs({ name: "birthday points recurring" });
      
      if (existingRecurringJobs && existingRecurringJobs.length > 0) {
        // Update existing job
        const job = existingRecurringJobs[0];
        job.repeatEvery("0 9 * * *", { skipImmediate: true });
        await job.save();
        console.log("✅ Birthday points recurring job updated (daily at 9:00 AM)");
      } else {
        // Create new recurring job
        const job = agenda.create("birthday points recurring", { triggeredBy: "recurring" });
        job.repeatEvery("0 9 * * *", { skipImmediate: true });
        await job.save();
        console.log("✅ Birthday points recurring job scheduled (daily at 9:00 AM)");
      }
    } catch (everyError) {
      // If scheduling fails, log warning but don't throw
      console.warn("⚠️  Could not schedule recurring job, error:", everyError.message);
      // Don't throw - let the system continue without recurring job for now
    }
  } catch (error) {
    console.error("❌ Error setting up recurring birthday points job:", error);
    throw error;
  }
}

// ============================================================
// Graceful Shutdown
// ============================================================

async function gracefulShutdown() {
  console.log("🛑 Gracefully shutting down Birthday Agenda...");

  if (agenda) {
    await agenda.stop();
    console.log("✅ Birthday Agenda stopped");
  }
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// ============================================================
// Utility Functions
// ============================================================

async function getQueueStats() {
  if (!agenda) {
    await initializeAgenda();
  }

  const jobs = await agenda.jobs({ name: "process birthday points" });
  const pending = await agenda.jobs({
    name: "process birthday points",
    nextRunAt: { $ne: null },
  });
  const running = await agenda.jobs({
    name: "process birthday points",
    lockedAt: { $ne: null },
  });
  const failed = await agenda.jobs({
    name: "process birthday points",
    failedAt: { $ne: null },
  });
  const completed = await agenda.jobs({
    name: "process birthday points",
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

async function removeOldJobs(daysOld = 30) {
  if (!agenda) {
    await initializeAgenda();
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const result = await agenda.cancel({
    name: "process birthday points",
    lastFinishedAt: { $lt: cutoffDate },
  });

  console.log(`🗑️  Removed ${result} old birthday points jobs`);
  return result;
}

// ============================================================
// Initialize on module load
// ============================================================

(async () => {
  try {
    await initializeAgenda();
  } catch (error) {
    console.error(
      "❌ Failed to initialize Birthday Agenda on module load:",
      error
    );
  }
})();

module.exports = {
  addBirthdayPointsJob,
  setupRecurringBirthdayJob,
  initializeAgenda,
  gracefulShutdown,
  getQueueStats,
  removeOldJobs,
  agenda,
};
