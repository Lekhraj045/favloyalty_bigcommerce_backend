const mongoose = require("mongoose");

// Import all Agenda queues
const {
  addEventPointsJob,
  setupRecurringEventJob,
  initializeAgenda: initializeEventAgenda,
  getQueueStats: getEventStats,
  removeOldJobs: removeOldEventJobs,
  gracefulShutdown: shutdownEventQueue,
  scheduleUpcomingEvents,
} = require("./eventQueue");

const {
  addBirthdayPointsJob,
  addBirthdayEmailJob: addBirthdayEmailJobToQueue,
  addProfileCompletionEmailJob: addProfileCompletionEmailJobToQueue,
  addNewsletterSubscriptionEmailJob: addNewsletterSubscriptionEmailJobToQueue,
  addSignUpEmailJob: addSignUpEmailJobToQueue,
  addPurchaseEmailJob: addPurchaseEmailJobToQueue,
  addReferAndEarnEmailJob: addReferAndEarnEmailJobToQueue,
  addReferralInvitationEmailJob: addReferralInvitationEmailJobToQueue,
  addTierUpgradeEmailJob: addTierUpgradeEmailJobToQueue,
  addRejoiningEmailJob: addRejoiningEmailJobToQueue,
  setupRecurringBirthdayJob,
  initializeAgenda: initializeBirthdayAgenda,
  getQueueStats: getBirthdayStats,
  removeOldJobs: removeOldBirthdayJobs,
  gracefulShutdown: shutdownBirthdayQueue,
} = require("./birthdayQueue");

const {
  addTransactionExpirationJob,
  setupRecurringTransactionExpirationJob,
  initializeAgenda: initializeTransactionAgenda,
  getQueueStats: getTransactionStats,
  removeOldJobs: removeOldTransactionJobs,
  gracefulShutdown: shutdownTransactionQueue,
} = require("./pointsExpirationQueue");

const {
  addMonthlyPointsJob,
  setupRecurringMonthlyJob,
  initializeAgenda: initializeMonthlyAgenda,
  getQueueStats: getMonthlyStats,
  removeOldJobs: removeOldMonthlyJobs,
  gracefulShutdown: shutdownMonthlyQueue,
} = require("./monthlyPointsQueue");

class QueueManager {
  constructor() {
    // All queues are Agenda-based
    this.agendaQueues = {
      event: {
        addJob: addEventPointsJob,
        setupRecurring: setupRecurringEventJob,
        initialize: initializeEventAgenda,
        getStats: getEventStats,
        removeOldJobs: removeOldEventJobs,
        shutdown: shutdownEventQueue,
        scheduleUpcoming: scheduleUpcomingEvents,
      },
      birthday: {
        addJob: addBirthdayPointsJob,
        addBirthdayEmailJob: addBirthdayEmailJobToQueue,
        addProfileCompletionEmailJob: addProfileCompletionEmailJobToQueue,
        addNewsletterSubscriptionEmailJob:
          addNewsletterSubscriptionEmailJobToQueue,
        addSignUpEmailJob: addSignUpEmailJobToQueue,
        addPurchaseEmailJob: addPurchaseEmailJobToQueue,
        addReferAndEarnEmailJob: addReferAndEarnEmailJobToQueue,
        addReferralInvitationEmailJob: addReferralInvitationEmailJobToQueue,
        addTierUpgradeEmailJob: addTierUpgradeEmailJobToQueue,
        addRejoiningEmailJob: addRejoiningEmailJobToQueue,
        setupRecurring: setupRecurringBirthdayJob,
        initialize: initializeBirthdayAgenda,
        getStats: getBirthdayStats,
        removeOldJobs: removeOldBirthdayJobs,
        shutdown: shutdownBirthdayQueue,
      },
      transactionExpiration: {
        addJob: addTransactionExpirationJob,
        setupRecurring: setupRecurringTransactionExpirationJob,
        initialize: initializeTransactionAgenda,
        getStats: getTransactionStats,
        removeOldJobs: removeOldTransactionJobs,
        shutdown: shutdownTransactionQueue,
      },
      monthlyPoints: {
        addJob: addMonthlyPointsJob,
        setupRecurring: setupRecurringMonthlyJob,
        initialize: initializeMonthlyAgenda,
        getStats: getMonthlyStats,
        removeOldJobs: removeOldMonthlyJobs,
        shutdown: shutdownMonthlyQueue,
      },
    };

    this.initializedQueues = new Set();
    this.recurringJobsSetup = new Set();
    this.isInitialized = false;
  }

