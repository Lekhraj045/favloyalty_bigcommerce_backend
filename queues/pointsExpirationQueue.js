// queues/pointsExpirationQueue.js
const { Agenda } = require("@hokify/agenda");
const mongoose = require("mongoose");

// Import required models and modules
const Transaction = require("../models/Transaction");
const Customer = require("../models/Customer");
const CollectSettings = require("../models/CollectSettings");
const Point = require("../models/Point");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const {
  sendPointsExpirationEmail,
  sendCouponExpirationWarningEmail,
} = require("../helpers/emailHelpers");

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
    console.log(
      "🔄 Initializing Transaction Expiration Agenda job processor..."
    );

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
        collection: "transactionExpirationAgendaJobs",
      },
      processEvery: "1 minute",
      defaultLockLifetime: 30 * 60 * 1000,
      maxConcurrency: 2,
      defaultConcurrency: 1,
      lockLimit: 2,
      defaultLockLimit: 1,
    });

    // Define job processing logic
    agenda.define("process transaction expiration", async (job) => {
      const { data } = job.attrs;
      return await processTransactionExpiration(job, data);
    });

    // Error handling - suppress common errors that occur when no jobs exist
    agenda.on("error", (error) => {
      // Only log if it's not a common "no jobs" error
      if (!error.message || (!error.message.includes("value") && !error.message.includes("null"))) {
        console.error("Transaction Expiration Agenda error:", error);
      }
    });

    agenda.on("fail", (err, job) => {
      console.error(
        `Transaction Expiration Job ${job.attrs.name} failed with error:`,
        err.message
      );
    });

    agenda.on("success", (job) => {
      console.log(
        `✅ Transaction Expiration Job ${job.attrs.name} completed successfully`
      );
    });

    // Start agenda
    await agenda.start();

    isAgendaInitialized = true;
    console.log("✅ Transaction Expiration Agenda initialized successfully");

    return agenda;
  } catch (error) {
    console.error(
      "❌ Failed to initialize Transaction Expiration Agenda:",
      error
    );
    throw error;
  }
}

// ============================================================
// Main Processing Function
// ============================================================

