const Channel = require("../models/Channel");
const Point = require("../models/Point");
const CollectSettings = require("../models/CollectSettings");
const RedeemSettings = require("../models/RedeemSettings");
const WidgetCustomization = require("../models/WidgetCustomization");
const mongoose = require("mongoose");
const { syncChannelScript } = require("../services/bigcommerceScriptsService");
const { cancelEventJobsForChannel } = require("../queues/eventQueue");

// Get channels for a store
const getChannels = async (req, res, next) => {
  try {
    const { storeId } = req.query;

    if (!storeId) {
      return res.status(400).json({
        success: false,
        message: "Store ID is required",
      });
    }

    // Validate storeId format
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Store ID format",
      });
    }

    const storeObjectId = new mongoose.Types.ObjectId(storeId);

    // Fetch channels from database
    const channels = await Channel.findByStoreId(storeObjectId.toString());

    // Format channels to match frontend Channel type
    // Filter to only return active channels for UI display
    const formattedChannels = channels
      .filter((channel) => channel.status === "active")
      .map((channel) => ({
        id: channel._id.toString(),
        channel_id: channel.channel_id,
        channel_name: channel.channel_name,
        channel_type: channel.channel_type || null,
        platform: channel.platform || null,
        status: channel.status || null,
        setupprogress: channel.setupprogress || 0,
        pointsTierSystemCompleted: channel.pointsTierSystemCompleted || false,
        waysToEarnCompleted: channel.waysToEarnCompleted || false,
        waysToRedeemCompleted: channel.waysToRedeemCompleted || false,
        customiseWidgetCompleted: channel.customiseWidgetCompleted || false,
        widget_visibility:
          typeof channel.widget_visibility === "boolean"
            ? channel.widget_visibility
            : true,
        script_id: channel.script_id ?? null,
        default_currency: channel.default_currency ?? null,
      }));

    console.log(
      `📋 Returning ${formattedChannels.length} active channels (filtered from ${channels.length} total)`,
    );

    res.json(formattedChannels);
  } catch (error) {
    console.error("Error getting channels:", error);
    next(error);
  }
};

// Update setup progress for a channel
// Now calculates automatically from the 4 completion status fields
const updateSetupProgress = async (req, res, next) => {
  try {
    const { channelId } = req.body;

    if (!channelId) {
      return res.status(400).json({
        success: false,
        message: "Channel ID is required",
      });
    }

    // Validate channelId format
    if (!mongoose.Types.ObjectId.isValid(channelId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Channel ID format",
      });
    }

    const channelObjectId = new mongoose.Types.ObjectId(channelId);

    // Find the channel
    const channel = await Channel.findById(channelObjectId.toString());

    if (!channel) {
      return res.status(404).json({
        success: false,
        message: "Channel not found",
      });
    }

    // Calculate setupprogress based on count of true values in the 4 completion fields
    const completionFields = [
      channel.pointsTierSystemCompleted || false,
      channel.waysToEarnCompleted || false,
      channel.waysToRedeemCompleted || false,
      channel.customiseWidgetCompleted || false,
    ];

    // Count how many are true
    const calculatedProgress = completionFields.filter(
      (field) => field === true,
    ).length;

    // Determine widget visibility based on progress
    // Whenever setupprogress changes, default widget_visibility to false
    // and only set it to true when progress reaches 4
    const widgetVisibility = calculatedProgress === 4;

    // Update the channel with calculated progress and widget visibility
    const updatedChannel = await Channel.findByIdAndUpdate(
      channelObjectId.toString(),
      {
        $set: {
          setupprogress: calculatedProgress,
          widget_visibility: widgetVisibility,
        },
      },
      { new: true },
    );

    // Sync BigCommerce script: create when setupprogress 4 & widget_visibility true, else delete
    if (req.store) {
      await syncChannelScript(req.store, updatedChannel);
    }

    res.json({
      success: true,
      message: "Setup progress updated successfully",
      data: {
        channelId: updatedChannel._id.toString(),
        setupprogress: updatedChannel.setupprogress,
      },
    });
  } catch (error) {
    console.error("Error updating setup progress:", error);
    next(error);
  }
};

// Get setup progress for a channel
const getSetupProgress = async (req, res, next) => {
  try {
    const { channelId } = req.query;

    if (!channelId) {
      return res.status(400).json({
        success: false,
        message: "Channel ID is required",
      });
    }

    // Validate channelId format
    if (!mongoose.Types.ObjectId.isValid(channelId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Channel ID format",
      });
    }

    const channelObjectId = new mongoose.Types.ObjectId(channelId);

    // Find the channel
    const channel = await Channel.findById(channelObjectId.toString());

    if (!channel) {
      return res.status(404).json({
        success: false,
        message: "Channel not found",
      });
    }

    res.json({
      success: true,
      data: {
        channelId: channel._id.toString(),
        setupprogress: channel.setupprogress || 0,
      },
    });
  } catch (error) {
    console.error("Error getting setup progress:", error);
    next(error);
  }
};

