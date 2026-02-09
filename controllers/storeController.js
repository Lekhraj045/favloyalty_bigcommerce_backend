const Store = require("../models/Store");
const Subscription = require("../models/Subscription");
const Plan = require("../models/Plan");
const Point = require("../models/Point");
const CollectSettings = require("../models/CollectSettings");
const RedeemSettings = require("../models/RedeemSettings");
const WidgetCustomization = require("../models/WidgetCustomization");
const { requireAuth } = require("../helpers/bigcommerce");

/**
 * Get store plan information
 */
const getStorePlan = async (req, res) => {
  try {
    const store = req.store; // From requireAuth middleware

    // Get active subscription to include limit info
    const subscription = await Subscription.findActiveByStore(store._id);

    res.json({
      success: true,
      data: {
        plan: store.plan || "free",
        trialDaysRemaining: store.trialDaysRemaining,
        paypalSubscriptionId: store.paypalSubscriptionId,
        // Subscription limit info
        limitReached: subscription?.limitReached || false,
        orderCount: subscription?.orderCount || 0,
        selectedOrderLimit: subscription?.selectedOrderLimit || 0,
      },
    });
  } catch (error) {
    console.error("❌ Error getting store plan:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to get store plan",
      error: error.message,
    });
  }
};

/**
 * Downgrade store from paid to free plan
 * This function resets all premium features to their default/disabled state
 */
