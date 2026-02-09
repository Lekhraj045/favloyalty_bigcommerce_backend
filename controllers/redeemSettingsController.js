const RedeemSettings = require("../models/RedeemSettings");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const mongoose = require("mongoose");

// Get redeem settings
const getRedeemSettings = async (req, res, next) => {
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

    const settings = await RedeemSettings.findByStoreAndChannel(
      storeObjectId,
      channelObjectId
    );

    if (!settings || settings.length === 0) {
      return res.status(200).json([]);
    }

    res.json(settings);
  } catch (error) {
    console.error("Error getting redeem settings:", error);
    next(error);
  }
};

// Create redeem coupon
const createRedeemCoupon = async (req, res, next) => {
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

    // Prepare data for addCoupon method
    const couponData = {
      store_id: storeObjectId.toString(),
      channel_id: channelObjectId.toString(),
      redeemType: req.body.redeemType || "purchase",
      target_type: req.body.target_type || "line_item",
      pointValue: parseFloat(req.body.pointValue) || 0,
      discountAmount: parseFloat(req.body.discountAmount) || 0,
      expire: req.body.expire || null,
      selectedItems: req.body.selectedItems || [],
      selectedCollections: req.body.selectedCollections || [],
      seletedCust: req.body.seletedCust || { tier: [], tag: [] },
      seletedCustDisable: req.body.seletedCustDisable !== false, // Default true (no restriction)
      seletedProductDisable: req.body.seletedProductDisable !== false, // Default true (no restriction)
      currentRestrictionType: req.body.currentRestrictionType || "product",
      onlineStoreDashBoardDisable:
        req.body.onlineStoreDashBoardDisable !== false,
      redemptionLimitDisable: req.body.redemptionLimitDisable !== false,
      redemptionLimit: parseFloat(req.body.redemptionLimit) || 0,
      minimumnPurchaseAmount: parseFloat(req.body.minimumnPurchaseAmount) || 0,
      minimumnPurchaseAmountDisable:
        req.body.minimumnPurchaseAmountDisable !== false,
    };

    // Validate pointValue and discountAmount for percentage discount
    if (couponData.redeemType === "purchase") {
      if (
        !couponData.pointValue ||
        couponData.pointValue < 1 ||
        couponData.pointValue > 999999
      ) {
        return res.status(400).json({
          success: false,
          message: "Point value must be between 1 and 999,999",
        });
      }
      if (
        !couponData.discountAmount ||
        couponData.discountAmount < 1 ||
        couponData.discountAmount > 100
      ) {
        return res.status(400).json({
          success: false,
          message: "Discount amount must be between 1 and 100",
        });
      }
    }

    // Validate pointValue for fixed discount (storeCredit)
    if (couponData.redeemType === "storeCredit") {
      if (
        !couponData.pointValue ||
        couponData.pointValue < 1 ||
        couponData.pointValue > 100000
      ) {
        return res.status(400).json({
          success: false,
          message: "Point value must be between 1 and 100,000",
        });
      }
      // Fixed discount always has discountAmount of 1
      couponData.discountAmount = 1;

      // Validate redemptionLimit if enabled
      if (!couponData.redemptionLimitDisable && couponData.redemptionLimit) {
        if (
          couponData.redemptionLimit < 1 ||
          couponData.redemptionLimit > 100000
        ) {
          return res.status(400).json({
            success: false,
            message: "Maximum points redeemable must be between 1 and 100,000",
          });
        }
      }
    }

    // Validate pointValue for free shipping
    if (couponData.redeemType === "freeShipping") {
      if (
        !couponData.pointValue ||
        couponData.pointValue < 1 ||
        couponData.pointValue > 999999
      ) {
        return res.status(400).json({
          success: false,
          message: "Point value must be between 1 and 999,999",
        });
      }

      // Validate minimumPurchaseAmount if enabled
      if (
        !couponData.minimumnPurchaseAmountDisable &&
        couponData.minimumnPurchaseAmount
      ) {
        if (
          couponData.minimumnPurchaseAmount < 0.01 ||
          couponData.minimumnPurchaseAmount > 999999.99
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Minimum purchase amount must be between 0.01 and 999,999.99",
          });
        }
      }
    }

    // Validate free product and set pointValue from product points for list/widget display
    if (couponData.redeemType === "freeProduct") {
      // Validate that at least one product is selected
      if (!couponData.selectedItems || couponData.selectedItems.length === 0) {
        return res.status(400).json({
          success: false,
          message: "At least one product must be selected",
        });
      }

      // Validate point required for each product
      for (const item of couponData.selectedItems) {
        const points = parseInt(item.pointRequired || "0");
        if (
          !item.pointRequired ||
          isNaN(points) ||
          points < 1 ||
          points > 999999
        ) {
          return res.status(400).json({
            success: false,
            message: "All products must have valid points (1-999,999)",
          });
        }
      }
      // Use min of product points as coupon.value for Ways to Redeem list and widget
      if (!couponData.pointValue || couponData.pointValue < 1) {
        const points = couponData.selectedItems
          .map((i) => parseInt(i.pointRequired || "0", 10))
          .filter((n) => !isNaN(n) && n > 0);
        if (points.length) couponData.pointValue = Math.min(...points);
      }
    }

    // Use addCoupon method from the model
    const savedCoupon = await RedeemSettings.addCoupon(couponData);

    res.json({
      success: true,
      message: "Redeem coupon created successfully",
      data: savedCoupon,
    });
  } catch (error) {
    console.error("Error creating redeem coupon:", error);
    next(error);
  }
};

