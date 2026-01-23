const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    // References
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    store_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
    },
    channel_id: {
      type: Number,
      required: true,
    },
    bcCustomerId: {
      type: Number,
      required: true,
      comment: "BigCommerce customer ID",
    },

    // Transaction Details
    type: {
      type: String,
      enum: [
        "earn",
        "redeem",
        "adjustment",
        "referral",
        "signup",
        "expiration",
        "refund",
      ],
      required: true,
    },
    transactionCategory: {
      type: String,
      enum: [
        "order",
        "manual",
        "referral",
        "signup",
        "expiration",
        "refund",
        "other",
      ],
      default: "other",
    },
    points: {
      type: Number,
      required: true,
      comment: "Positive for earn, negative for redeem",
    },
    description: {
      type: String,
      required: true,
    },
    reason: {
      type: String,
      default: null,
      comment: "For manual adjustments - e.g., 'Adjustment for customer service purposes'",
    },

    // Status & Lifecycle
    status: {
      type: String,
      enum: ["pending", "completed", "expired", "cancelled", "failed"],
      default: "completed",
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    notificationSent: {
      type: Boolean,
      default: false,
    },

    // Audit & Metadata
    adminUserId: {
      type: String,
      default: null,
      comment: "Who made manual adjustments, if applicable",
    },
    source: {
      type: String,
      default: "system",
      comment: "e.g., 'admin_panel', 'api', 'webhook', 'system'",
    },
    metadata: {
      type: Object,
      default: {},
      comment: "Flexible JSON for additional data like order details, referral info, etc.",
    },
    relatedTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
      comment: "For refunds/reversals linking to original transaction",
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
transactionSchema.index({ customerId: 1, createdAt: -1 }); // For customer transaction history
transactionSchema.index({ store_id: 1, channel_id: 1 }); // For store/channel filtering
transactionSchema.index({ bcCustomerId: 1 }); // For BigCommerce customer lookups
transactionSchema.index({ status: 1, expiresAt: 1 }); // For expiration queries
transactionSchema.index({ type: 1, status: 1 }); // For transaction type filtering
transactionSchema.index({ store_id: 1, channel_id: 1, customerId: 1 }); // Compound index for common queries

// Static methods

/**
 * Create a new transaction with validation
 */
transactionSchema.statics.createTransaction = async function (transactionData) {
  const {
    customerId,
    store_id,
    channel_id,
    bcCustomerId,
    type,
    transactionCategory,
    points,
    description,
    reason,
    status,
    expiresAt,
    notificationSent,
    adminUserId,
    source,
    metadata,
    relatedTransactionId,
  } = transactionData;

  try {
    // Validate required fields
    if (!customerId || !store_id || !channel_id || !bcCustomerId || !type || !points || !description) {
      throw new Error("Missing required transaction fields");
    }

    // Validate points sign based on type
    if (type === "earn" && points < 0) {
      throw new Error("Earn transactions must have positive points");
    }
    if (type === "redeem" && points > 0) {
      throw new Error("Redeem transactions must have negative points");
    }

    const transaction = new this({
      customerId,
      store_id,
      channel_id,
      bcCustomerId,
      type,
      transactionCategory: transactionCategory || this.getDefaultCategory(type),
      points,
      description,
      reason: reason || null,
      status: status || "completed",
      expiresAt: expiresAt || null,
      notificationSent: notificationSent || false,
      adminUserId: adminUserId || null,
      source: source || "system",
      metadata: metadata || {},
      relatedTransactionId: relatedTransactionId || null,
    });

    await transaction.save();
    return transaction;
  } catch (error) {
    console.error("❌ Error creating transaction:", error.message);
    throw error;
  }
};

/**
 * Get default transaction category based on type
 */
transactionSchema.statics.getDefaultCategory = function (type) {
  const categoryMap = {
    earn: "order",
    redeem: "order",
    adjustment: "manual",
    referral: "referral",
    signup: "signup",
    expiration: "expiration",
    refund: "refund",
  };
  return categoryMap[type] || "other";
};

/**
 * Find transactions by customer
 */
transactionSchema.statics.findByCustomer = async function (
  customerId,
  options = {}
) {
  try {
    const { limit = 50, skip = 0, sort = { createdAt: -1 }, filters = {} } = options;

    const query = { customerId };
    
    // Apply additional filters
    if (filters.type) query.type = filters.type;
    if (filters.status) query.status = filters.status;
    if (filters.transactionCategory) query.transactionCategory = filters.transactionCategory;

    const transactions = await this.find(query)
      .sort(sort)
      .limit(limit)
      .skip(skip)
      .populate("customerId", "firstName lastName email")
      .populate("store_id", "store_name store_hash")
      .lean();

    return transactions;
  } catch (error) {
    console.error("❌ Error finding transactions by customer:", error.message);
    throw error;
  }
};

/**
 * Find transactions by store and channel
 */
transactionSchema.statics.findByStoreAndChannel = async function (
  storeId,
  channelId,
  options = {}
) {
  try {
    const { limit = 50, skip = 0, sort = { createdAt: -1 }, filters = {} } = options;

    const storeObjectId =
      typeof storeId === "string"
        ? new mongoose.Types.ObjectId(storeId)
        : storeId;

    const query = {
      store_id: storeObjectId,
      channel_id: channelId,
    };

    // Apply additional filters
    if (filters.type) query.type = filters.type;
    if (filters.status) query.status = filters.status;
    if (filters.customerId) {
      query.customerId =
        typeof filters.customerId === "string"
          ? new mongoose.Types.ObjectId(filters.customerId)
          : filters.customerId;
    }

    const transactions = await this.find(query)
      .sort(sort)
      .limit(limit)
      .skip(skip)
      .populate("customerId", "firstName lastName email")
      .populate("store_id", "store_name store_hash")
      .lean();

    return transactions;
  } catch (error) {
    console.error(
      "❌ Error finding transactions by store and channel:",
      error.message
    );
    throw error;
  }
};

/**
 * Update transaction status
 */
transactionSchema.statics.updateStatus = async function (
  transactionId,
  newStatus
) {
  try {
    const transactionObjectId =
      typeof transactionId === "string"
        ? new mongoose.Types.ObjectId(transactionId)
        : transactionId;

    const validStatuses = ["pending", "completed", "expired", "cancelled", "failed"];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}`);
    }

    const transaction = await this.findByIdAndUpdate(
      transactionObjectId,
      { $set: { status: newStatus } },
      { new: true }
    );

    if (!transaction) {
      throw new Error("Transaction not found");
    }

    return transaction;
  } catch (error) {
    console.error("❌ Error updating transaction status:", error.message);
    throw error;
  }
};

/**
 * Get expired transactions
 */
transactionSchema.statics.getExpiredTransactions = async function (options = {}) {
  try {
    const { limit = 100 } = options;
    const now = new Date();

    const transactions = await this.find({
      status: "pending",
      expiresAt: { $lte: now },
    })
      .limit(limit)
      .populate("customerId", "firstName lastName email")
      .lean();

    return transactions;
  } catch (error) {
    console.error("❌ Error getting expired transactions:", error.message);
    throw error;
  }
};

const Transaction = mongoose.model("Transaction", transactionSchema);

module.exports = Transaction;
