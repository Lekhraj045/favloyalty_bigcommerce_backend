const mongoose = require("mongoose");

// Webhook Log Schema
const webhookLogSchema = new mongoose.Schema(
  {
    endpoint: {
      type: String,
      required: true,
      index: true,
    },
    method: {
      type: String,
      required: true,
      enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    },
    status: {
      type: String,
      required: true,
      enum: ["success", "error", "warning"],
      index: true,
    },
    responseCode: {
      type: Number,
      default: 200,
    },
    domain: {
      type: String,
      index: true,
    },
    store_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    channel_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Channel",
      index: true,
    },
    customerId: {
      type: String,
      index: true,
    },
    webhookType: {
      type: String,
      enum: [
        "bigcommerce",
        "subscription",
        "order",
        "customer",
        "app",
        "other",
      ],
      default: "bigcommerce",
    },
    webhookScope: {
      type: String, // e.g., "store/order/statusUpdated"
      index: true,
    },
    requestBody: {
      type: mongoose.Schema.Types.Mixed,
    },
    requestHeaders: {
      type: mongoose.Schema.Types.Mixed,
    },
    error: {
      message: String,
      stack: String,
      code: String,
    },
    processingTime: {
      type: Number, // milliseconds
      default: 0,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for efficient querying
webhookLogSchema.index({ endpoint: 1, status: 1, createdAt: -1 });
webhookLogSchema.index({ webhookType: 1, createdAt: -1 });
webhookLogSchema.index({ store_id: 1, createdAt: -1 });
webhookLogSchema.index({ channel_id: 1, createdAt: -1 });
webhookLogSchema.index({ webhookScope: 1, createdAt: -1 });
webhookLogSchema.index({ store_id: 1, webhookScope: 1, createdAt: -1 });

// TTL index to automatically delete old logs after 60 days
webhookLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 24 * 60 * 60 },
);

// Static methods
webhookLogSchema.statics.create = async function (logData) {
  try {
    const webhookLog = new this(logData);
    await webhookLog.save();
    return webhookLog;
  } catch (error) {
    console.error("❌ Error creating webhook log:", error.message);
    throw error;
  }
};

webhookLogSchema.statics.findByStoreId = async function (storeId, limit = 100) {
  try {
    const storeObjectId =
      typeof storeId === "string"
        ? new mongoose.Types.ObjectId(storeId)
        : storeId;

    return await this.find({ store_id: storeObjectId })
      .sort({ createdAt: -1 })
      .limit(limit);
  } catch (error) {
    console.error("❌ Error finding webhook logs by store ID:", error.message);
    throw error;
  }
};

webhookLogSchema.statics.findByChannelId = async function (
  channelId,
  limit = 100,
) {
  try {
    const channelObjectId =
      typeof channelId === "string"
        ? new mongoose.Types.ObjectId(channelId)
        : channelId;

    return await this.find({ channel_id: channelObjectId })
      .sort({ createdAt: -1 })
      .limit(limit);
  } catch (error) {
    console.error(
      "❌ Error finding webhook logs by channel ID:",
      error.message,
    );
    throw error;
  }
};

webhookLogSchema.statics.findByScope = async function (
  storeId,
  scope,
  limit = 100,
) {
  try {
    const storeObjectId =
      typeof storeId === "string"
        ? new mongoose.Types.ObjectId(storeId)
        : storeId;

    return await this.find({ store_id: storeObjectId, webhookScope: scope })
      .sort({ createdAt: -1 })
      .limit(limit);
  } catch (error) {
    console.error("❌ Error finding webhook logs by scope:", error.message);
    throw error;
  }
};

module.exports = WebhookLog = mongoose.model("WebhookLog", webhookLogSchema);