const downgradeToFree = async (req, res) => {
  try {
    const store = req.store; // From requireAuth middleware

    if (store.plan !== "paid") {
      return res.status(400).json({
        success: false,
        message: "Store is not on a paid plan",
      });
    }

    console.log(`📉 Starting downgrade to free plan for store: ${store._id}`);

    // Get order count from paid subscription before canceling
    const activeSubscriptions = await Subscription.find({
      store_id: store._id,
      status: { $in: ["active", "trial"] },
    });

    // Sum up all order counts from paid subscriptions
    let totalOrdersUsed = 0;
    for (const subscription of activeSubscriptions) {
      totalOrdersUsed += subscription.orderCount || 0;
      console.log(
        `📊 Paid subscription ${subscription._id} had ${subscription.orderCount || 0} orders used`,
      );
    }

    // Cancel paid subscriptions
    for (const subscription of activeSubscriptions) {
      await subscription.cancel();
    }

    console.log(`📊 Total orders used in paid plan: ${totalOrdersUsed}`);

    // Get free plan details
    const freePlan = await Plan.findByName("free");
    const freeOrderLimit = freePlan?.orderLimit || 300;

    // Check if order count exceeds free plan limit
    const limitReached = totalOrdersUsed >= freeOrderLimit;
    // Cap the order count at the free plan limit for display purposes
    const orderCountForFree = Math.min(totalOrdersUsed, freeOrderLimit);

    console.log(
      `📊 Free plan order limit: ${freeOrderLimit}, Orders carried over: ${orderCountForFree}, Limit reached: ${limitReached}`,
    );

    // Create a new free subscription with carried over order count
    if (freePlan) {
      const freeSubscription = new Subscription({
        store_id: store._id,
        plan_id: freePlan._id,
        status: "active",
        orderCount: orderCountForFree,
        selectedOrderLimit: freeOrderLimit,
        limitReached: limitReached,
        limitReachedAt: limitReached ? new Date() : null,
        basePrice: 0,
        currentPrice: 0,
      });
      await freeSubscription.save();
      console.log(
        `✅ Free subscription created with ${orderCountForFree}/${freeOrderLimit} orders, limitReached: ${limitReached}`,
      );
    } else {
      console.warn("⚠️ Free plan not found, skipping subscription creation");
    }

    // Update store to free plan
    // DO NOT update trialDaysRemaining - leave it as is so user gets remaining trial days when they re-subscribe
    await Store.updatePlan(store._id.toString(), {
      plan: "free",
      // trialDaysRemaining is NOT updated - kept as is for future re-subscription
      paypalSubscriptionId: null,
    });
    
    console.log(`📊 Store ${store._id} downgraded to free. trialDaysRemaining kept as: ${store.trialDaysRemaining}`);

    // ============================================
    // 1. POINTS & TIER SYSTEM - Reset premium features
    // ============================================
    const defaultLogo = {
      id: 1,
      src: "point-icon1.svg",
      name: "point-icon1.svg",
    };

    await Point.updateMany(
      { store_id: store._id },
      {
        $set: {
          logo: defaultLogo,
          customLogo: null,
          expiry: false, // Disable "Set point expiry"
          expiriesInDays: null,
          tierStatus: false, // Disable "Do you Want Tiers"
        },
      },
    );
    console.log("✅ Points & Tier System reset to free plan defaults");

    // ============================================
    // 2. WAYS TO EARN - Disable premium features
    // Keep only: signup and spent (Per USD spent)
    // Disable: birthday, subscribing, profileCompletion, referAndEarn, rejoin, events
    // ============================================
    await CollectSettings.updateMany(
      { store_id: store._id },
      {
        $set: {
          "basic.birthday.active": false,
          "basic.subucribing.active": false, // Newsletter/Subscribing
          "basic.profileComplition.active": false, // Profile Completion
          "referAndEarn.active": false, // Refer & Earn
          "rejoin.active": false, // Rejoining
          "event.active": false, // Points on Events
          "metaData.updatedAt": new Date(),
        },
      },
    );
    console.log("✅ Ways to Earn reset to free plan defaults");

    // ============================================
    // 3. WAYS TO REDEEM - Disable premium coupon types
    // Keep only: storeCredit (Fixed Discount)
    // Disable: purchase (Percentage), freeShipping, freeProduct
    // ============================================
    await RedeemSettings.updateMany(
      {
        store_id: store._id,
        redeemType: { $in: ["purchase", "freeShipping", "freeProduct"] },
      },
      {
        $set: {
          "coupon.active": false,
          updatedAt: new Date(),
        },
      },
    );
    console.log("✅ Ways to Redeem reset to free plan defaults");

    // ============================================
    // 4. CUSTOMIZE WIDGET - Reset to default values
    // ============================================
    // First, update all non-array fields to defaults
    await WidgetCustomization.updateMany(
      { store_id: store._id },
      {
        $set: {
          widgetBgColor: "#62a63f", // Default green (installation default)
          headingColor: "#ffffff", // Default white (installation default)
          widgetIconColor: null, // Default null (installation default)
          backgroundPatternEnabled: false, // Disable pattern
          backgroundPatternUrlId: null, // No pattern selected
          widgetIconUrlId: "widget-icon1", // First icon (free)
          LauncherType: "IconOnly", // Icon only (free)
          Label: null,
          widgetButton: "Bottom-Left", // Default placement
          "metaData.updatedAt": new Date(),
        },
      },
    );

    // Handle announcements: Keep all but disable all except the first one
    const widgetCustomizations = await WidgetCustomization.find({
      store_id: store._id,
    });
    for (const widget of widgetCustomizations) {
      if (widget.announcements && widget.announcements.length > 0) {
        // Keep first announcement enabled (if it was enabled), disable all others
        const updatedAnnouncements = widget.announcements.map(
          (announcement, index) => {
            if (index === 0) {
              // Keep first announcement as is (don't change its enable status)
              return announcement;
            } else {
              // Disable all other announcements
              return {
                ...announcement.toObject(),
                enable: false,
              };
            }
          },
        );
        widget.announcements = updatedAnnouncements;
        await widget.save();
      }
    }
    console.log("✅ Customize Widget reset to free plan defaults");

    // ============================================
    // 5. EMAIL SETTINGS - Disable premium emails
    // Keep only: signUp and purchase
    // Disable: birthday, pointsExpire, couponExpire, festival,
    //          monthlyPoints, newsletter, referAndEarn, rejoining,
    //          upgradedTrial, profileCompletion
    // ============================================
    await CollectSettings.updateMany(
      { store_id: store._id },
      {
        $set: {
          "emailSetting.birthday.enable": false,
          "emailSetting.pointsExpire.enable": false,
          "emailSetting.couponExpire.enable": false,
          "emailSetting.festival.enable": false,
          "emailSetting.monthlyPoints.enable": false,
          "emailSetting.newsletter.enable": false,
          "emailSetting.referAndEarn.enable": false,
          "emailSetting.rejoining.enable": false,
          "emailSetting.upgradedTrial.enable": false,
          "emailSetting.profileCompletion.enable": false,
        },
      },
    );
    console.log("✅ Email Settings reset to free plan defaults");

    console.log(
      `✅ Successfully completed downgrade to free plan for store: ${store._id}`,
    );

    res.json({
      success: true,
      message: "Successfully downgraded to free plan",
      data: {
        plan: "free",
        trialDaysRemaining: store.trialDaysRemaining, // Keep existing value for future re-subscription
        // Include subscription details for frontend to refresh
        orderCount: orderCountForFree,
        selectedOrderLimit: freeOrderLimit,
        limitReached: limitReached,
      },
    });
  } catch (error) {
    console.error("❌ Error downgrading plan:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to downgrade plan",
      error: error.message,
    });
  }
};

/**
 * Apply free plan restrictions when order limit is reached
 * Similar to downgradeToFree but keeps plan as "paid" and doesn't cancel subscriptions
 * This is called from webhookController when order limit is reached
 */
