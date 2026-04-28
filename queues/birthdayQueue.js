// queues/birthdayQueue.js
const { Agenda } = require("@hokify/agenda");
const mongoose = require("mongoose");

// Import required models and modules
const Customer = require("../models/Customer");
const Point = require("../models/Point");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const {
  sendBirthdayEmail,
  sendProfileCompletionEmail,
  sendNewsletterSubscriptionEmail,
  sendSignUpEmail,
  sendReferAndEarnEmail,
  sendReferralInvitationEmail,
  sendTierUpgradeEmail,
  sendRejoiningEmail,
  getExpiryDate,
} = require("../helpers/emailHelpers");
const { processAllStoresBirthdayPoints } = require("../helpers/birthdayRewardHelper");

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
    await new Promise((resolve) => setTimeout(resolve, 1000));

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

    // One-off job: send birthday email to customer (scheduled a few seconds after widget awards points)
    agenda.define("send birthday email to customer", async (job) => {
      const data = job.attrs.data || {};
      return await sendBirthdayEmailJob(data);
    });

    // One-off job: send profile completion email to customer (scheduled after widget awards points)
    agenda.define("send profile completion email to customer", async (job) => {
      const data = job.attrs.data || {};
      return await sendProfileCompletionEmailJob(data);
    });

    // One-off job: send newsletter subscription email to customer (scheduled after widget awards points)
    agenda.define(
      "send newsletter subscription email to customer",
      async (job) => {
        const data = job.attrs.data || {};
        return await sendNewsletterSubscriptionEmailJob(data);
      },
    );

    // One-off job: send sign-up email to customer (scheduled after webhook awards points)
    agenda.define("send sign up email to customer", async (job) => {
      const data = job.attrs.data || {};
      return await sendSignUpEmailJob(data);
    });

    // One-off job: send Refer & Earn reward email to customer (scheduled after referral points are awarded)
    agenda.define("send refer and earn email to customer", async (job) => {
      const data = job.attrs.data || {};
      return await sendReferAndEarnEmailJob(data);
    });

    // One-off job: send referral invitation email to the referred person (scheduled after referrer submits email)
    agenda.define("send referral invitation email to referred", async (job) => {
      const data = job.attrs.data || {};
      return await sendReferralInvitationEmailJob(data);
    });

    // One-off job: send tier upgrade email to customer (scheduled after tier is upgraded)
    agenda.define("send tier upgrade email to customer", async (job) => {
      const data = job.attrs.data || {};
      return await sendTierUpgradeEmailJob(data);
    });

    // One-off job: send rejoining (welcome back) email to customer (scheduled after rejoin points are awarded)
    agenda.define("send rejoining email to customer", async (job) => {
      const data = job.attrs.data || {};
      return await sendRejoiningEmailJob(data);
    });

    // Error handling - suppress common errors that occur when no jobs exist
    agenda.on("error", (error) => {
      // Only log if it's not a common "no jobs" error
      if (
        !error.message ||
        (!error.message.includes("value") && !error.message.includes("null"))
      ) {
        console.error("Birthday Agenda error:", error);
      }
    });

    agenda.on("fail", (err, job) => {
      console.error(
        `Birthday Job ${job.attrs.name} failed with error:`,
        err.message,
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

  try {
    console.log("🔄 Processing birthday points job (store timezone + shared helper)");

    const targetDate = jobData.targetDate
      ? new Date(jobData.targetDate)
      : new Date();

    const summary = await processAllStoresBirthdayPoints();

    const duration = Date.now() - startTime;
    const result = {
      message: "Birthday points processed successfully",
      processDate: targetDate.toISOString().split("T")[0],
      storesScanned: summary.stores,
      candidatesProcessed: summary.processed,
      awardedCount: summary.awarded,
      failedCount: summary.failed,
      duration,
    };

    console.log("✅ Birthday points processing completed:", result);

    return result;
  } catch (error) {
    console.error("❌ Error in birthday points processing:", error);
    throw error;
  }
}

// ============================================================
// Send Birthday Email Job (one-off, scheduled after widget awards points)
// ============================================================

async function sendBirthdayEmailJob(jobData = {}) {
  const { customerId, storeId, channelId, birthdayPoints } = jobData;
  if (!customerId || !storeId || !channelId || birthdayPoints == null) {
    console.warn(
      "[BirthdayQueue] send birthday email job: missing required data",
    );
    return;
  }
  try {
    const customer = await Customer.findById(customerId);
    if (!customer) {
      console.warn(
        "[BirthdayQueue] send birthday email job: customer not found",
        customerId,
      );
      return;
    }
    const store = await Store.findById(storeId);
    if (!store) {
      console.warn(
        "[BirthdayQueue] send birthday email job: store not found",
        storeId,
      );
      return;
    }
    const channel = await Channel.findById(channelId);
    if (!channel) {
      console.warn(
        "[BirthdayQueue] send birthday email job: channel not found",
        channelId,
      );
      return;
    }
    const pointModel = await Point.findOne({
      store_id: store._id,
      channel_id: channel._id,
    });
    const sent = await sendBirthdayEmail(
      customer,
      store,
      pointModel || { pointName: "Points" },
      Number(birthdayPoints),
      channel._id,
      channel.site_url
    );
    if (sent) {
      console.log(
        `✅ Birthday email sent to customer ${customer._id} (${customer.email})`,
      );
    }
  } catch (err) {
    console.error(
      "[BirthdayQueue] send birthday email job failed:",
      err.message,
    );
  }
}

// ============================================================
// Send Profile Completion Email Job (one-off, scheduled after widget awards points)
// ============================================================

async function sendProfileCompletionEmailJob(jobData = {}) {
  const { customerId, storeId, channelId, profileCompletionPoints } = jobData;
  if (
    !customerId ||
    !storeId ||
    !channelId ||
    profileCompletionPoints == null
  ) {
    console.warn(
      "[BirthdayQueue] send profile completion email job: missing required data",
    );
    return;
  }
  try {
    const customer = await Customer.findById(customerId);
    if (!customer) {
      console.warn(
        "[BirthdayQueue] send profile completion email job: customer not found",
        customerId,
      );
      return;
    }
    const store = await Store.findById(storeId);
    if (!store) {
      console.warn(
        "[BirthdayQueue] send profile completion email job: store not found",
        storeId,
      );
      return;
    }
    const channel = await Channel.findById(channelId);
    if (!channel) {
      console.warn(
        "[BirthdayQueue] send profile completion email job: channel not found",
        channelId,
      );
      return;
    }
    const pointModel = await Point.findOne({
      store_id: store._id,
      channel_id: channel._id,
    });
    const sent = await sendProfileCompletionEmail(
      customer,
      store,
      pointModel || { pointName: "Points" },
      Number(profileCompletionPoints),
      channel._id,
      channel.site_url
    );
    if (sent) {
      console.log(
        `✅ Profile completion email sent to customer ${customer._id} (${customer.email})`,
      );
    }
  } catch (err) {
    console.error(
      "[BirthdayQueue] send profile completion email job failed:",
      err.message,
    );
  }
}

// ============================================================
// Send Refer & Earn reward email Job (one-off, scheduled after referral points are awarded)
// ============================================================

async function sendReferAndEarnEmailJob(jobData = {}) {
  const { customerId, storeId, channelId, referralPoints } = jobData;
  if (!customerId || !storeId || !channelId || referralPoints == null) {
    console.warn(
      "[BirthdayQueue] send refer & earn email job: missing required data",
    );
    return;
  }
  try {
    const customer = await Customer.findById(customerId);
    if (!customer) {
      console.warn(
        "[BirthdayQueue] send refer & earn email job: customer not found",
        customerId,
      );
      return;
    }
    const store = await Store.findById(storeId);
    if (!store) {
      console.warn(
        "[BirthdayQueue] send refer & earn email job: store not found",
        storeId,
      );
      return;
    }
    const channel = await Channel.findById(channelId);
    if (!channel) {
      console.warn(
        "[BirthdayQueue] send refer & earn email job: channel not found",
        channelId,
      );
      return;
    }
    const pointModel = await Point.findOne({
      store_id: store._id,
      channel_id: channel._id,
    });
    const sent = await sendReferAndEarnEmail(
      customer,
      store,
      pointModel || { pointName: "Points" },
      Number(referralPoints),
      channel._id,
      channel.site_url
    );
    if (sent) {
      console.log(
        `✅ Refer & Earn email sent to customer ${customer._id} (${customer.email})`,
      );
    }
  } catch (err) {
    console.error(
      "[BirthdayQueue] send refer & earn email job failed:",
      err.message,
    );
  }
}

// ============================================================
// Send referral invitation email to referred person (one-off, when referrer submits email)
// ============================================================

async function sendReferralInvitationEmailJob(jobData = {}) {
  const { referrerCustomerId, referredEmail, storeId, channelId } = jobData;
  if (!referrerCustomerId || !referredEmail || !storeId || !channelId) {
    console.warn(
      "[BirthdayQueue] send referral invitation email job: missing required data",
    );
    return;
  }
  try {
    const referrer = await Customer.findById(referrerCustomerId);
    if (!referrer) {
      console.warn(
        "[BirthdayQueue] send referral invitation email job: referrer customer not found",
        referrerCustomerId,
      );
      return;
    }
    const store = await Store.findById(storeId);
    if (!store) {
      console.warn(
        "[BirthdayQueue] send referral invitation email job: store not found",
        storeId,
      );
      return;
    }
    const channel = await Channel.findById(channelId);
    if (!channel) {
      console.warn(
        "[BirthdayQueue] send referral invitation email job: channel not found",
        channelId,
      );
      return;
    }
    const sent = await sendReferralInvitationEmail(
      referrer,
      referredEmail,
      store,
      channel._id,
    );
    if (sent) {
      console.log(
        `✅ Referral invitation email sent to ${referredEmail} (invited by ${referrer._id})`,
      );
    }
  } catch (err) {
    console.error(
      "[BirthdayQueue] send referral invitation email job failed:",
      err.message,
    );
  }
}

// Send Newsletter Subscription Email Job (one-off, scheduled after widget awards points)
async function sendNewsletterSubscriptionEmailJob(jobData = {}) {
  const { customerId, storeId, channelId, newsletterPoints } = jobData;
  if (!customerId || !storeId || !channelId || newsletterPoints == null) {
    console.warn(
      "[BirthdayQueue] send newsletter subscription email job: missing required data",
    );
    return;
  }
  try {
    const customer = await Customer.findById(customerId);
    if (!customer) {
      console.warn(
        "[BirthdayQueue] send newsletter subscription email job: customer not found",
        customerId,
      );
      return;
    }
    const store = await Store.findById(storeId);
    if (!store) {
      console.warn(
        "[BirthdayQueue] send newsletter subscription email job: store not found",
        storeId,
      );
      return;
    }
    const channel = await Channel.findById(channelId);
    if (!channel) {
      console.warn(
        "[BirthdayQueue] send newsletter subscription email job: channel not found",
        channelId,
      );
      return;
    }
    const pointModel = await Point.findOne({
      store_id: store._id,
      channel_id: channel._id,
    });
    const sent = await sendNewsletterSubscriptionEmail(
      customer,
      store,
      pointModel || { pointName: "Points" },
      Number(newsletterPoints),
      channel._id,
      channel.site_url
    );
    if (sent) {
      console.log(
        `✅ Newsletter subscription email sent to customer ${customer._id} (${customer.email})`,
      );
    }
  } catch (err) {
    console.error(
      "[BirthdayQueue] send newsletter subscription email job failed:",
      err.message,
    );
  }
}

// ============================================================
// Send Tier Upgrade Email Job (one-off, scheduled after tier is upgraded)
// ============================================================

async function sendTierUpgradeEmailJob(jobData = {}) {
  const { customerId, storeId, channelId, newTierName, newTierIndex } = jobData;
  if (!customerId || !storeId || !channelId || !newTierName) {
    console.warn(
      "[BirthdayQueue] send tier upgrade email job: missing required data",
    );
    return;
  }
  try {
    const customer = await Customer.findById(customerId);
    if (!customer) {
      console.warn(
        "[BirthdayQueue] send tier upgrade email job: customer not found",
        customerId,
      );
      return;
    }
    const store = await Store.findById(storeId);
    if (!store) {
      console.warn(
        "[BirthdayQueue] send tier upgrade email job: store not found",
        storeId,
      );
      return;
    }
    const channel = await Channel.findById(channelId);
    if (!channel) {
      console.warn(
        "[BirthdayQueue] send tier upgrade email job: channel not found",
        channelId,
      );
      return;
    }
    const pointModel = await Point.findOne({
      store_id: store._id,
      channel_id: channel._id,
    });

    // CRITICAL: Only send if tier system is enabled
    if (!pointModel || !pointModel.tierStatus) {
      console.log(
        `[BirthdayQueue] Tier system not enabled for store ${storeId}, skipping tier upgrade email`,
      );
      return;
    }

    const sent = await sendTierUpgradeEmail(
      customer,
      store,
      pointModel,
      newTierName,
      channel._id,
      channel.site_url
    );
    if (sent) {
      console.log(
        `✅ Tier upgrade email sent to customer ${customer._id} (${customer.email}) for tier "${newTierName}"`,
      );
    }
  } catch (err) {
    console.error(
      "[BirthdayQueue] send tier upgrade email job failed:",
      err.message,
    );
  }
}

// Send Sign-Up Email Job (one-off, scheduled after webhook awards points)
async function sendSignUpEmailJob(jobData = {}) {
  const { customerId, storeId, channelId, signupPoints } = jobData;
  if (!customerId || !storeId || !channelId || signupPoints == null) {
    console.warn(
      "[BirthdayQueue] send sign-up email job: missing required data",
    );
    return;
  }
  try {
    const customer = await Customer.findById(customerId);
    if (!customer) {
      console.warn(
        "[BirthdayQueue] send sign-up email job: customer not found",
        customerId,
      );
      return;
    }
    const store = await Store.findById(storeId);
    if (!store) {
      console.warn(
        "[BirthdayQueue] send sign-up email job: store not found",
        storeId,
      );
      return;
    }
    const channel = await Channel.findById(channelId);
    if (!channel) {
      console.warn(
        "[BirthdayQueue] send sign-up email job: channel not found",
        channelId,
      );
      return;
    }
    const pointModel = await Point.findOne({
      store_id: store._id,
      channel_id: channel._id,
    });
    const sent = await sendSignUpEmail(
      customer,
      store,
      pointModel || { pointName: "Points" },
      Number(signupPoints),
      channel._id,
      channel.site_url
    );
    if (sent) {
      console.log(
        `✅ Sign-up email sent to customer ${customer._id} (${customer.email})`,
      );
    }
  } catch (err) {
    console.error(
      "[BirthdayQueue] send sign-up email job failed:",
      err.message,
    );
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
        `⏭️  Birthday points job already exists for date ${dateString}, skipping duplicate`,
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
      `📅 Birthday points job scheduled: ${job.attrs._id} for date: ${dateString}`,
    );

    return job;
  } catch (error) {
    console.error("❌ Error adding birthday points job:", error);
    throw error;
  }
}

// Schedule one-off "send birthday email to customer" (e.g. 5 seconds after widget awards points)
async function addBirthdayEmailJob(data = {}, options = {}) {
  const delayMs = 5 * 1000;
  const scheduleTime = new Date(Date.now() + delayMs);
  const jobData = {
    customerId: data.customerId,
    storeId: data.storeId,
    channelId: data.channelId,
    birthdayPoints: data.birthdayPoints,
  };
  try {
    if (!agenda) await initializeAgenda();
    const job = await agenda.schedule(
      scheduleTime,
      "send birthday email to customer",
      jobData,
    );
    console.log(
      `📧 Birthday email job scheduled: ${job.attrs._id} for customer ${data.customerId} (in 5 seconds)`,
    );
    return job;
  } catch (agendaError) {
    console.warn(
      "⚠️ Agenda scheduling failed, using setTimeout fallback:",
      agendaError.message,
    );
    setTimeout(() => {
      sendBirthdayEmailJob(jobData).catch((err) =>
        console.error(
          "[BirthdayQueue] setTimeout fallback failed:",
          err.message,
        ),
      );
    }, delayMs);
    console.log(
      `📧 Birthday email scheduled via setTimeout for customer ${data.customerId} (in 5 seconds)`,
    );
    return null;
  }
}

// Schedule one-off "send profile completion email to customer" (e.g. 5 seconds after widget awards points)
async function addProfileCompletionEmailJob(data = {}, options = {}) {
  const delayMs = 5 * 1000;
  const scheduleTime = new Date(Date.now() + delayMs);
  const jobData = {
    customerId: data.customerId,
    storeId: data.storeId,
    channelId: data.channelId,
    profileCompletionPoints: data.profileCompletionPoints,
  };
  try {
    if (!agenda) await initializeAgenda();
    const job = await agenda.schedule(
      scheduleTime,
      "send profile completion email to customer",
      jobData,
    );
    console.log(
      `📧 Profile completion email job scheduled: ${job.attrs._id} for customer ${data.customerId} (in 5 seconds)`,
    );
    return job;
  } catch (agendaError) {
    console.warn(
      "⚠️ Agenda scheduling failed for profile completion email, using setTimeout fallback:",
      agendaError.message,
    );
    setTimeout(() => {
      sendProfileCompletionEmailJob(jobData).catch((err) =>
        console.error(
          "[BirthdayQueue] setTimeout fallback profile completion email failed:",
          err.message,
        ),
      );
    }, delayMs);
    console.log(
      `📧 Profile completion email scheduled via setTimeout for customer ${data.customerId} (in 5 seconds)`,
    );
    return null;
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
      const existingJobs = await agenda.jobs({
        name: "birthday points recurring",
      });
      if (existingJobs && existingJobs.length > 0) {
        await agenda.cancel({ name: "birthday points recurring" });
      }
    } catch (cancelError) {
      // Ignore cancel errors if no jobs exist
      console.warn(
        "⚠️  Could not cancel existing recurring jobs:",
        cancelError.message,
      );
    }

    // Define recurring job (runs daily at 9:00 AM)
    agenda.define("birthday points recurring", async (job) => {
      console.log("🔄 Checking for birthdays from recurring schedule");
      await addBirthdayPointsJob({ triggeredBy: "recurring" });
    });

    // Schedule recurring job to run daily at 9:00 AM using repeatEvery
    try {
      // Check if job already exists
      const existingRecurringJobs = await agenda.jobs({
        name: "birthday points recurring",
      });

      if (existingRecurringJobs && existingRecurringJobs.length > 0) {
        // Update existing job
        const job = existingRecurringJobs[0];
        job.repeatEvery("0 9 * * *", { skipImmediate: true });
        await job.save();
        console.log(
          "✅ Birthday points recurring job updated (daily at 9:00 AM)",
        );
      } else {
        // Create new recurring job
        const job = agenda.create("birthday points recurring", {
          triggeredBy: "recurring",
        });
        job.repeatEvery("0 9 * * *", { skipImmediate: true });
        await job.save();
        console.log(
          "✅ Birthday points recurring job scheduled (daily at 9:00 AM)",
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
      error,
    );
  }
})();

// Schedule one-off "send newsletter subscription email to customer" – ensure exported (see also definition above)
async function addNewsletterSubscriptionEmailJob(data = {}, options = {}) {
  const delayMs = 5 * 1000;
  const scheduleTime = new Date(Date.now() + delayMs);
  const jobData = {
    customerId: data.customerId,
    storeId: data.storeId,
    channelId: data.channelId,
    newsletterPoints: data.newsletterPoints,
  };
  try {
    if (!agenda) await initializeAgenda();
    const job = await agenda.schedule(
      scheduleTime,
      "send newsletter subscription email to customer",
      jobData,
    );
    console.log(
      "📧 Newsletter subscription email job scheduled: " +
        job.attrs._id +
        " for customer " +
        data.customerId +
        " (in 5 seconds)",
    );
    return job;
  } catch (agendaError) {
    console.warn(
      "⚠️ Agenda scheduling failed for newsletter subscription email, using setTimeout fallback:",
      agendaError.message,
    );
    setTimeout(function () {
      sendNewsletterSubscriptionEmailJob(jobData).catch(function (err) {
        console.error(
          "[BirthdayQueue] setTimeout fallback newsletter subscription email failed:",
          err.message,
        );
      });
    }, delayMs);
    console.log(
      "📧 Newsletter subscription email scheduled via setTimeout for customer " +
        data.customerId +
        " (in 5 seconds)",
    );
    return null;
  }
}

// Schedule one-off "send sign-up email to customer" (e.g. 5 seconds after webhook awards points)
async function addSignUpEmailJob(data = {}, options = {}) {
  const delayMs = 5 * 1000;
  const scheduleTime = new Date(Date.now() + delayMs);
  const jobData = {
    customerId: data.customerId,
    storeId: data.storeId,
    channelId: data.channelId,
    signupPoints: data.signupPoints,
  };
  try {
    if (!agenda) await initializeAgenda();
    const job = await agenda.schedule(
      scheduleTime,
      "send sign up email to customer",
      jobData,
    );
    console.log(
      "📧 Sign-up email job scheduled: " +
        job.attrs._id +
        " for customer " +
        data.customerId +
        " (in 5 seconds)",
    );
    return job;
  } catch (agendaError) {
    console.warn(
      "⚠️ Agenda scheduling failed for sign-up email, using setTimeout fallback:",
      agendaError.message,
    );
    setTimeout(function () {
      sendSignUpEmailJob(jobData).catch(function (err) {
        console.error(
          "[BirthdayQueue] setTimeout fallback sign-up email failed:",
          err.message,
        );
      });
    }, delayMs);
    console.log(
      "📧 Sign-up email scheduled via setTimeout for customer " +
        data.customerId +
        " (in 5 seconds)",
    );
    return null;
  }
}

// Schedule one-off \"send refer & earn email to customer\" (e.g. 5 seconds after referral points are awarded)
async function addReferAndEarnEmailJob(data = {}, options = {}) {
  const delayMs = 5 * 1000;
  const scheduleTime = new Date(Date.now() + delayMs);
  const jobData = {
    customerId: data.customerId,
    storeId: data.storeId,
    channelId: data.channelId,
    referralPoints: data.referralPoints,
  };
  try {
    if (!agenda) await initializeAgenda();
    const job = await agenda.schedule(
      scheduleTime,
      "send refer and earn email to customer",
      jobData,
    );
    console.log(
      "📧 Refer & Earn email job scheduled: " +
        job.attrs._id +
        " for customer " +
        data.customerId +
        " (in 5 seconds)",
    );
    return job;
  } catch (agendaError) {
    console.warn(
      "⚠️ Agenda scheduling failed for refer & earn email, using setTimeout fallback:",
      agendaError.message,
    );
    setTimeout(function () {
      sendReferAndEarnEmailJob(jobData).catch(function (err) {
        console.error(
          "[BirthdayQueue] setTimeout fallback refer & earn email failed:",
          err.message,
        );
      });
    }, delayMs);
    console.log(
      "📧 Refer & Earn email scheduled via setTimeout for customer " +
        data.customerId +
        " (in 5 seconds)",
    );
    return null;
  }
}

// Schedule one-off referral invitation email (to the referred person, when referrer submits)
async function addReferralInvitationEmailJob(data = {}, options = {}) {
  const delayMs = 5 * 1000;
  const scheduleTime = new Date(Date.now() + delayMs);
  const jobData = {
    referrerCustomerId: data.referrerCustomerId,
    referredEmail: data.referredEmail,
    storeId: data.storeId,
    channelId: data.channelId,
  };
  try {
    if (!agenda) await initializeAgenda();
    const job = await agenda.schedule(
      scheduleTime,
      "send referral invitation email to referred",
      jobData,
    );
    console.log(
      "📧 Referral invitation email job scheduled: " +
        job.attrs._id +
        " for " +
        data.referredEmail +
        " (in 5 seconds)",
    );
    return job;
  } catch (agendaError) {
    console.warn(
      "⚠️ Agenda scheduling failed for referral invitation email, using setTimeout fallback:",
      agendaError.message,
    );
    setTimeout(function () {
      sendReferralInvitationEmailJob(jobData).catch(function (err) {
        console.error(
          "[BirthdayQueue] setTimeout fallback referral invitation email failed:",
          err.message,
        );
      });
    }, delayMs);
    console.log(
      "📧 Referral invitation email scheduled via setTimeout for " +
        data.referredEmail +
        " (in 5 seconds)",
    );
    return null;
  }
}

// Schedule one-off "send tier upgrade email to customer" (e.g. 5 seconds after tier is upgraded)
async function addTierUpgradeEmailJob(data = {}, options = {}) {
  const delayMs = 5 * 1000;
  const scheduleTime = new Date(Date.now() + delayMs);
  const jobData = {
    customerId: data.customerId,
    storeId: data.storeId,
    channelId: data.channelId,
    newTierName: data.newTierName,
    newTierIndex: data.newTierIndex,
  };
  try {
    if (!agenda) await initializeAgenda();
    const job = await agenda.schedule(
      scheduleTime,
      "send tier upgrade email to customer",
      jobData,
    );
    console.log(
      `📧 Tier upgrade email job scheduled: ${job.attrs._id} for customer ${data.customerId} -> tier "${data.newTierName}" (in 5 seconds)`,
    );
    return job;
  } catch (agendaError) {
    console.warn(
      "⚠️ Agenda scheduling failed for tier upgrade email, using setTimeout fallback:",
      agendaError.message,
    );
    setTimeout(() => {
      sendTierUpgradeEmailJob(jobData).catch((err) =>
        console.error(
          "[BirthdayQueue] setTimeout fallback tier upgrade email failed:",
          err.message,
        ),
      );
    }, delayMs);
    console.log(
      `📧 Tier upgrade email scheduled via setTimeout for customer ${data.customerId} -> tier "${data.newTierName}" (in 5 seconds)`,
    );
    return null;
  }
}

// Schedule one-off birthday email job (also defined above; this ensures export works)
// Uses Date for schedule time like event queue; on Agenda failure, falls back to setTimeout (event queue pattern)
async function addBirthdayEmailJobExport(data = {}, options = {}) {
  const delayMs = 5 * 1000; // 5 seconds
  const scheduleTime = new Date(Date.now() + delayMs);
  const jobData = {
    customerId: data.customerId,
    storeId: data.storeId,
    channelId: data.channelId,
    birthdayPoints: data.birthdayPoints,
  };
  try {
    if (!agenda) await initializeAgenda();
    const job = await agenda.schedule(
      scheduleTime,
      "send birthday email to customer",
      jobData,
    );
    console.log(
      `📧 Birthday email job scheduled: ${job.attrs._id} for customer ${data.customerId} (in 5 seconds)`,
    );
    return job;
  } catch (agendaError) {
    console.warn(
      "⚠️ Agenda scheduling failed, using setTimeout fallback for birthday email:",
      agendaError.message,
    );
    setTimeout(() => {
      sendBirthdayEmailJob(jobData).catch((err) =>
        console.error(
          "[BirthdayQueue] setTimeout fallback failed:",
          err.message,
        ),
      );
    }, delayMs);
    console.log(
      `📧 Birthday email scheduled via setTimeout for customer ${data.customerId} (in 5 seconds)`,
    );
    return null;
  }
}

// ============================================================
// Send Rejoining (Welcome Back) Email Job (one-off, scheduled after rejoin points are awarded)
// ============================================================

async function sendRejoiningEmailJob(jobData = {}) {
  const { customerId, storeId, channelId, rejoiningPoints } = jobData;
  if (!customerId || !storeId || !channelId || rejoiningPoints == null) {
    console.warn(
      "[BirthdayQueue] send rejoining email job: missing required data",
    );
    return;
  }
  try {
    const customer = await Customer.findById(customerId);
    if (!customer) {
      console.warn(
        "[BirthdayQueue] send rejoining email job: customer not found",
        customerId,
      );
      return;
    }
    const store = await Store.findById(storeId);
    if (!store) {
      console.warn(
        "[BirthdayQueue] send rejoining email job: store not found",
        storeId,
      );
      return;
    }
    const channel = await Channel.findById(channelId);
    if (!channel) {
      console.warn(
        "[BirthdayQueue] send rejoining email job: channel not found",
        channelId,
      );
      return;
    }
    const pointModel = await Point.findOne({
      store_id: store._id,
      channel_id: channel._id,
    });
    const sent = await sendRejoiningEmail(
      customer,
      store,
      pointModel || { pointName: "Points" },
      Number(rejoiningPoints),
      channel._id,
      channel.site_url
    );
    if (sent) {console.log(`✅ Rejoining email sent to customer ${customer._id} (${customer.email})`)}
  } catch (err) {console.error("[BirthdayQueue] send rejoining email job failed:", err.message)}
}

// Schedule one-off "send rejoining email to customer" (e.g. 5 seconds after rejoin points are awarded)
async function addRejoiningEmailJob(data = {}, options = {}) {
  const delayMs = 5 * 1000;
  const scheduleTime = new Date(Date.now() + delayMs);
  const jobData = {
    customerId: data.customerId,
    storeId: data.storeId,
    channelId: data.channelId,
    rejoiningPoints: data.rejoiningPoints,
  };
  try {
    if (!agenda) await initializeAgenda();
    const job = await agenda.schedule(
      scheduleTime,
      "send rejoining email to customer",
      jobData,
    );
    console.log(
      `📧 Rejoining email job scheduled: ${job.attrs._id} for customer ${data.customerId} (in 5 seconds)`,
    );
    return job;
  } catch (agendaError) {
    console.warn(
      "⚠️ Agenda scheduling failed for rejoining email, using setTimeout fallback:",
      agendaError.message,
    );
    setTimeout(() => {
      sendRejoiningEmailJob(jobData).catch((err) =>
        console.error(
          "[BirthdayQueue] setTimeout fallback rejoining email failed:",
          err.message,
        ),
      );
    }, delayMs);
    console.log(
      `📧 Rejoining email scheduled via setTimeout for customer ${data.customerId} (in 5 seconds)`,
    );
    return null;
  }
}

module.exports = {
  addBirthdayPointsJob,
  addBirthdayEmailJob: addBirthdayEmailJobExport,
  addProfileCompletionEmailJob,
  addNewsletterSubscriptionEmailJob,
  addSignUpEmailJob,
  addReferAndEarnEmailJob,
  addReferralInvitationEmailJob,
  addTierUpgradeEmailJob,
  addRejoiningEmailJob,
  setupRecurringBirthdayJob,
  initializeAgenda,
  gracefulShutdown,
  getQueueStats,
  removeOldJobs,
  agenda,
};
