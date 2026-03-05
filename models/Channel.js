const mongoose = require("mongoose");

const channelSchema = new mongoose.Schema(
  {
    store_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
    },
    channel_id: {
      type: Number,
      required: true,
    },
    channel_name: {
      type: String,
      default: null,
    },
    channel_type: {
      type: String,
      default: null,
    },
    platform: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      default: null,
    },
    setupprogress: {
      type: Number,
      default: 0,
      min: 0,
      max: 4,
    },
    pointsTierSystemCompleted: {
      type: Boolean,
      default: false,
    },
    waysToEarnCompleted: {
      type: Boolean,
      default: false,
    },
    waysToRedeemCompleted: {
      type: Boolean,
      default: false,
    },
    customiseWidgetCompleted: {
      type: Boolean,
      default: false,
    },
    // Controls whether the widget should be visible for this channel
    widget_visibility: {
      type: Boolean,
      default: true,
    },
    // Script ID (e.g. from BigCommerce) – empty by default, populated later
    script_id: {
      type: String,
      default: null,
    },
    // Default currency for this channel (ISO 4217, e.g. USD, INR) from BigCommerce channel currency assignments
    default_currency: {
      type: String,
      default: null,
    },
    // Cached storefront site URL for this channel (e.g. https://store-xxx.catalyst-sandbox-vercel.store)
    site_url: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

channelSchema.index({ store_id: 1, channel_id: 1 }, { unique: true });

channelSchema.statics.saveChannels = async function (storeId, channels) {
  if (!storeId) {
    throw new Error("Store ID is required");
  }

  if (!channels || channels.length === 0) {
    return [];
  }

  const storeObjectId =
    typeof storeId === "string"
      ? new mongoose.Types.ObjectId(storeId)
      : storeId;

  if (!mongoose.Types.ObjectId.isValid(storeObjectId)) {
    throw new Error(`Invalid store ID format: ${storeId}`);
  }

  const savedChannels = [];

  for (const channel of channels) {
    if (!channel.id) {
      continue;
    }

    try {
      const result = await this.findOneAndUpdate(
        {
          store_id: storeObjectId,
          channel_id: channel.id,
        },
        {
          $set: {
            channel_name: channel.name || null,
            channel_type: channel.type || null,
            platform: channel.platform || null,
            status: channel.status || null,
            default_currency: channel.default_currency ?? null,
          },
          $setOnInsert: {
            setupprogress: 0,
            pointsTierSystemCompleted: false,
            waysToEarnCompleted: false,
            waysToRedeemCompleted: false,
            customiseWidgetCompleted: false,
            widget_visibility: true,
            script_id: null,
          },
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
        },
      );

      savedChannels.push({
        id: result._id.toString(),
        channel_id: channel.id,
        channel_name: channel.name,
      });
    } catch (error) {
      console.error(`Error saving channel ${channel.id}:`, error.message);
    }
  }

  return savedChannels;
};

channelSchema.statics.create = async function (channelData) {
  const { storeId, channelId, channelName, channelType, platform, status } =
    channelData;

  if (!storeId || !channelId) {
    throw new Error("Store ID and Channel ID are required");
  }

  const storeObjectId =
    typeof storeId === "string"
      ? new mongoose.Types.ObjectId(storeId)
      : storeId;

  const result = await this.findOneAndUpdate(
    {
      store_id: storeObjectId,
      channel_id: channelId,
    },
    {
      $set: {
        channel_name: channelName,
        channel_type: channelType || null,
        platform: platform || null,
        status: status || null,
      },
      $setOnInsert: {
        setupprogress: 0,
        pointsTierSystemCompleted: false,
        waysToEarnCompleted: false,
        waysToRedeemCompleted: false,
        customiseWidgetCompleted: false,
        widget_visibility: true,
        script_id: null,
      },
    },
    {
      upsert: true,
      new: true,
    },
  );

  return result;
};

channelSchema.statics.findByStoreId = async function (storeId) {
  const storeObjectId =
    typeof storeId === "string"
      ? new mongoose.Types.ObjectId(storeId)
      : storeId;

  return await this.find({ store_id: storeObjectId }).sort({
    createdAt: -1,
  });
};

channelSchema.statics.findByStoreHash = async function (storeHash) {
  const Store = mongoose.model("Store");

  const store = await Store.findOne({
    store_hash: storeHash,
    is_active: true,
  });

  if (!store) {
    return [];
  }

  return await this.find({ store_id: store._id }).sort({
    createdAt: -1,
  });
};

channelSchema.statics.findByChannelId = async function (storeId, channelId) {
  const storeObjectId =
    typeof storeId === "string"
      ? new mongoose.Types.ObjectId(storeId)
      : storeId;

  return await this.findOne({
    store_id: storeObjectId,
    channel_id: channelId,
  });
};

channelSchema.statics.findById = async function (id) {
  const objectId =
    typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;

  return await this.findOne({ _id: objectId });
};