const applyFreePlanRestrictions = async (storeId) => {
  try {
    console.log(`🔒 Applying free plan restrictions for store: ${storeId}`);

    // ============================================
    // 1. POINTS & TIER SYSTEM - Reset premium features
    // ============================================
    const defaultLogo = {
      id: 1,
      src: "point-icon1.svg",
      name: "point-icon1.svg",
    };

    await Point.updateMany(
      { store_id: storeId },
      {
        $set: {
          logo: defaultLogo,
          customLogo: null,
          expiry: false, // Disable "Set point expiry"
          expiriesInDays: null,
          tierStatus: false, // Disable "Do you Want Tiers"
        },
      },
    );
    console.log("✅ Points & Tier System reset to free plan defaults");

    // ============================================
    // 2. WAYS TO EARN - Disable premium features
    // Keep only: signup and spent (Per USD spent)
    // Disable: birthday, subscribing, profileCompletion, referAndEarn, rejoin, events
    // ============================================
    await CollectSettings.updateMany(
      { store_id: storeId },
      {
        $set: {
          "basic.birthday.active": false,
          "basic.subucribing.active": false, // Newsletter/Subscribing
          "basic.profileComplition.active": false, // Profile Completion
          "referAndEarn.active": false, // Refer & Earn
          "rejoin.active": false, // Rejoining
          "event.active": false, // Points on Events
          "metaData.updatedAt": new Date(),
        },
      },
    );
    console.log("✅ Ways to Earn reset to free plan defaults");

    // ============================================
    // 3. WAYS TO REDEEM - Disable premium coupon types
    // Keep only: storeCredit (Fixed Discount)
    // Disable: purchase (Percentage), freeShipping, freeProduct
    // ============================================
    await RedeemSettings.updateMany(
      {
        store_id: storeId,
        redeemType: { $in: ["purchase", "freeShipping", "freeProduct"] },
      },
      {
        $set: {
          "coupon.active": false,
          updatedAt: new Date(),
        },
      },
    );
    console.log("✅ Ways to Redeem reset to free plan defaults");

    // ============================================
    // 4. CUSTOMIZE WIDGET - Reset to default values
    // ============================================
    await WidgetCustomization.updateMany(
      { store_id: storeId },
      {
        $set: {
          widgetBgColor: "#62a63f", // Default green (installation default)
          headingColor: "#ffffff", // Default white (installation default)
          widgetIconColor: null, // Default null (installation default)
          backgroundPatternEnabled: false, // Disable pattern
          backgroundPatternUrlId: null, // No pattern selected
          widgetIconUrlId: "widget-icon1", // First icon (free)
          LauncherType: "IconOnly", // Icon only (free)
          Label: null,
          widgetButton: "Bottom-Left", // Default placement
          "metaData.updatedAt": new Date(),
        },
      },
    );

    // Handle announcements: Keep all but disable all except the first one
    const widgetCustomizations = await WidgetCustomization.find({
      store_id: storeId,
    });
    for (const widget of widgetCustomizations) {
      if (widget.announcements && widget.announcements.length > 0) {
        const updatedAnnouncements = widget.announcements.map(
          (announcement, index) => {
            if (index === 0) {
              return announcement;
            } else {
              return {
                ...announcement.toObject(),
                enable: false,
              };
            }
          },
        );
        widget.announcements = updatedAnnouncements;
        await widget.save();
      }
    }
    console.log("✅ Customize Widget reset to free plan defaults");

    // ============================================
    // 5. EMAIL SETTINGS - Disable premium emails
    // Keep only: signUp and purchase
    // ============================================
    await CollectSettings.updateMany(
      { store_id: storeId },
      {
        $set: {
          "emailSetting.birthday.enable": false,
          "emailSetting.pointsExpire.enable": false,
          "emailSetting.couponExpire.enable": false,
          "emailSetting.festival.enable": false,
          "emailSetting.monthlyPoints.enable": false,
          "emailSetting.newsletter.enable": false,
          "emailSetting.referAndEarn.enable": false,
          "emailSetting.rejoining.enable": false,
          "emailSetting.upgradedTrial.enable": false,
          "emailSetting.profileCompletion.enable": false,
        },
      },
    );
    console.log("✅ Email Settings reset to free plan defaults");

    console.log(
      `✅ Successfully applied free plan restrictions for store: ${storeId}`,
    );
    return true;
  } catch (error) {
    console.error("❌ Error applying free plan restrictions:", error.message);
    throw error;
  }
};

module.exports = {
  getStorePlan,
  downgradeToFree,
  applyFreePlanRestrictions,
};
