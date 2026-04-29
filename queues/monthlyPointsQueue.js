// queues/monthlyPointsQueue.js
const { Agenda } = require("@hokify/agenda");
const mongoose = require("mongoose");

// Import required models and modules
const Customer = require("../models/Customer");
const CollectSettings = require("../models/CollectSettings");
const Transaction = require("../models/Transaction");
const Point = require("../models/Point");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const { sendMonthlyPointsEmail } = require("../helpers/emailHelpers");

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
    console.log("🔄 Initializing Monthly Points Agenda job processor...");

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
        collection: "monthlyPointsAgendaJobs",
      },
      processEvery: "1 minute",
      defaultLockLifetime: 30 * 60 * 1000,
      maxConcurrency: 1,
      defaultConcurrency: 1,
      lockLimit: 1,
      defaultLockLimit: 1,
    });

    // Define job processing logic
    agenda.define("process monthly points", async (job) => {
      const { data } = job.attrs;
      return await processMonthlyPoints(job, data);
    });

    // Error handling - suppress common errors that occur when no jobs exist
    agenda.on("error", (error) => {
      // Only log if it's not a common "no jobs" error
      if (!error.message || (!error.message.includes("value") && !error.message.includes("null"))) {
        console.error("Monthly Points Agenda error:", error);
      }
    });

    agenda.on("fail", (err, job) => {
      console.error(
        `Monthly Points Job ${job.attrs.name} failed with error:`,
        err.message
      );
    });

    agenda.on("success", (job) => {
      console.log(
        `✅ Monthly Points Job ${job.attrs.name} completed successfully`
      );
    });

    // Start agenda
    await agenda.start();

    isAgendaInitialized = true;
    console.log("✅ Monthly Points Agenda initialized successfully");

    return agenda;
  } catch (error) {
    console.error("❌ Failed to initialize Monthly Points Agenda:", error);
    throw error;
  }
}

// ============================================================
// Main Processing Function
// ============================================================