channelSchema.statics.update = async function (id, channelData) {
  const { channelName, channelType, platform, status, script_id } = channelData;

  const objectId =
    typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;

  const updateFields = {};
  if (channelName !== undefined) updateFields.channel_name = channelName;
  if (channelType !== undefined) updateFields.channel_type = channelType;
  if (platform !== undefined) updateFields.platform = platform;
  if (status !== undefined) updateFields.status = status;
  if (script_id !== undefined) updateFields.script_id = script_id;

  const channel = await this.findByIdAndUpdate(
    objectId,
    { $set: updateFields },
    { new: true },
  );

  if (!channel) {
    throw new Error("Channel not found");
  }

  return channel;
};

channelSchema.statics.deleteByStoreId = async function (storeId) {
  const storeObjectId =
    typeof storeId === "string"
      ? new mongoose.Types.ObjectId(storeId)
      : storeId;

  const result = await this.deleteMany({ store_id: storeObjectId });

  return result.deletedCount;
};

channelSchema.statics.delete = async function (id) {
  const objectId =
    typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;

  const result = await this.findByIdAndDelete(objectId);

  if (!result) {
    throw new Error("Channel not found");
  }

  return result;
};

channelSchema.statics.getChannelCount = async function (storeId) {
  const storeObjectId =
    typeof storeId === "string"
      ? new mongoose.Types.ObjectId(storeId)
      : storeId;

  return await this.countDocuments({ store_id: storeObjectId });
};

channelSchema.statics.findAllGroupedByStore = async function () {
  const Store = mongoose.model("Store");

  return await this.aggregate([
    {
      $lookup: {
        from: "stores",
        localField: "store_id",
        foreignField: "_id",
        as: "store",
      },
    },
    {
      $unwind: "$store",
    },
    {
      $match: {
        "store.is_active": true,
      },
    },
    {
      $group: {
        _id: "$store_id",
        store_id: { $first: "$store._id" },
        store_hash: { $first: "$store.store_hash" },
        email: { $first: "$store.email" },
        channel_count: { $sum: 1 },
        channel_names: {
          $push: {
            $cond: [
              { $ne: ["$channel_name", null] },
              "$channel_name",
              "$$REMOVE",
            ],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        store_id: { $toString: "$store_id" },
        store_hash: 1,
        email: 1,
        channel_count: 1,
        channel_names: {
          $reduce: {
            input: "$channel_names",
            initialValue: "",
            in: {
              $cond: [
                { $eq: ["$$value", ""] },
                "$$this",
                { $concat: ["$$value", ", ", "$$this"] },
              ],
            },
          },
        },
      },
    },
    {
      $sort: { store_hash: 1 },
    },
  ]);
};

channelSchema.statics.syncChannels = async function (storeId, newChannels) {
  if (!storeId) {
    throw new Error("Store ID is required");
  }

  if (!newChannels || newChannels.length === 0) {
    return [];
  }

  const storeObjectId =
    typeof storeId === "string"
      ? new mongoose.Types.ObjectId(storeId)
      : storeId;

  const existingChannels = await this.find(
    { store_id: storeObjectId },
    { channel_id: 1 },
  );

  const existingChannelIds = existingChannels.map((c) => c.channel_id);
  const newChannelIds = newChannels.map((c) => c.id);

  const channelsToDelete = existingChannelIds.filter(
    (id) => !newChannelIds.includes(id),
  );

  if (channelsToDelete.length > 0) {
    await this.deleteMany({
      store_id: storeObjectId,
      channel_id: { $in: channelsToDelete },
    });
  }

  const savedChannels = [];
  for (const channel of newChannels) {
    try {
      const result = await this.findOneAndUpdate(
        {
          store_id: storeObjectId,
          channel_id: channel.id,
        },
        {
          $set: {
            channel_name: channel.name,
            channel_type: channel.type || null,
            platform: channel.platform || null,
            status: channel.status || null,
            default_currency: channel.default_currency ?? null,
          },
          $setOnInsert: {
            setupprogress: 0,
            pointsTierSystemCompleted: false,
            waysToEarnCompleted: false,
            waysToRedeemCompleted: false,
            customiseWidgetCompleted: false,
            widget_visibility: true,
            script_id: null,
          },
        },
        {
          upsert: true,
          new: true,
        },
      );

      savedChannels.push({
        id: result._id.toString(),
        channel_id: channel.id,
        channel_name: channel.name,
      });
    } catch (error) {
      console.error(`Error syncing channel ${channel.id}:`, error.message);
    }
  }

  const syncedChannels = await this.find({ store_id: storeObjectId });
  return syncedChannels.map((c) => ({
    id: c._id.toString(),
    channel_id: c.channel_id,
    channel_name: c.channel_name,
  }));
};

const Channel = mongoose.model("Channel", channelSchema);

module.exports = Channel;
