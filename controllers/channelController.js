const Channel = require("../models/Channel");
const mongoose = require("mongoose");

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
      }));

    console.log(
      `📋 Returning ${formattedChannels.length} active channels (filtered from ${channels.length} total)`
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
      (field) => field === true
    ).length;

    // Update the channel with calculated progress
    const updatedChannel = await Channel.findByIdAndUpdate(
      channelObjectId.toString(),
      { $set: { setupprogress: calculatedProgress } },
      { new: true }
    );

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
          ", "
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
      (field) => field === true
    ).length;

    // Update setupprogress (0-4)
    const updateData = {
      [fieldName]: completedValue,
      setupprogress: completedCount,
    };

    // Update the channel
    const updatedChannel = await Channel.findByIdAndUpdate(
      channelObjectId.toString(),
      { $set: updateData },
      { new: true }
    );

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

module.exports = {
  getChannels,
  updateSetupProgress,
  getSetupProgress,
  updatePageCompletionStatus,
};
