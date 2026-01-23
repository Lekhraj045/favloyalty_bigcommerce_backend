const mongoose = require("mongoose");

// Email Setting Schema
const emailSettingItemSchema = new mongoose.Schema(
  {
    enable: {
      type: Boolean,
      default: false,
    },
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmailTemplate",
      default: null,
    },
  },
  { _id: false, timestamps: false }
);

const emailSettingSchema = new mongoose.Schema(
  {
    all: {
      type: emailSettingItemSchema,
      default: () => ({}),
    },
    birthday: {
      type: emailSettingItemSchema,
      default: () => ({}),
    },
    pointsExpire: {
      type: emailSettingItemSchema,
      default: () => ({}),
    },
    couponExpire: {
      type: emailSettingItemSchema,
      default: () => ({}),
    },
    festival: {
      type: emailSettingItemSchema,
      default: () => ({}),
    },
    monthlyPoints: {
      type: emailSettingItemSchema,
      default: () => ({}),
    },
    newsletter: {
      type: emailSettingItemSchema,
      default: () => ({}),
    },
    purchase: {
      type: emailSettingItemSchema,
      default: () => ({}),
    },
    referAndEarn: {
      type: emailSettingItemSchema,
      default: () => ({}),
    },
    rejoining: {
      type: emailSettingItemSchema,
      default: () => ({}),
    },
    signUp: {
      type: emailSettingItemSchema,
      default: () => ({}),
    },
    upgradedTrial: {
      type: emailSettingItemSchema,
      default: () => ({}),
    },
    profileCompletion: {
      type: emailSettingItemSchema,
      default: () => ({}),
    },
  },
  { _id: false, timestamps: false }
);

// Basic Settings Schema
const basicSettingSchema = new mongoose.Schema(
  {
    signup: {
      active: {
        type: Boolean,
        default: false,
      },
      point: {
        type: Number,
        default: 0,
      },
    },
    spent: {
      active: {
        type: Boolean,
        default: false,
      },
      point: {
        type: Number,
        default: 0,
      },
    },
    birthday: {
      active: {
        type: Boolean,
        default: false,
      },
      point: {
        type: Number,
        default: 0,
      },
    },
    subucribing: {
      // Note: keeping the typo as shown in the image
      active: {
        type: Boolean,
        default: false,
      },
      point: {
        type: Number,
        default: 0,
      },
    },
    profileComplition: {
      // Note: keeping the typo as shown in the image
      active: {
        type: Boolean,
        default: false,
      },
      point: {
        type: Number,
        default: 0,
      },
    },
  },
  { _id: false, timestamps: false }
);

// Processing Info Schema
const processingInfoSchema = new mongoose.Schema(
  {
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    jobID: {
      type: String,
      default: null,
    },
    processedCount: {
      type: Number,
      default: 0,
    },
    failedCount: {
      type: Number,
      default: 0,
    },
    totalCustomers: {
      type: Number,
      default: 0,
    },
    error: {
      type: String,
      default: null,
    },
  },
  { _id: false, timestamps: false }
);

// Event Schema
const eventItemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      default: "default",
    },
    eventDate: {
      type: Date,
      required: true,
    },
    point: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      default: "scheduled",
    },
    processingInfo: {
      type: processingInfoSchema,
      default: () => ({}),
    },
    isImmediate: {
      type: Boolean,
      default: false,
    },
  },
  { _id: true, timestamps: false }
);

const eventSchema = new mongoose.Schema(
  {
    events: {
      type: [eventItemSchema],
      default: [],
    },
    active: {
      type: Boolean,
      default: false,
    },
    metaData: {
      createdAt: {
        type: Date,
        default: Date.now,
      },
      updatedAt: {
        type: Date,
        default: Date.now,
      },
    },
  },
  { _id: false, timestamps: false }
);

// Refer and Earn Schema
const referAndEarnSchema = new mongoose.Schema(
  {
    active: {
      type: Boolean,
      default: false,
    },
    point: {
      type: Number,
      default: 0,
    },
    metaData: {
      createdAt: {
        type: Date,
        default: Date.now,
      },
      updatedAt: {
        type: Date,
        default: Date.now,
      },
    },
  },
  { _id: false, timestamps: false }
);

