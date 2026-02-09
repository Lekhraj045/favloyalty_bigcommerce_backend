const mongoose = require("mongoose");

/**
 * Referral schema for Refer & Earn.
 * Tracks when a customer refers a friend by email. Referrer gets points when
 * the referred customer signs up and completes their first order (status → Completed).
 * Uses store_id + channel_id (not merchantId).
 */
const referralSchema = new mongoose.Schema(
  {
    store_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    channel_id: {
      type: Number,
      required: true,
      comment: "BigCommerce channel id; matches Customer.channel_id and Transaction.channel_id",
    },
    referral_points: {
      type: Number,
      required: true,
      default: 0,
      comment: "Points to award referrer when referral completes; from CollectSettings.referAndEarn.point",
    },
    referred_user_email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    referrer_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      comment: "Customer who sent the referral",
    },
    referred_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      comment: "Set when the referred person signs up (customer/created webhook)",
    },
    status: {
      type: String,
      enum: ["Pending", "Referred Claimed", "Completed", "Cancelled"],
      default: "Pending",
      comment:
        "Pending = created; Referred Claimed = referred signed up; Completed = referrer awarded; Cancelled = invalid/duplicate",
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for lookups
referralSchema.index({ store_id: 1, channel_id: 1 });
referralSchema.index(
  { referred_user_email: 1, store_id: 1, channel_id: 1 },
  { name: "referral_by_email_store_channel" }
);
referralSchema.index({ referrer_user_id: 1 }, { name: "referral_by_referrer" });
referralSchema.index(
  { referred_user_id: 1, store_id: 1, channel_id: 1, status: 1 },
  { name: "referral_by_referred_for_order_complete" }
);

/**
 * Find referrals by store and channel (e.g. for admin or listing).
 */
referralSchema.statics.findByStoreAndChannel = async function (
  storeId,
  channelId
) {
  const storeObjectId =
    typeof storeId === "string"
      ? new mongoose.Types.ObjectId(storeId)
      : storeId;
  return this.find({
    store_id: storeObjectId,
    channel_id: channelId,
  })
    .sort({ createdAt: -1 })
    .populate("referrer_user_id", "email firstName lastName")
    .populate("referred_user_id", "email firstName lastName")
    .lean();
};

/**
 * Find pending/claimable referrals by referred email (for customer/created webhook).
 */
referralSchema.statics.findPendingByEmailAndStoreChannel = async function (
  email,
  storeId,
  channelId
) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return [];
  const storeObjectId =
    typeof storeId === "string"
      ? new mongoose.Types.ObjectId(storeId)
      : storeId;
  return this.find({
    referred_user_email: normalizedEmail,
    store_id: storeObjectId,
    channel_id: channelId,
    status: "Pending",
    referred_user_id: null,
  }).lean();
};

/**
 * Find referrals to reward when referred customer completes order (order-completed webhook).
 */
referralSchema.statics.findClaimableByReferredCustomer = async function (
  referredCustomerId,
  storeId,
  channelId
) {
  const referredObjectId =
    typeof referredCustomerId === "string"
      ? new mongoose.Types.ObjectId(referredCustomerId)
      : referredCustomerId;
  const storeObjectId =
    typeof storeId === "string"
      ? new mongoose.Types.ObjectId(storeId)
      : storeId;
  return this.find({
    referred_user_id: referredObjectId,
    store_id: storeObjectId,
    channel_id: channelId,
    status: "Referred Claimed",
  }).lean();
};

const Referral = mongoose.model("Referral", referralSchema);

module.exports = Referral;