  // Ensure MongoDB connection is ready
  async checkMongoConnection() {
    const maxWaitTime = 30000; // 30 seconds max wait
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      if (mongoose.connection.readyState === 1) {
        console.log("✅ MongoDB connection confirmed for QueueManager");
        return true;
      }

      console.log("⏳ MongoDB not connected, waiting...");
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds
    }

    throw new Error("MongoDB connection failed after 30 seconds");
  }

  // Initialize all Agenda queues
  async initialize() {
    try {
      console.log("🔄 Initializing Queue Manager with Agenda queues...");

      // Ensure MongoDB connection before proceeding
      await this.checkMongoConnection();

      // Initialize all Agenda queues
      console.log("🔄 Initializing all Agenda queues...");

      const initPromises = Object.entries(this.agendaQueues).map(
        async ([queueName, queueConfig]) => {
          try {
            await queueConfig.initialize();
            this.initializedQueues.add(queueName);
            console.log(`✅ ${queueName} queue initialized`);
          } catch (error) {
            console.error(`❌ Failed to initialize ${queueName} queue:`, error);
            throw error;
          }
        },
      );

      await Promise.all(initPromises);
      console.log("✅ All Agenda queues initialized successfully");

      // Setup recurring jobs for queues that support them
      await this.setupRecurringJobs();

      // Schedule upcoming events
      if (this.agendaQueues.event.scheduleUpcoming) {
        try {
          await this.agendaQueues.event.scheduleUpcoming();
        } catch (error) {
          console.error("⚠️  Error scheduling upcoming events:", error);
        }
      }

      this.isInitialized = true;
      console.log("✅ Queue Manager initialized successfully");

      return true;
    } catch (error) {
      console.error("❌ Failed to initialize Queue Manager:", error);
      throw error;
    }
  }

  // Setup recurring jobs for queues that support them
  async setupRecurringJobs() {
    console.log("🔄 Setting up recurring jobs...");

    const recurringQueues = Object.entries(this.agendaQueues).filter(
      ([_, config]) => config.setupRecurring !== null,
    );

    for (const [queueName, queueConfig] of recurringQueues) {
      try {
        await queueConfig.setupRecurring();
        this.recurringJobsSetup.add(queueName);
        console.log(`✅ Recurring jobs setup for ${queueName}`);
      } catch (error) {
        console.error(
          `❌ Failed to setup recurring jobs for ${queueName}:`,
          error,
        );
      }
    }

    console.log("✅ Recurring jobs setup completed");
  }

  // Add event job
  async addEventJob(data = {}, options = {}) {
    try {
      if (!this.initializedQueues.has("event")) {
        await this.agendaQueues.event.initialize();
        this.initializedQueues.add("event");
      }

      const jobData = {
        ...data,
        timestamp: new Date().toISOString(),
      };

      const job = await this.agendaQueues.event.addJob(jobData, options);
      console.log(`✅ Added event job: ${job.attrs._id}`);
      return job;
    } catch (error) {
      console.error("❌ Error adding event job:", error);
      throw error;
    }
  }

  // Add birthday job
  async addBirthdayJob(data = {}, options = {}) {
    try {
      if (!this.initializedQueues.has("birthday")) {
        await this.agendaQueues.birthday.initialize();
        this.initializedQueues.add("birthday");
      }

      const jobData = {
        ...data,
        timestamp: new Date().toISOString(),
      };

      const job = await this.agendaQueues.birthday.addJob(jobData, options);
      console.log(`✅ Added birthday job: ${job.attrs._id}`);
      return job;
    } catch (error) {
      console.error("❌ Error adding birthday job:", error);
      throw error;
    }
  }

  // Schedule one-off birthday email (e.g. 5 seconds after widget awards points)
  async addBirthdayEmailJob(data = {}, options = {}) {
    try {
      if (!this.initializedQueues.has("birthday")) {
        await this.agendaQueues.birthday.initialize();
        this.initializedQueues.add("birthday");
      }
      const job = await this.agendaQueues.birthday.addBirthdayEmailJob(
        data,
        options,
      );
      console.log(`✅ Scheduled birthday email job: ${job?.attrs?._id}`);
      return job;
    } catch (error) {
      console.error("❌ Error scheduling birthday email job:", error);
      throw error;
    }
  }

  // Schedule one-off profile completion email (e.g. 5 seconds after widget awards points)
  async addProfileCompletionEmailJob(data = {}, options = {}) {
    try {
      if (!this.initializedQueues.has("birthday")) {
        await this.agendaQueues.birthday.initialize();
        this.initializedQueues.add("birthday");
      }
      const job = await this.agendaQueues.birthday.addProfileCompletionEmailJob(
        data,
        options,
      );
      console.log(
        `✅ Scheduled profile completion email job: ${job?.attrs?._id}`,
      );
      return job;
    } catch (error) {
      console.error("❌ Error scheduling profile completion email job:", error);
      throw error;
    }
  }

  // Schedule one-off Refer & Earn reward email (after referral points are awarded)
  async addReferAndEarnEmailJob(data = {}, options = {}) {
    try {
      if (!this.initializedQueues.has("birthday")) {
        await this.agendaQueues.birthday.initialize();
        this.initializedQueues.add("birthday");
      }
      const job = await this.agendaQueues.birthday.addReferAndEarnEmailJob(
        data,
        options,
      );
      console.log(`✅ Scheduled refer & earn email job: ${job?.attrs?._id}`);
      return job;
    } catch (error) {
      console.error("❌ Error scheduling refer & earn email job:", error);
      throw error;
    }
  }

  // Schedule one-off referral invitation email (to the referred person, when referrer submits)
  async addReferralInvitationEmailJob(data = {}, options = {}) {
    try {
      if (!this.initializedQueues.has("birthday")) {
        await this.agendaQueues.birthday.initialize();
        this.initializedQueues.add("birthday");
      }
      const job =
        await this.agendaQueues.birthday.addReferralInvitationEmailJob(
          data,
          options,
        );
      console.log(
        `✅ Scheduled referral invitation email job: ${job?.attrs?._id}`,
      );
      return job;
    } catch (error) {
      console.error(
        "❌ Error scheduling referral invitation email job:",
        error,
      );
      throw error;
    }
  }

  // Schedule one-off newsletter subscription email (only when Loyalty Program Newsletter email is enabled for channel)
  async addNewsletterSubscriptionEmailJob(data = {}, options = {}) {
    try {
      if (!this.initializedQueues.has("birthday")) {
        await this.agendaQueues.birthday.initialize();
        this.initializedQueues.add("birthday");
      }
      const job =
        await this.agendaQueues.birthday.addNewsletterSubscriptionEmailJob(
          data,
          options,
        );
      console.log(
        `✅ Scheduled newsletter subscription email job: ${job?.attrs?._id}`,
      );
      return job;
    } catch (error) {
      console.error(
        "❌ Error scheduling newsletter subscription email job:",
        error,
      );
      throw error;
    }
  }

  // Schedule one-off sign-up email (only when Sign Up email is enabled for channel)
  async addSignUpEmailJob(data = {}, options = {}) {
    try {
      if (!this.initializedQueues.has("birthday")) {
        await this.agendaQueues.birthday.initialize();
        this.initializedQueues.add("birthday");
      }
      const job = await this.agendaQueues.birthday.addSignUpEmailJob(
        data,
        options,
      );
      console.log(`✅ Scheduled sign-up email job: ${job?.attrs?._id}`);
      return job;
    } catch (error) {
      console.error("❌ Error scheduling sign-up email job:", error);
      throw error;
    }
  }

  // Schedule one-off purchase email (only when Purchase email is enabled for channel)
  async addPurchaseEmailJob(data = {}, options = {}) {
    try {
      if (!this.initializedQueues.has("birthday")) {
        await this.agendaQueues.birthday.initialize();
        this.initializedQueues.add("birthday");
      }
      const job = await this.agendaQueues.birthday.addPurchaseEmailJob(
        data,
        options,
      );
      console.log(`✅ Scheduled purchase email job: ${job?.attrs?._id}`);
      return job;
    } catch (error) {
      console.error("❌ Error scheduling purchase email job:", error);
      throw error;
    }
  }

  // Schedule one-off tier upgrade email (when customer's tier is upgraded)
  async addTierUpgradeEmailJob(data = {}, options = {}) {
    try {
      if (!this.initializedQueues.has("birthday")) {
        await this.agendaQueues.birthday.initialize();
        this.initializedQueues.add("birthday");
      }
      const job = await this.agendaQueues.birthday.addTierUpgradeEmailJob(
        data,
        options,
      );
      console.log(
        `✅ Scheduled tier upgrade email job: ${job?.attrs?._id} for customer ${data.customerId} -> tier "${data.newTierName}"`,
      );
      return job;
    } catch (error) {
      console.error("❌ Error scheduling tier upgrade email job:", error);
      throw error;
    }
  }

  // Schedule one-off rejoining (welcome back) email (after rejoin points are awarded)
  async addRejoiningEmailJob(data = {}, options = {}) {
    try {
      if (!this.initializedQueues.has("birthday")) {
        await this.agendaQueues.birthday.initialize();
        this.initializedQueues.add("birthday");
      }
      const job = await this.agendaQueues.birthday.addRejoiningEmailJob(
        data,
        options,
      );
      console.log(
        `✅ Scheduled rejoining email job: ${job?.attrs?._id} for customer ${data.customerId}`,
      );
      return job;
    } catch (error) {
      console.error("❌ Error scheduling rejoining email job:", error);
      throw error;
    }
  }

  // Add transaction expiration job
  async addTransactionExpirationJob(data = {}, options = {}) {
    try {
      if (!this.initializedQueues.has("transactionExpiration")) {
        await this.agendaQueues.transactionExpiration.initialize();
        this.initializedQueues.add("transactionExpiration");
      }

      const jobData = {
        ...data,
        timestamp: new Date().toISOString(),
      };

      const job = await this.agendaQueues.transactionExpiration.addJob(
        jobData,
        options,
      );
      console.log(`✅ Added transaction expiration job: ${job.attrs._id}`);
      return job;
    } catch (error) {
      console.error("❌ Error adding transaction expiration job:", error);
      throw error;
    }
  }

  // Add monthly points job
  async addMonthlyPointsJob(data = {}, options = {}) {
    try {
      if (!this.initializedQueues.has("monthlyPoints")) {
        await this.agendaQueues.monthlyPoints.initialize();
        this.initializedQueues.add("monthlyPoints");
      }

      const jobData = {
        ...data,
        timestamp: new Date().toISOString(),
      };

      const job = await this.agendaQueues.monthlyPoints.addJob(
        jobData,
        options,
      );
      console.log(`✅ Added monthly points job: ${job.attrs._id}`);
      return job;
    } catch (error) {
      console.error("❌ Error adding monthly points job:", error);
      throw error;
    }
  }

  // Get comprehensive queue statistics
  async getQueueStats() {
    await this.checkMongoConnection();

    const stats = {
      lastUpdate: new Date().toISOString(),
      initializedQueues: Array.from(this.initializedQueues),
      recurringJobsSetup: Array.from(this.recurringJobsSetup),
    };

    // Get stats for all queues
    for (const [queueName, queueConfig] of Object.entries(this.agendaQueues)) {
      try {
        if (this.initializedQueues.has(queueName)) {
          const queueStats = await queueConfig.getStats();
          stats[queueName] = queueStats;
        } else {
          stats[queueName] = { status: "not_initialized" };
        }
      } catch (error) {
        console.error(`❌ Error getting stats for queue ${queueName}:`, error);
        stats[queueName] = { error: error.message };
      }
    }

    return stats;
  }

  // Clean old completed jobs from all queues
  async cleanOldJobs(maxAge = 7) {
    await this.checkMongoConnection();

    const cleanupResults = {};

    // Clean all Agenda queues
    for (const [queueName, queueConfig] of Object.entries(this.agendaQueues)) {
      try {
        if (this.initializedQueues.has(queueName)) {
          const result = await queueConfig.removeOldJobs(maxAge);
          cleanupResults[queueName] = { cleaned: result, status: "success" };
          console.log(`🗑️  Cleaned ${result} old jobs for ${queueName} queue`);
        } else {
          cleanupResults[queueName] = { status: "not_initialized" };
        }
      } catch (error) {
        console.error(`❌ Error cleaning ${queueName} queue:`, error);
        cleanupResults[queueName] = {
          status: "error",
          error: error.message,
        };
      }
    }

    return cleanupResults;
  }

  // Manually trigger a specific job type
  async triggerJob(jobType, data = {}, options = {}) {
    await this.checkMongoConnection();

    if (!this.agendaQueues[jobType]) {
      throw new Error(
        `Unknown job type: ${jobType}. Available types: ${Object.keys(
          this.agendaQueues,
        ).join(", ")}`,
      );
    }

    const triggerData = {
      ...data,
      triggerType: "manual",
      triggeredBy: "admin",
      triggeredAt: new Date().toISOString(),
    };

    // Ensure queue is initialized
    if (!this.initializedQueues.has(jobType)) {
      await this.agendaQueues[jobType].initialize();
      this.initializedQueues.add(jobType);
    }

    // Add the job
    const job = await this.agendaQueues[jobType].addJob(triggerData, options);

    console.log(`✅ Manually triggered ${jobType} job: ${job.attrs._id}`);
    return job;
  }

  // Get health check for all queues
  async getHealthCheck() {
    await this.checkMongoConnection();

    const health = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      database: {
        connected: mongoose.connection.readyState === 1,
        readyState: mongoose.connection.readyState,
      },
      queues: {},
      summary: {
        total: Object.keys(this.agendaQueues).length,
        initialized: this.initializedQueues.size,
        withRecurringJobs: this.recurringJobsSetup.size,
      },
    };

    for (const [queueName, queueConfig] of Object.entries(this.agendaQueues)) {
      try {
        if (this.initializedQueues.has(queueName)) {
          const queueStats = await queueConfig.getStats();
          health.queues[queueName] = {
            status: "healthy",
            initialized: true,
            hasRecurring: this.recurringJobsSetup.has(queueName),
            stats: queueStats,
          };
        } else {
          health.queues[queueName] = {
            status: "not_initialized",
            initialized: false,
            hasRecurring: false,
          };
        }
      } catch (error) {
        health.queues[queueName] = {
          status: "error",
          initialized: this.initializedQueues.has(queueName),
          hasRecurring: this.recurringJobsSetup.has(queueName),
          error: error.message,
        };
        health.status = "degraded";
      }
    }

    return health;
  }

  // Graceful shutdown
  async shutdown() {
    console.log("🛑 Shutting down Queue Manager...");

    // Shutdown all initialized Agenda queues
    const shutdownPromises = Array.from(this.initializedQueues).map(
      async (queueName) => {
        try {
          await this.agendaQueues[queueName].shutdown();
          console.log(`✅ ${queueName} queue shut down`);
        } catch (error) {
          console.error(`❌ Error shutting down ${queueName} queue:`, error);
        }
      },
    );

    await Promise.all(shutdownPromises);

    // Clear tracking sets
    this.initializedQueues.clear();
    this.recurringJobsSetup.clear();
    this.isInitialized = false;

    console.log("✅ Queue Manager shutdown completed");
  }
}

// Create singleton instance
const queueManager = new QueueManager();

module.exports = queueManager;
