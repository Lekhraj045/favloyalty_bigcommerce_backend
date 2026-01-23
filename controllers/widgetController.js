const axios = require("axios");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const mongoose = require("mongoose");

/**
 * Get customer data for widget display
 * Fetches customer information from BigCommerce API
 */
const getCustomerData = async (req, res, next) => {
  try {
    const { customerId } = req.params;
    const { storeId, storeHash } = req.query;

    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: "Customer ID is required",
      });
    }

    // If storeHash is provided, use it; otherwise require storeId
    let store;
    if (storeHash) {
      store = await Store.findByHash(storeHash);
    } else if (storeId) {
      if (!mongoose.Types.ObjectId.isValid(storeId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid Store ID format",
        });
      }
      store = await Store.findById(storeId);
    } else {
      return res.status(400).json({
        success: false,
        message: "Store ID or Store Hash is required",
      });
    }

    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    // Fetch customer data from BigCommerce API
    try {
      const response = await axios.get(
        `https://api.bigcommerce.com/stores/${store.store_hash}/v2/customers/${customerId}`,
        {
          headers: {
            "X-Auth-Token": store.access_token,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        }
      );

      const customer = response.data;

      // TODO: Fetch actual points data from your loyalty system
      // For now, return customer data with default points
      res.json({
        success: true,
        userName: customer.first_name
          ? `${customer.first_name} ${customer.last_name || ""}`.trim()
          : customer.email || "Guest",
        name: customer.first_name
          ? `${customer.first_name} ${customer.last_name || ""}`.trim()
          : customer.email || "Guest",
        email: customer.email,
        points: 0, // TODO: Fetch from your points system
        pointsUnit: "Points", // TODO: Get from channel settings
        equivalentValue: 0, // TODO: Calculate based on points and conversion rate
        currency: store.currency || "USD",
      });
    } catch (error) {
      // If customer not found in BigCommerce, return default data
      if (error.response && error.response.status === 404) {
        return res.json({
          success: true,
          userName: "Guest",
          name: "Guest",
          email: null,
          points: 0,
          pointsUnit: "Points",
          equivalentValue: 0,
          currency: store.currency || "USD",
        });
      }

      throw error;
    }
  } catch (error) {
    console.error("Error fetching customer data:", error);

    if (error.response) {
      return res.status(error.response.status || 500).json({
        success: false,
        message: error.response.data?.title || "Failed to fetch customer data",
        error: error.response.data,
      });
    }

    next(error);
  }
};

/**
 * Check if widget should be visible based on channel setup status
 */
const checkWidgetVisibility = async (req, res, next) => {
  try {
    const { storeId, channelId } = req.query;

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

    // Get store
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    // If channelId is provided, check specific channel
    if (channelId) {
      const channel = await Channel.findOne({
        store_id: store._id,
        _id: channelId,
      });

      if (!channel) {
        return res.json({
          success: true,
          visible: false,
          reason: "Channel not found",
        });
      }

      // Check if setup is complete (all required steps completed)
      const isSetupComplete =
        channel.pointsTierSystemCompleted &&
        channel.waysToEarnCompleted &&
        channel.waysToRedeemCompleted &&
        channel.customiseWidgetCompleted;

      return res.json({
        success: true,
        visible: isSetupComplete,
        reason: isSetupComplete ? "Widget is active" : "Setup not complete",
        setupProgress: channel.setupprogress || 0,
        pointsTierSystemCompleted: channel.pointsTierSystemCompleted || false,
        waysToEarnCompleted: channel.waysToEarnCompleted || false,
        waysToRedeemCompleted: channel.waysToRedeemCompleted || false,
        customiseWidgetCompleted: channel.customiseWidgetCompleted || false,
      });
    }

    // If no channelId, check if any channel has completed setup
    const channels = await Channel.findByStoreId(storeId);
    const hasActiveChannel = channels.some(
      (channel) =>
        channel.pointsTierSystemCompleted &&
        channel.waysToEarnCompleted &&
        channel.waysToRedeemCompleted &&
        channel.customiseWidgetCompleted
    );

    return res.json({
      success: true,
      visible: hasActiveChannel,
      reason: hasActiveChannel
        ? "At least one channel is active"
        : "No active channels found",
      channelCount: channels.length,
    });
  } catch (error) {
    console.error("Error checking widget visibility:", error);
    next(error);
  }
};

module.exports = {
  getCustomerData,
  checkWidgetVisibility,
};
