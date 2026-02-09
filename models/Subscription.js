const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema(
  {
    store_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    plan_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Plan",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "pending", "trial", "cancelled", "expired", "suspended"],
      default: "active",
      index: true,
    },
    billingInterval: {
      type: String,
      enum: ["EVERY_30_DAYS", "EVERY_90_DAYS", "EVERY_365_DAYS"],
      default: "EVERY_30_DAYS",
    },
    orderCount: {
      type: Number,
      default: 0,
    },
    selectedOrderLimit: {
      type: Number,
      required: true,
      default: 750,
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date,
      default: null,
    },
    trialEndsAt: {
      type: Date,
      default: null,
    },
    lastBillingDate: {
      type: Date,
      default: null,
    },
    nextBillingDate: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    paypalSubscriptionId: {
      type: String,
      default: null,
      index: true,
    },
    paypalPlanId: {
      type: String,
      default: null,
    },
    paypalAgreementId: {
      type: String,
      default: null,
    },
    paypalOrderId: {
      type: String,
      default: null,
      index: true,
    },
    lastBilledOverageOrderCount: {
      type: Number,
      default: 0,
    },
    limitReached: {
      type: Boolean,
      default: false,
    },
    limitReachedAt: {
      type: Date,
      default: null,
    },
    basePrice: {
      type: Number,
      required: true,
    },
    currentPrice: {
      type: Number,
      required: true,
    },
    lastWebhookUpdate: {
      type: Date,
      default: null,
    },
    emailNotifications: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    hasPreviousSubscription: {
      type: Boolean,
      default: false,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    webhookHistory: {
      type: [
        {
          eventType: String,
          eventId: String,
          receivedAt: Date,
          payload: mongoose.Schema.Types.Mixed,
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better query performance
subscriptionSchema.index({ store_id: 1, status: 1 });
subscriptionSchema.index({ plan_id: 1 });
subscriptionSchema.index({ nextBillingDate: 1 });
subscriptionSchema.index({ paypalSubscriptionId: 1 });

// Static method to find active subscription for a store
subscriptionSchema.statics.findActiveByStore = async function (storeId) {
  try {
    return await this.findOne({
      store_id: storeId,
      status: { $in: ["active", "trial"] },
    }).populate("plan_id");
  } catch (error) {
    console.error("❌ Error finding active subscription:", error.message);
    throw error;
  }
};

// Static method to create subscription from payment
subscriptionSchema.statics.createFromPayment = async function (paymentData) {
  try {
    const {
      storeId,
      planId,
      paypalOrderId,
      amount,
      selectedOrderLimit,
      billingInterval = "EVERY_30_DAYS",
      trialDays = 14,
    } = paymentData;

    if (!storeId || !planId) {
      throw new Error("storeId and planId are required");
    }

    // Check if store has previous subscription
    const previousSubscription = await this.findOne({
      store_id: storeId,
    }).sort({ createdAt: -1 });

    const hasPreviousSubscription = !!previousSubscription;

    // Calculate dates
    const now = new Date();
    const startDate = now;
    const trialEndsAt = trialDays > 0 ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000) : null;
    
    // Calculate next billing date based on billing interval
    let nextBillingDate = new Date(now);
    if (billingInterval === "EVERY_30_DAYS") {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    } else if (billingInterval === "EVERY_90_DAYS") {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 3);
    } else if (billingInterval === "EVERY_365_DAYS") {
      nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
    }

    // Cancel any existing active subscriptions for this store
    await this.updateMany(
      {
        store_id: storeId,
        status: { $in: ["active", "trial"] },
      },
      {
        $set: {
          status: "cancelled",
          cancelledAt: now,
        },
      }
    );

    // Create new subscription
    const subscription = new this({
      store_id: storeId,
      plan_id: planId,
      status: trialDays > 0 ? "trial" : "active",
      billingInterval,
      selectedOrderLimit: selectedOrderLimit || 750,
      orderCount: 0,
      startDate,
      trialEndsAt,
      nextBillingDate,
      paypalOrderId,
      basePrice: parseFloat(amount),
      currentPrice: parseFloat(amount),
      hasPreviousSubscription,
      emailNotifications: {},
      metadata: {
        createdFromPayment: true,
        paymentDate: now,
      },
    });

    await subscription.save();
    return subscription.populate("plan_id");
  } catch (error) {
    console.error("❌ Error creating subscription from payment:", error.message);
    throw error;
  }
};

// Instance method to cancel subscription
subscriptionSchema.methods.cancel = async function () {
  this.status = "cancelled";
  this.cancelledAt = new Date();
  await this.save();
  return this;
};

// Instance method to update billing
subscriptionSchema.methods.updateBilling = async function (orderCount, overageCount) {
  this.orderCount = orderCount;
  this.lastBilledOverageOrderCount = overageCount;
  this.lastBillingDate = new Date();
  
  // Calculate next billing date
  const now = new Date();
  if (this.billingInterval === "EVERY_30_DAYS") {
    this.nextBillingDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  } else if (this.billingInterval === "EVERY_90_DAYS") {
    this.nextBillingDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  } else if (this.billingInterval === "EVERY_365_DAYS") {
    this.nextBillingDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  }
  
  await this.save();
  return this;
};

const Subscription = mongoose.model("Subscription", subscriptionSchema);

module.exports = Subscription;