async function processTransactionExpiration(job, jobData = {}) {
  const startTime = Date.now();
  let processedCount = 0;
  let failedCount = 0;
  let errors = [];

  try {
    console.log("🔄 Processing transaction expiration job");

    // Use provided date or current date
    const today = jobData.targetDate ? new Date(jobData.targetDate) : new Date();
    const twoDaysFromNow = new Date(today);
    twoDaysFromNow.setDate(today.getDate() + 2);

    console.log(
      `📅 Processing transaction expiration for date: ${today.toDateString()}`
    );

    // Find transactions expiring today (for points) and in 2 days (for coupons)
    const expiringTransactions = await Transaction.find({
      $or: [
        // Points transactions expiring today
        {
          expiresAt: { $lte: today },
          status: "completed",
          type: "earn",
        },
        // Redeem transactions expiring in 2 days
        {
          expiresAt: {
            $gte: today,
            $lte: twoDaysFromNow,
          },
          status: "completed",
          type: "redeem",
        },
      ],
    }).populate("customerId").populate("store_id");

    const totalTransactions = expiringTransactions.length;
    console.log(`📊 Found ${totalTransactions} expiring transactions`);

    // If no expiring transactions, complete the job early
    if (totalTransactions === 0) {
      const result = {
        message: "No expiring transactions found",
        skipped: true,
        processDate: today.toDateString(),
        totalTransactions: 0,
      };
      return result;
    }

    // Process each transaction
    for (const transaction of expiringTransactions) {
      try {
        const customer = transaction.customerId;
        const store = transaction.store_id;

        if (!customer || !store) {
          console.warn(
            `⚠️  Missing customer or store for transaction ${transaction._id}`
          );
          continue;
        }

        // Get Channel by numeric channel_id
        const channel = await Channel.findOne({
          store_id: store._id,
          channel_id: transaction.channel_id,
        });

        if (!channel) {
          console.warn(
            `⚠️  Channel not found for transaction ${transaction._id}`
          );
          continue;
        }

        // Get CollectSettings
        const collectSettings = await CollectSettings.findOne({
          store_id: store._id,
          channel_id: channel._id, // Use Channel ObjectId
        });

        if (!collectSettings) {
          console.warn(
            `⚠️  CollectSettings not found for transaction ${transaction._id}`
          );
          continue;
        }

        // Get point model
        const pointModel = await Point.findOne({
          store_id: store._id,
          channel_id: channel._id, // Use Channel ObjectId
        });

        if (!pointModel) {
          console.warn(
            `⚠️  Point model not found for transaction ${transaction._id}`
          );
          continue;
        }

        if (transaction.type === "earn") {
          // Handle points expiration
          const pointsToDeduct = transaction.points || 0;

          if (pointsToDeduct > 0) {
            // Deduct points from customer
            if (pointsToDeduct > customer.points) {
              console.warn(
                `⚠️  Attempting to deduct ${pointsToDeduct} points from customer with ${customer.points} points`
              );
              customer.points = 0;
            } else {
              customer.points -= pointsToDeduct;
            }

            await customer.save();

            // Send expiration email if enabled
            try {
              await sendPointsExpirationEmail(
                customer,
                store,
                pointModel,
                pointsToDeduct,
                channel._id, // Pass Channel ObjectId
                channel.site_url
              );
            } catch (emailError) {
              console.error(
                `⚠️  Error sending points expiration email:`,
                emailError
              );
              // Don't fail the job if email fails
            }
          }

          // Mark transaction as expired
          transaction.status = "expired";
          await transaction.save();
        } else if (transaction.type === "redeem") {
          // Handle coupon expiration warnings
          const daysUntilExpiry = Math.ceil(
            (transaction.expiresAt - today) / (1000 * 60 * 60 * 24)
          );

          if (daysUntilExpiry <= 2 && daysUntilExpiry >= 0) {
            // Send coupon expiration warning email if enabled
            try {
              await sendCouponExpirationWarningEmail(
                customer,
                store,
                transaction,
                daysUntilExpiry,
                channel._id, // Pass Channel ObjectId
                channel.site_url
              );
            } catch (emailError) {
              console.error(
                `⚠️  Error sending coupon expiration email:`,
                emailError
              );
              // Don't fail the job if email fails
            }

            // If actually expired today, mark as expired
            if (transaction.expiresAt <= today) {
              transaction.status = "expired";
              await transaction.save();
            }
          }
        }

        processedCount++;
        console.log(
          `✅ Processed transaction ${transaction._id} for customer ${customer._id}`
        );
      } catch (transactionError) {
        console.error(
          `❌ Error processing transaction ${transaction._id}:`,
          transactionError
        );
        failedCount++;
        errors.push({
          transactionId: transaction._id,
          error: transactionError.message,
          type: "processing",
        });
        continue;
      }
    }

    const duration = Date.now() - startTime;
    const result = {
      message: "Transaction expiration processed successfully",
      processDate: today.toDateString(),
      totalTransactions,
      processedCount,
      failedCount,
      duration,
      errors: errors.length > 0 ? errors : undefined,
    };

    console.log(`✅ Transaction expiration processing completed:`, {
      processDate: today.toDateString(),
      totalTransactions,
      processedCount,
      failedCount,
      duration: `${Math.round(duration / 1000)}s`,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("❌ Error in transaction expiration processing:", error);

    throw error; // Re-throw the error so Agenda knows the job failed
  }
}

// ============================================================
// Add Job Function with Deduplication
// ============================================================

async function addTransactionExpirationJob(jobData = {}, options = {}) {
  try {
    // Initialize Agenda if not already done
    if (!agenda) {
      await initializeAgenda();
    }

    const targetDate = jobData.targetDate
      ? new Date(jobData.targetDate)
      : new Date();
    const dateString = targetDate.toISOString().split("T")[0];

    // Create unique job ID to prevent duplicates
    const uniqueId = `transactionExpiration-${dateString}`;

    // Check if job already exists for this date
    const existingJobs = await agenda.jobs({
      name: "process transaction expiration",
      "data.uniqueId": uniqueId,
      nextRunAt: { $ne: null },
    });

    if (existingJobs.length > 0) {
      console.log(
        `⏭️  Transaction expiration job already exists for date ${dateString}, skipping duplicate`
      );
      return existingJobs[0];
    }

    // Schedule the job
    const delay = options.delay || "in 30 seconds";
    const job = await agenda.schedule(
      delay,
      "process transaction expiration",
      {
        ...jobData,
        uniqueId,
        scheduledDate: new Date().toISOString(),
        targetDate: targetDate.toISOString(),
      }
    );

    console.log(
      `📅 Transaction expiration job scheduled: ${job.attrs._id} for date: ${dateString}`
    );

    return job;
  } catch (error) {
    console.error("❌ Error adding transaction expiration job:", error);
    throw error;
  }
}

// ============================================================
// Recurring Job Setup
// ============================================================

async function setupRecurringTransactionExpirationJob() {
  try {
    if (!agenda) {
      await initializeAgenda();
    }

    // Cancel existing recurring jobs
    try {
      const existingJobs = await agenda.jobs({ name: "transaction expiration recurring" });
      if (existingJobs && existingJobs.length > 0) {
        await agenda.cancel({ name: "transaction expiration recurring" });
      }
    } catch (cancelError) {
      // Ignore cancel errors if no jobs exist
      console.warn("⚠️  Could not cancel existing recurring jobs:", cancelError.message);
    }

    // Define recurring job (runs daily at 1:00 AM)
    agenda.define("transaction expiration recurring", async (job) => {
      console.log(
        "🔄 Processing transaction expiration from recurring schedule"
      );
      await addTransactionExpirationJob({ triggeredBy: "recurring" });
    });

    // Schedule recurring job to run daily at 1:00 AM using repeatEvery
    try {
      // Check if job already exists
      const existingRecurringJobs = await agenda.jobs({ name: "transaction expiration recurring" });
      
      if (existingRecurringJobs && existingRecurringJobs.length > 0) {
        // Update existing job
        const job = existingRecurringJobs[0];
        job.repeatEvery("0 1 * * *", { skipImmediate: true });
        await job.save();
        console.log("✅ Transaction expiration recurring job updated (daily at 1:00 AM)");
      } else {
        // Create new recurring job
        const job = agenda.create("transaction expiration recurring", { triggeredBy: "recurring" });
        job.repeatEvery("0 1 * * *", { skipImmediate: true });
        await job.save();
        console.log("✅ Transaction expiration recurring job scheduled (daily at 1:00 AM)");
      }
    } catch (everyError) {
      // If scheduling fails, log warning but don't throw
      console.warn("⚠️  Could not schedule recurring job, error:", everyError.message);
      // Don't throw - let the system continue without recurring job for now
    }
  } catch (error) {
    console.error(
      "❌ Error setting up recurring transaction expiration job:",
      error
    );
    throw error;
  }
}

// ============================================================
// Graceful Shutdown
// ============================================================

async function gracefulShutdown() {
  console.log("🛑 Gracefully shutting down Transaction Expiration Agenda...");

  if (agenda) {
    await agenda.stop();
    console.log("✅ Transaction Expiration Agenda stopped");
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

  const jobs = await agenda.jobs({ name: "process transaction expiration" });
  const pending = await agenda.jobs({
    name: "process transaction expiration",
    nextRunAt: { $ne: null },
  });
  const running = await agenda.jobs({
    name: "process transaction expiration",
    lockedAt: { $ne: null },
  });
  const failed = await agenda.jobs({
    name: "process transaction expiration",
    failedAt: { $ne: null },
  });
  const completed = await agenda.jobs({
    name: "process transaction expiration",
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
    name: "process transaction expiration",
    lastFinishedAt: { $lt: cutoffDate },
  });

  console.log(`🗑️  Removed ${result} old transaction expiration jobs`);
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
      "❌ Failed to initialize Transaction Expiration Agenda on module load:",
      error
    );
  }
})();

module.exports = {
  addTransactionExpirationJob,
  setupRecurringTransactionExpirationJob,
  initializeAgenda,
  gracefulShutdown,
  getQueueStats,
  removeOldJobs,
  agenda,
};
