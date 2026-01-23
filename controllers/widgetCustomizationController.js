const WidgetCustomization = require("../models/WidgetCustomization");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const mongoose = require("mongoose");

// Get widget customization
const getWidgetCustomization = async (req, res, next) => {
  try {
    const { storeId, channelId } = req.query;

    if (!storeId || !channelId) {
      return res.status(400).json({
        success: false,
        message: "Store ID and Channel ID are required",
      });
    }

    const storeObjectId = new mongoose.Types.ObjectId(storeId);
    const channelObjectId = new mongoose.Types.ObjectId(channelId);

    const widget = await WidgetCustomization.findByStoreAndChannel(
      storeObjectId,
      channelObjectId
    );

    if (!widget) {
      return res.status(200).json(null);
    }

    res.json(widget);
  } catch (error) {
    console.error("Error getting widget customization:", error);
    next(error);
  }
};

// Create or update widget customization
const createOrUpdateWidgetCustomization = async (req, res, next) => {
  try {
    const { storeId, channelId } = req.body;

    // Validate required fields
    if (!storeId || !channelId) {
      return res.status(400).json({
        success: false,
        message: "Store ID and Channel ID are required",
      });
    }

    // Convert string IDs to ObjectIds
    const storeObjectId = new mongoose.Types.ObjectId(storeId);
    const channelObjectId = new mongoose.Types.ObjectId(channelId);

    // Verify store and channel exist
    const store = await Store.findById(storeObjectId);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    const channel = await Channel.findById(channelObjectId);
    if (!channel) {
      return res.status(404).json({
        success: false,
        message: "Channel not found",
      });
    }

    // Prepare data for createOrUpdate method
    const widgetData = {
      store_id: storeObjectId.toString(),
      channel_id: channelObjectId.toString(),
      widgetIconUrlId: req.body.widgetIconUrlId || null,
      widgetIconColor: req.body.widgetIconColor || null,
      widgetBgColor: req.body.widgetBgColor || "#62a63f",
      headingColor: req.body.headingColor || "#ffffff",
      LauncherType: req.body.LauncherType || "IconOnly",
      Label: req.body.Label || null,
      backgroundPatternEnabled: req.body.backgroundPatternEnabled || false,
      widgetButton: req.body.widgetButton || "Bottom-Left",
      announcements: req.body.announcements || [],
      displayOption: req.body.displayOption || [],
      backgroundPatternUrlId: req.body.backgroundPatternUrlId || null,
    };

    // Use createOrUpdate method from the model
    const savedWidget = await WidgetCustomization.createOrUpdate(widgetData);

    res.json({
      success: true,
      message: "Widget customization saved successfully",
      data: savedWidget,
    });
  } catch (error) {
    console.error("Error creating/updating widget customization:", error);
    next(error);
  }
};

// Update widget customization (partial update)
const updateWidgetCustomization = async (req, res, next) => {
  try {
    const { storeId, channelId } = req.body;

    if (!storeId || !channelId) {
      return res.status(400).json({
        success: false,
        message: "Store ID and Channel ID are required",
      });
    }

    const storeObjectId = new mongoose.Types.ObjectId(storeId);
    const channelObjectId = new mongoose.Types.ObjectId(channelId);

    // Build update object with only provided fields
    const updateData = {
      "metaData.updatedAt": new Date(),
    };

    if (req.body.widgetIconUrlId !== undefined) {
      updateData.widgetIconUrlId = req.body.widgetIconUrlId;
    }
    if (req.body.widgetIconColor !== undefined) {
      updateData.widgetIconColor = req.body.widgetIconColor;
    }
    if (req.body.widgetBgColor !== undefined) {
      updateData.widgetBgColor = req.body.widgetBgColor;
    }
    if (req.body.LauncherType !== undefined) {
      updateData.LauncherType = req.body.LauncherType;
    }
    if (req.body.Label !== undefined) {
      updateData.Label = req.body.Label;
    }
    if (req.body.backgroundPatternEnabled !== undefined) {
      updateData.backgroundPatternEnabled = req.body.backgroundPatternEnabled;
    }
    if (req.body.widgetButton !== undefined) {
      updateData.widgetButton = req.body.widgetButton;
    }
    if (req.body.announcements !== undefined) {
      updateData.announcements = req.body.announcements;
    }
    if (req.body.displayOption !== undefined) {
      updateData.displayOption = req.body.displayOption;
    }
    if (req.body.backgroundPatternUrlId !== undefined) {
      updateData.backgroundPatternUrlId = req.body.backgroundPatternUrlId;
    }

    const updatedWidget = await WidgetCustomization.findOneAndUpdate(
      {
        store_id: storeObjectId,
        channel_id: channelObjectId,
      },
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedWidget) {
      return res.status(404).json({
        success: false,
        message: "Widget customization not found",
      });
    }

    res.json({
      success: true,
      message: "Widget customization updated successfully",
      data: updatedWidget,
    });
  } catch (error) {
    console.error("Error updating widget customization:", error);
    next(error);
  }
};

// Delete widget customization
const deleteWidgetCustomization = async (req, res, next) => {
  try {
    const { storeId, channelId } = req.query;

    if (!storeId || !channelId) {
      return res.status(400).json({
        success: false,
        message: "Store ID and Channel ID are required",
      });
    }

    const storeObjectId = new mongoose.Types.ObjectId(storeId);
    const channelObjectId = new mongoose.Types.ObjectId(channelId);

    const deletedWidget = await WidgetCustomization.findOneAndDelete({
      store_id: storeObjectId,
      channel_id: channelObjectId,
    });

    if (!deletedWidget) {
      return res.status(404).json({
        success: false,
        message: "Widget customization not found",
      });
    }

    res.json({
      success: true,
      message: "Widget customization deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting widget customization:", error);
    next(error);
  }
};

module.exports = {
  getWidgetCustomization,
  createOrUpdateWidgetCustomization,
  updateWidgetCustomization,
  deleteWidgetCustomization,
};

