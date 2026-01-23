const mongoose = require("mongoose");
const ObjectID = mongoose.Types.ObjectId;
const Store = require("./Store");
const Channel = require("./Channel");

const announcementSchema = new mongoose.Schema(
  {
    enable: {
      type: Boolean,
      default: false,
    },
    image: {
      type: String,
      default: null,
    },
    link: {
      type: String,
      default: null,
    },
  },
  { _id: true, timestamps: false }
);

const displayOptionSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: true,
    },
    enable: {
      type: Boolean,
      default: false,
    },
  },
  { _id: true, timestamps: false }
);

const metaDataSchema = new mongoose.Schema(
  {
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false, timestamps: false }
);

const widgetCustomizationSchema = new mongoose.Schema(
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
    widgetIconUrlId: {
      type: String,
      default: null,
    },
    widgetIconColor: {
      type: String,
      default: null,
    },
    widgetBgColor: {
      type: String,
      default: "#62a63f",
    },
    headingColor: {
      type: String,
      default: "#ffffff",
    },
    LauncherType: {
      type: String,
      default: "IconOnly",
      enum: ["IconOnly", "LabelOnly", "Icon&Label"],
    },
    Label: {
      type: String,
      default: null,
    },
    backgroundPatternEnabled: {
      type: Boolean,
      default: false,
    },
    widgetButton: {
      type: String,
      default: "Bottom-Left",
      enum: ["Top-Left", "Top-Right", "Bottom-Left", "Bottom-Right"],
    },
    announcements: {
      type: [announcementSchema],
      default: [],
    },
    displayOption: {
      type: [displayOptionSchema],
      default: [],
    },
    backgroundPatternUrlId: {
      type: String,
      default: null,
    },
    metaData: {
      type: metaDataSchema,
      default: () => ({
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
widgetCustomizationSchema.index({ store_id: 1, channel_id: 1 });
widgetCustomizationSchema.index({ store_id: 1 });
widgetCustomizationSchema.index({ channel_id: 1 });

// Static method to find by store and channel
widgetCustomizationSchema.statics.findByStoreAndChannel = async function (
  storeId,
  channelId
) {
  const storeObjectId =
    typeof storeId === "string" ? new ObjectID(storeId) : storeId;
  const channelObjectId =
    typeof channelId === "string" ? new ObjectID(channelId) : channelId;

  return await this.findOne({
    store_id: storeObjectId,
    channel_id: channelObjectId,
  });
};

// Static method to find by store ID
widgetCustomizationSchema.statics.findByStoreId = async function (storeId) {
  const storeObjectId =
    typeof storeId === "string" ? new ObjectID(storeId) : storeId;

  return await this.find({ store_id: storeObjectId });
};

// Static method to find by channel ID
widgetCustomizationSchema.statics.findByChannelId = async function (channelId) {
  const channelObjectId =
    typeof channelId === "string" ? new ObjectID(channelId) : channelId;

  return await this.find({ channel_id: channelObjectId });
};

// Static method to create or update widget customization
widgetCustomizationSchema.statics.createOrUpdate = async function (data) {
  try {
    const storeObjectId = new ObjectID(data.store_id);
    const channelObjectId = new ObjectID(data.channel_id);

    // Check if widget customization exists
    const existing = await this.findOne({
      store_id: storeObjectId,
      channel_id: channelObjectId,
    });

    const widgetData = {
      store_id: storeObjectId,
      channel_id: channelObjectId,
      widgetIconUrlId: data.widgetIconUrlId || null,
      widgetIconColor: data.widgetIconColor || null,
      widgetBgColor: data.widgetBgColor || "#62a63f",
      headingColor: data.headingColor || "#ffffff",
      LauncherType: data.LauncherType || "IconOnly",
      Label: data.Label || null,
      backgroundPatternEnabled: data.backgroundPatternEnabled || false,
      widgetButton: data.widgetButton || "Bottom-Left",
      announcements: data.announcements || [],
      displayOption: data.displayOption || [],
      backgroundPatternUrlId: data.backgroundPatternUrlId || null,
      metaData: {
        createdAt: existing?.metaData?.createdAt || new Date(),
        updatedAt: new Date(),
      },
    };

    if (existing) {
      // Update existing
      return await this.findOneAndUpdate(
        { store_id: storeObjectId, channel_id: channelObjectId },
        widgetData,
        { new: true, runValidators: true }
      );
    } else {
      // Create new
      const widget = new this(widgetData);
      return await widget.save();
    }
  } catch (error) {
    console.error("Error creating/updating widget customization:", error);
    throw error;
  }
};

widgetCustomizationSchema.get("strict");

module.exports = mongoose.model("WidgetCustomization", widgetCustomizationSchema, "widget-designs");