async function processMonthlyPoints(job, jobData = {}) {
  const startTime = Date.now();
  let processedCount = 0;
  let failedCount = 0;
  let errors = [];
  let totalCustomers = 0;

  try {
    console.log("🔄 Processing monthly points job");

    const today = jobData?.targetDate
      ? new Date(jobData.targetDate)
      : new Date();

    // Check if it's the 28th day of the month
    if (today.getDate() !== 28) {
      const result = {
        message: "Not the 28th day of the month - skipping monthly points job",
        skipped: true,
        currentDate: today.getDate(),
      };
      return result;
    }

    console.log(
      `📅 Processing monthly points statements for ${today.toDateString()}`
    );

    // Get all CollectSettings with monthly points email enabled
    const activeSettings = await CollectSettings.find({
      $or: [
        { "emailSetting.all.enable": true },
        { "emailSetting.monthlyPoints.enable": true },
      ],
    }).populate("store_id").populate("channel_id");

    console.log(
      `📊 Found ${activeSettings.length} channels with monthly points email enabled`
    );

    // Count total customers first
    for (const settings of activeSettings) {
      try {
        const store = settings.store_id;
        const channel = settings.channel_id;

        if (!store || !channel) continue;

        const numericChannelId = channel.channel_id;
        const customers = await Customer.find({
          store_id: store._id,
          channel_id: numericChannelId,
        });

        totalCustomers += customers.length;
      } catch (countError) {
        console.error("❌ Error counting customers:", countError);
      }
    }

    console.log(`📊 Total customers to process: ${totalCustomers}`);

    // Process each store/channel
    for (const settings of activeSettings) {
      try {
        const store = settings.store_id;
        const channel = settings.channel_id;

        if (!store || !channel) {
          console.warn(
            `⚠️  Missing store or channel for settings ${settings._id}`
          );
          continue;
        }

        const numericChannelId = channel.channel_id;

        // Get point model
        const pointModel = await Point.findOne({
          store_id: store._id,
          channel_id: channel._id, // Use Channel ObjectId
        });

        if (!pointModel) {
          console.warn(
            `⚠️  Point model not found for store ${store._id}, channel ${channel._id}`
          );
          continue;
        }

        // Get all customers for this channel
        const customers = await Customer.find({
          store_id: store._id,
          channel_id: numericChannelId,
        });

        console.log(
          `🔄 Processing ${customers.length} customers for store ${store.store_name || store._id}, channel ${numericChannelId}`
        );

        // Process each customer
        for (const customer of customers) {
          try {
            // Check if notification already sent this month
            const monthStart = new Date(
              today.getFullYear(),
              today.getMonth(),
              1,
            );
            const monthEnd = new Date(
              today.getFullYear(),
              today.getMonth() + 1,
              0,
              23,
              59,
              59,
            );

            // Check for existing monthly email notification (we can use a transaction or separate notification)
            // For now, we'll send to all customers - you can add notification tracking later

            // Send the monthly statement email
            try {
              const emailSent = await sendMonthlyPointsEmail(
                customer,
                store,
                pointModel,
                channel._id, // Pass Channel ObjectId
                channel.site_url,
                today,
              );

              if (emailSent) {
                processedCount++;
                console.log(
                  `✅ Sent monthly statement to customer ${customer._id}`
                );
              } else {
                console.warn(
                  `⚠️  Failed to send monthly email to customer ${customer._id}`
                );
                failedCount++;
                errors.push({
                  customerId: customer._id,
                  storeId: store._id,
                  error: "Email sending failed",
                  type: "email",
                });
              }
            } catch (emailError) {
              console.error(
                `❌ Error sending monthly email to customer ${customer._id}:`,
                emailError
              );
              failedCount++;
              errors.push({
                customerId: customer._id,
                storeId: store._id,
                error: emailError.message,
                type: "email",
              });
            }
          } catch (customerError) {
            console.error(
              `❌ Error processing customer ${customer._id}:`,
              customerError
            );
            failedCount++;
            errors.push({
              customerId: customer._id,
              storeId: store._id,
              error: customerError.message,
              type: "processing",
            });
            continue;
          }
        }
      } catch (storeChannelError) {
        console.error(
          `❌ Error processing store/channel:`,
          storeChannelError
        );
        errors.push({
          settingsId: settings._id,
          error: storeChannelError.message,
          type: "store_channel_processing",
        });
        continue;
      }
    }

    const duration = Date.now() - startTime;
    const result = {
      message: "Monthly points statements processed successfully",
      totalMerchants: activeSettings.length,
      totalCustomers,
      processedCount,
      failedCount,
      duration,
      errors: errors.length > 0 ? errors : undefined,
    };

    console.log(`✅ Monthly points processing completed:`, {
      totalCustomers,
      processedCount,
      failedCount,
      duration: `${Math.round(duration / 1000)}s`,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("❌ Error in monthly points processing:", error);

    throw error; // Re-throw the error so Agenda knows the job failed
  }
}

// ============================================================
// Add Job Function with Deduplication
// ============================================================

async function addMonthlyPointsJob(jobData = {}, options = {}) {
  try {
    // Initialize Agenda if not already done
    if (!agenda) {
      await initializeAgenda();
    }

    const baseDate = jobData?.targetDate
      ? new Date(jobData.targetDate)
      : new Date();
    const jobId = `monthlyPoints-${baseDate.getFullYear()}-${baseDate.getMonth() + 1}`;

    // Check if job already exists for this month
    const existingJobs = await agenda.jobs({
      name: "process monthly points",
      "data.uniqueId": jobId,
      nextRunAt: { $ne: null },
    });

    if (existingJobs.length > 0) {
      console.log(
        `⏭️  Monthly points job already exists for this month, skipping duplicate`
      );
      return existingJobs[0];
    }

    // Schedule the job
    const delay = options.delay || "in 30 seconds";
    const job = await agenda.schedule(delay, "process monthly points", {
      ...jobData,
      uniqueId: jobId,
      scheduledDate: baseDate.toISOString(),
    });

    console.log(`📅 Monthly points job scheduled: ${job.attrs._id}`);

    return job;
  } catch (error) {
    console.error("❌ Error adding monthly points job:", error);
    throw error;
  }
}

// ============================================================
// Recurring Job Setup
// ============================================================

async function setupRecurringMonthlyJob() {
  try {
    if (!agenda) {
      await initializeAgenda();
    }

    // Cancel existing recurring jobs
    try {
      const existingJobs = await agenda.jobs({ name: "monthly points recurring" });
      if (existingJobs && existingJobs.length > 0) {
        await agenda.cancel({ name: "monthly points recurring" });
      }
    } catch (cancelError) {
      // Ignore cancel errors if no jobs exist
      console.warn("⚠️  Could not cancel existing recurring jobs:", cancelError.message);
    }

    // Define recurring job (runs on the 28th of every month at 9:00 AM)
    agenda.define("monthly points recurring", async (job) => {
      const today = new Date();
      if (today.getDate() === 28) {
        console.log(
          "🔄 Triggering monthly points job from recurring schedule"
        );
        await addMonthlyPointsJob({
          triggeredBy: "recurring",
          targetDate: today.toISOString(),
        });
      } else {
        console.log(
          `⏭️  Skipping monthly points - today is ${today.getDate()}, not 28th`
        );
      }
    });

    // Schedule recurring job to run daily at 9:00 AM using repeatEvery
    try {
      // Check if job already exists
      const existingRecurringJobs = await agenda.jobs({ name: "monthly points recurring" });

      if (existingRecurringJobs && existingRecurringJobs.length > 0) {
        // Update existing job
        const job = existingRecurringJobs[0];
        job.repeatEvery("0 9 * * *", { skipImmediate: true });
        await job.save();
        console.log("✅ Monthly points recurring job updated");
      } else {
        // Create new recurring job
        const job = agenda.create("monthly points recurring", { triggeredBy: "recurring" });
        job.repeatEvery("0 9 * * *", { skipImmediate: true });
        await job.save();
        console.log("✅ Monthly points recurring job scheduled");
      }
    } catch (everyError) {
      // If scheduling fails, log warning but don't throw
      console.warn("⚠️  Could not schedule recurring job, error:", everyError.message);
      // Don't throw - let the system continue without recurring job for now
    }
  } catch (error) {
    console.error("❌ Error setting up recurring monthly points job:", error);
    throw error;
  }
}

// ============================================================
// Graceful Shutdown
// ============================================================

async function gracefulShutdown() {
  console.log("🛑 Gracefully shutting down Monthly Points Agenda...");

  if (agenda) {
    await agenda.stop();
    console.log("✅ Monthly Points Agenda stopped");
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

  const jobs = await agenda.jobs({ name: "process monthly points" });
  const pending = await agenda.jobs({
    name: "process monthly points",
    nextRunAt: { $ne: null },
  });
  const running = await agenda.jobs({
    name: "process monthly points",
    lockedAt: { $ne: null },
  });
  const failed = await agenda.jobs({
    name: "process monthly points",
    failedAt: { $ne: null },
  });
  const completed = await agenda.jobs({
    name: "process monthly points",
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
    name: "process monthly points",
    lastFinishedAt: { $lt: cutoffDate },
  });

  console.log(`🗑️  Removed ${result} old monthly points jobs`);
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
      "❌ Failed to initialize Monthly Points Agenda on module load:",
      error
    );
  }
})();

module.exports = {
  addMonthlyPointsJob,
  setupRecurringMonthlyJob,
  initializeAgenda,
  gracefulShutdown,
  getQueueStats,
  removeOldJobs,
  agenda,
};