// Update redeem coupon
const updateRedeemCoupon = async (req, res, next) => {
  try {
    const { couponId } = req.body;

    if (!couponId) {
      return res.status(400).json({
        success: false,
        message: "Coupon ID is required",
      });
    }

    // Prepare update data
    const updateData = {
      couponId: couponId,
      store_id: req.body.storeId
        ? new mongoose.Types.ObjectId(req.body.storeId).toString()
        : undefined,
      channel_id: req.body.channelId
        ? new mongoose.Types.ObjectId(req.body.channelId).toString()
        : undefined,
      redeemType: req.body.redeemType,
      target_type: req.body.target_type,
      pointValue: req.body.pointValue
        ? parseFloat(req.body.pointValue)
        : undefined,
      discountAmount: req.body.discountAmount
        ? parseFloat(req.body.discountAmount)
        : undefined,
      expire: req.body.expire !== undefined ? req.body.expire : undefined,
      selectedItems: req.body.selectedItems,
      selectedCollections: req.body.selectedCollections,
      seletedCust: req.body.seletedCust,
      seletedCustDisable: req.body.seletedCustDisable,
      seletedProductDisable: req.body.seletedProductDisable,
      currentRestrictionType: req.body.currentRestrictionType,
      onlineStoreDashBoardDisable: req.body.onlineStoreDashBoardDisable,
      redemptionLimitDisable: req.body.redemptionLimitDisable,
      redemptionLimit: req.body.redemptionLimit
        ? parseFloat(req.body.redemptionLimit)
        : undefined,
      minimumnPurchaseAmount:
        req.body.minimumnPurchaseAmount !== undefined
          ? parseFloat(req.body.minimumnPurchaseAmount) || 0
          : undefined,
      minimumnPurchaseAmountDisable: req.body.minimumnPurchaseAmountDisable,
      couponActive: req.body.couponActive, // Add support for toggling active status
    };

    // Remove undefined fields
    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    // Use updateCoupon method from the model
    await RedeemSettings.updateCoupon(updateData);

    res.json({
      success: true,
      message: "Redeem coupon updated successfully",
    });
  } catch (error) {
    console.error("Error updating redeem coupon:", error);
    next(error);
  }
};

// Toggle coupon active status
const toggleCouponStatus = async (req, res, next) => {
  try {
    const { couponId, active } = req.body;

    if (!couponId || typeof active !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Coupon ID and active status are required",
      });
    }

    // Find and update the coupon's active status
    const coupon = await RedeemSettings.findById(
      new mongoose.Types.ObjectId(couponId)
    );

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
      });
    }

    // Update only the active status
    coupon.coupon.active = active;
    coupon.coupon.updatedAt = new Date();
    coupon.updatedAt = new Date();

    await coupon.save();

    res.json({
      success: true,
      message: `Coupon ${active ? "activated" : "deactivated"} successfully`,
      data: coupon,
    });
  } catch (error) {
    console.error("Error toggling coupon status:", error);
    next(error);
  }
};

// Delete redeem coupon
const deleteRedeemCoupon = async (req, res, next) => {
  try {
    const { couponId } = req.body;

    if (!couponId) {
      return res.status(400).json({
        success: false,
        message: "Coupon ID is required",
      });
    }

    // Find and delete the coupon
    const coupon = await RedeemSettings.findByIdAndDelete(
      new mongoose.Types.ObjectId(couponId)
    );

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
      });
    }

    res.json({
      success: true,
      message: "Coupon deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting coupon:", error);
    next(error);
  }
};

module.exports = {
  getRedeemSettings,
  createRedeemCoupon,
  updateRedeemCoupon,
  toggleCouponStatus,
  deleteRedeemCoupon,
};