// Social Media Schema
const socialMediaSchema = new mongoose.Schema(
  {
    active: {
      type: Boolean,
      default: false,
    },
    metaData: {
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
  },
  { _id: false, timestamps: false }
);

// Goal Schema
const goalSchema = new mongoose.Schema(
  {
    active: {
      type: Boolean,
      default: false,
    },
    metaData: {
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
  },
  { _id: false, timestamps: false }
);

// Rejoin Schema
const rejoinSchema = new mongoose.Schema(
  {
    active: {
      type: Boolean,
      default: false,
    },
    dayOfRecall: {
      type: Number,
      default: 0,
    },
    pointRejoin: {
      type: Number,
      default: 0,
    },
    metaData: {
      createdAt: {
        type: Date,
        default: Date.now,
      },
      updatedAt: {
        type: Date,
        default: Date.now,
      },
    },
  },
  { _id: false, timestamps: false }
);

// Main Collect Settings Schema
const collectSettingsSchema = new mongoose.Schema(
  {
    store_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    channel_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Channel",
      required: true,
      index: true,
    },
    active: {
      type: Boolean,
      default: false,
    },
    point: {
      type: Number,
      default: 0,
    },
    basic: {
      type: basicSettingSchema,
      default: () => ({}),
    },
    event: {
      type: eventSchema,
      default: () => ({}),
    },
    referAndEarn: {
      type: referAndEarnSchema,
      default: () => ({}),
    },
    socialMedia: {
      type: socialMediaSchema,
      default: () => ({}),
    },
    goal: {
      type: goalSchema,
      default: () => ({}),
    },
    rejoin: {
      type: rejoinSchema,
      default: () => ({}),
    },
    emailSetting: {
      type: emailSettingSchema,
      default: () => ({}),
    },
    metaData: {
      createdAt: {
        type: Date,
        default: Date.now,
      },
      updatedAt: {
        type: Date,
        default: Date.now,
      },
    },
  },
  {
    timestamps: false, // Disable Mongoose timestamps to avoid conflict with metaData
  }
);

// Indexes
collectSettingsSchema.index({ store_id: 1, channel_id: 1 }, { unique: true });
collectSettingsSchema.index({ store_id: 1 });
collectSettingsSchema.index({ channel_id: 1 });

// Static methods
collectSettingsSchema.statics.findByStoreAndChannel = async function (
  storeId,
  channelId
) {
  const storeObjectId =
    typeof storeId === "string"
      ? new mongoose.Types.ObjectId(storeId)
      : storeId;
  const channelObjectId =
    typeof channelId === "string"
      ? new mongoose.Types.ObjectId(channelId)
      : channelId;

  return await this.findOne({
    store_id: storeObjectId,
    channel_id: channelObjectId,
  });
};

collectSettingsSchema.statics.findByStoreId = async function (storeId) {
  const storeObjectId =
    typeof storeId === "string"
      ? new mongoose.Types.ObjectId(storeId)
      : storeId;

  return await this.find({ store_id: storeObjectId });
};

collectSettingsSchema.statics.createOrUpdate = async function (
  storeId,
  channelId,
  settingsData
) {
  const storeObjectId =
    typeof storeId === "string"
      ? new mongoose.Types.ObjectId(storeId)
      : storeId;
  const channelObjectId =
    typeof channelId === "string"
      ? new mongoose.Types.ObjectId(channelId)
      : channelId;

  // Find existing document
  const existing = await this.findOne({
    store_id: storeObjectId,
    channel_id: channelObjectId,
  });

  if (existing) {
    // Update existing document - update fields individually
    if (settingsData.basic !== undefined) {
      existing.basic = settingsData.basic;
    }
    if (settingsData.event !== undefined) {
      existing.event = settingsData.event;
    }
    if (settingsData.referAndEarn !== undefined) {
      existing.referAndEarn = settingsData.referAndEarn;
    }
    if (settingsData.socialMedia !== undefined) {
      existing.socialMedia = settingsData.socialMedia;
    }
    if (settingsData.goal !== undefined) {
      existing.goal = settingsData.goal;
    }
    if (settingsData.rejoin !== undefined) {
      existing.rejoin = settingsData.rejoin;
    }
    if (settingsData.emailSetting !== undefined) {
      existing.emailSetting = settingsData.emailSetting;
    }
    if (settingsData.active !== undefined) {
      existing.active = settingsData.active;
    }
    if (settingsData.point !== undefined) {
      existing.point = settingsData.point;
    }

    // Update metaData.updatedAt manually
    if (!existing.metaData) {
      existing.metaData = {
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } else {
      existing.metaData.updatedAt = new Date();
    }

    return await existing.save();
  } else {
    // Create new document
    const newSettings = new this({
      store_id: storeObjectId,
      channel_id: channelObjectId,
      basic: settingsData.basic || {},
      event: settingsData.event || { events: [], active: false },
      referAndEarn: settingsData.referAndEarn || { active: false, point: 0 },
      socialMedia: settingsData.socialMedia || { active: false },
      goal: settingsData.goal || { active: false },
      rejoin: settingsData.rejoin || {
        active: false,
        dayOfRecall: 0,
        pointRejoin: 0,
      },
      emailSetting: settingsData.emailSetting || {},
      active: settingsData.active || false,
      point: settingsData.point || 0,
      metaData: {
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return await newSettings.save();
  }
};

const CollectSettings = mongoose.model(
  "CollectSettings",
  collectSettingsSchema
);

module.exports = CollectSettings;