// Update page completion status for a channel
const updatePageCompletionStatus = async (req, res, next) => {
  try {
    const { channelId, pageType, completed } = req.body;

    if (!channelId) {
      return res.status(400).json({
        success: false,
        message: "Channel ID is required",
      });
    }

    if (!pageType) {
      return res.status(400).json({
        success: false,
        message: "Page type is required",
      });
    }

    if (completed === undefined || completed === null) {
      return res.status(400).json({
        success: false,
        message: "Completed status is required",
      });
    }

    // Validate pageType
    const validPageTypes = [
      "pointsTierSystem",
      "waysToEarn",
      "waysToRedeem",
      "customiseWidget",
    ];
    if (!validPageTypes.includes(pageType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid page type. Must be one of: ${validPageTypes.join(
          ", ",
        )}`,
      });
    }

    // Validate channelId format
    if (!mongoose.Types.ObjectId.isValid(channelId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Channel ID format",
      });
    }

    const channelObjectId = new mongoose.Types.ObjectId(channelId);

    // Find the channel
    const channel = await Channel.findById(channelObjectId.toString());

    if (!channel) {
      return res.status(404).json({
        success: false,
        message: "Channel not found",
      });
    }

    // Map pageType to field name
    const fieldMap = {
      pointsTierSystem: "pointsTierSystemCompleted",
      waysToEarn: "waysToEarnCompleted",
      waysToRedeem: "waysToRedeemCompleted",
      customiseWidget: "customiseWidgetCompleted",
    };

    const fieldName = fieldMap[pageType];
    const completedValue = completed === true || completed === 1;

    // Calculate setupprogress based on count of true values in the 4 completion fields
    // Use the new value for the field being updated, and existing values for others
    const completionFields = {
      pointsTierSystemCompleted:
        fieldName === "pointsTierSystemCompleted"
          ? completedValue
          : channel.pointsTierSystemCompleted || false,
      waysToEarnCompleted:
        fieldName === "waysToEarnCompleted"
          ? completedValue
          : channel.waysToEarnCompleted || false,
      waysToRedeemCompleted:
        fieldName === "waysToRedeemCompleted"
          ? completedValue
          : channel.waysToRedeemCompleted || false,
      customiseWidgetCompleted:
        fieldName === "customiseWidgetCompleted"
          ? completedValue
          : channel.customiseWidgetCompleted || false,
    };

    // Count how many are true
    const completedCount = Object.values(completionFields).filter(
      (field) => field === true,
    ).length;

    // Update setupprogress (0-4) and widget visibility
    const updateData = {
      [fieldName]: completedValue,
      setupprogress: completedCount,
      // For any change, widget_visibility should be false unless setupprogress is 4
      widget_visibility: completedCount === 4,
    };

    // Update the channel
    const updatedChannel = await Channel.findByIdAndUpdate(
      channelObjectId.toString(),
      { $set: updateData },
      { new: true },
    );

    // Sync BigCommerce script: create when setupprogress 4 & widget_visibility true, else delete
    if (req.store) {
      await syncChannelScript(req.store, updatedChannel);
    }

    res.json({
      success: true,
      message: "Page completion status updated successfully",
      data: {
        channelId: updatedChannel._id.toString(),
        [fieldName]: updatedChannel[fieldName],
        setupprogress: updatedChannel.setupprogress,
      },
    });
  } catch (error) {
    console.error("Error updating page completion status:", error);
    next(error);
  }
};

// Default Point (Points & Tier System) settings - same as post-installation
const DEFAULT_POINT_SETTINGS = {
  pointName: "Points",
  customPointName: [],
  expiry: false,
  expiriesInDays: null,
  tierStatus: false,
  logo: { id: 1, src: "point-icon1.svg", name: "point-icon1.svg" },
  customLogo: null,
  tier: [
    { tierName: "Silver", pointRequired: 0, multiplier: 1, badgeColor: null },
    { tierName: "Gold", pointRequired: 1000, multiplier: 1.2, badgeColor: null },
    {
      tierName: "Platinum",
      pointRequired: 5000,
      multiplier: 1.5,
      badgeColor: null,
    },
  ],
};

// Default CollectSettings (Ways to Earn) - all disabled, no events
const DEFAULT_COLLECT_SETTINGS = {
  basic: {
    signup: { active: false, point: 0 },
    spent: { active: false, point: 0 },
    birthday: { active: false, point: 0 },
    subucribing: { active: false, point: 0 },
    profileComplition: { active: false, point: 0 },
  },
  event: { events: [], active: false },
  referAndEarn: { active: false, point: 0 },
  socialMedia: { active: false },
  goal: { active: false },
  rejoin: { active: false, dayOfRecall: 0, pointRejoin: 0 },
  emailSetting: {},
  active: false,
  point: 0,
};

// Default announcement - basic/default image only
const DEFAULT_ANNOUNCEMENT = {
  enable: true,
  image: "default_announcement.jpg",
  link: null,
};

// Default WidgetCustomization (Design/Customize Widget) - post-installation state
const DEFAULT_WIDGET_CUSTOMIZATION = {
  widgetBgColor: "#62a63f",
  headingColor: "#ffffff",
  widgetIconColor: null,
  widgetIconUrlId: null,
  LauncherType: "IconOnly",
  Label: null,
  backgroundPatternEnabled: false,
  backgroundPatternUrlId: null,
  widgetButton: "Bottom-Left",
  displayOption: [],
  announcements: [DEFAULT_ANNOUNCEMENT],
};

/**
 * Reset all 4 setup pages for a channel to default (post-installation) state.
 * Resets: Points & Tier System, Ways to Earn, Ways to Redeem, Customize Widget.
 * Sets channel completion fields to false and setupprogress to 0.
 */
const resetChannelSettings = async (req, res, next) => {
  try {
    const { channelId } = req.body;

    if (!channelId) {
      return res.status(400).json({
        success: false,
        message: "Channel ID is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(channelId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Channel ID format",
      });
    }

    const channelObjectId = new mongoose.Types.ObjectId(channelId);
    const storeId = req.store?._id;

    if (!storeId) {
      return res.status(401).json({
        success: false,
        message: "Store context is required",
      });
    }

    const storeObjectId =
      typeof storeId === "string" ? new mongoose.Types.ObjectId(storeId) : storeId;

    const channel = await Channel.findOne({
      _id: channelObjectId,
      store_id: storeObjectId,
    });

    if (!channel) {
      return res.status(404).json({
        success: false,
        message: "Channel not found or does not belong to this store",
      });
    }

    // 1) Cancel scheduled event jobs for this channel before clearing events
    await cancelEventJobsForChannel(channelId);

    // 2) Reset Points (Points & Tier System)
    await Point.findOneAndUpdate(
      { store_id: storeObjectId, channel_id: channelObjectId },
      {
        $set: {
          ...DEFAULT_POINT_SETTINGS,
          metaData: { createdAt: new Date() },
        },
      },
      { upsert: true, new: true }
    );

    // 3) Reset CollectSettings (Ways to Earn) - clear events, reset basic/refer/etc to defaults
    await CollectSettings.findOneAndUpdate(
      { store_id: storeObjectId, channel_id: channelObjectId },
      {
        $set: {
          ...DEFAULT_COLLECT_SETTINGS,
          metaData: { createdAt: new Date(), updatedAt: new Date() },
        },
      },
      { upsert: true, new: true }
    );

    // 4) Delete all RedeemSettings (coupon creation methods) for this channel
    await RedeemSettings.deleteMany({
      store_id: storeObjectId,
      channel_id: channelObjectId,
    });

    // 5) Reset WidgetCustomization - full Design settings to basic (announcements, background pattern, placement, etc.)
    const existingWidget = await WidgetCustomization.findOne({
      store_id: storeObjectId,
      channel_id: channelObjectId,
    });

    const widgetResetData = {
      ...DEFAULT_WIDGET_CUSTOMIZATION,
      metaData: {
        createdAt: existingWidget?.metaData?.createdAt || new Date(),
        updatedAt: new Date(),
      },
    };

    if (existingWidget) {
      await WidgetCustomization.findOneAndUpdate(
        { store_id: storeObjectId, channel_id: channelObjectId },
        { $set: widgetResetData },
        { new: true }
      );
    } else {
      await WidgetCustomization.createOrUpdate({
        store_id: storeObjectId.toString(),
        channel_id: channelId,
        ...DEFAULT_WIDGET_CUSTOMIZATION,
      });
    }

    // 6) Update Channel - setupprogress 0, all completion fields false, widget_visibility false
    const updatedChannel = await Channel.findByIdAndUpdate(
      channelObjectId.toString(),
      {
        $set: {
          setupprogress: 0,
          pointsTierSystemCompleted: false,
          waysToEarnCompleted: false,
          waysToRedeemCompleted: false,
          customiseWidgetCompleted: false,
          widget_visibility: false,
        },
      },
      { new: true }
    );

    // 7) Sync BigCommerce script (remove widget script since setup incomplete)
    if (req.store) {
      await syncChannelScript(req.store, updatedChannel);
    }

    res.json({
      success: true,
      message: "Channel settings reset successfully",
      data: {
        channelId: updatedChannel._id.toString(),
        setupprogress: 0,
        pointsTierSystemCompleted: false,
        waysToEarnCompleted: false,
        waysToRedeemCompleted: false,
        customiseWidgetCompleted: false,
        widget_visibility: false,
      },
    });
  } catch (error) {
    console.error("Error resetting channel settings:", error);
    next(error);
  }
};

module.exports = {
  getChannels,
  updateSetupProgress,
  getSetupProgress,
  updatePageCompletionStatus,
  resetChannelSettings,
};
