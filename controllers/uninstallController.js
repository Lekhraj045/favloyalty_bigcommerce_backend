const jwt = require("jsonwebtoken");
const Store = require("../models/Store");
const Subscription = require("../models/Subscription");
const Point = require("../models/Point");
const CollectSettings = require("../models/CollectSettings");
const RedeemSettings = require("../models/RedeemSettings");
const WidgetCustomization = require("../models/WidgetCustomization");
const Channel = require("../models/Channel");
const Plan = require("../models/Plan");
const { getWebhooks, deleteWebhook } = require("../services/bigcommerceWebhookService");
const { deleteScriptForChannel } = require("../services/bigcommerceScriptsService");
const { sendUninstallNotificationEmail } = require("../helpers/emailHelpers");

/**
 * Reset store settings to free plan defaults on uninstall.
 * Similar to downgradeToFree but without response handling.
 * Cancels paid subscriptions and resets all premium features.
 * @param {Object} store - Store document
 */
const resetStoreOnUninstall = async (store) => {
  try {
    console.log(`🔄 Resetting store ${store._id} settings on uninstall...`);

    // ============================================
    // 1. CANCEL PAID SUBSCRIPTIONS (if on paid plan)
    // ============================================
    if (store.plan === "paid") {
      const activeSubscriptions = await Subscription.find({
        store_id: store._id,
        status: { $in: ["active", "trial"] },
      });

      for (const subscription of activeSubscriptions) {
        await subscription.cancel();
        console.log(`✅ Subscription ${subscription._id} cancelled on uninstall`);
      }

      // Create a free subscription record (for tracking purposes)
      const freePlan = await Plan.findByName("free");
      if (freePlan) {
        const freeSubscription = new Subscription({
          store_id: store._id,
          plan_id: freePlan._id,
          status: "cancelled", // Mark as cancelled since app is uninstalled
          orderCount: 0,
          selectedOrderLimit: freePlan.orderLimit || 300,
          limitReached: false,
          basePrice: 0,
          currentPrice: 0,
          cancelledAt: new Date(),
        });
        await freeSubscription.save();
        console.log(`✅ Free subscription record created on uninstall`);
      }

      // Update store to free plan
      await Store.updatePlan(store._id.toString(), {
        plan: "free",
        paypalSubscriptionId: null,
      });
      console.log(`✅ Store ${store._id} plan updated to free on uninstall`);
    } else {
      console.log(`ℹ️ Store ${store._id} is already on free plan, skipping subscription cancellation`);
    }

    // ============================================
    // 2. POINTS & TIER SYSTEM - Reset premium features
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
          expiry: false,
          expiriesInDays: null,
          tierStatus: false,
        },
      },
    );
    console.log(`✅ Points & Tier System reset for store ${store._id}`);

    // ============================================
    // 3. WAYS TO EARN - Disable premium features
    // ============================================
    await CollectSettings.updateMany(
      { store_id: store._id },
      {
        $set: {
          "basic.birthday.active": false,
          "basic.subucribing.active": false,
          "basic.profileComplition.active": false,
          "referAndEarn.active": false,
          "rejoin.active": false,
          "event.active": false,
          "metaData.updatedAt": new Date(),
        },
      },
    );
    console.log(`✅ Ways to Earn reset for store ${store._id}`);

    // ============================================
    // 4. WAYS TO REDEEM - Disable premium coupon types
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
    console.log(`✅ Ways to Redeem reset for store ${store._id}`);

    // ============================================
    // 5. CUSTOMIZE WIDGET - Reset to default values
    // ============================================
    await WidgetCustomization.updateMany(
      { store_id: store._id },
      {
        $set: {
          widgetBgColor: "#62a63f",
          headingColor: "#ffffff",
          widgetIconColor: null,
          backgroundPatternEnabled: false,
          backgroundPatternUrlId: null,
          widgetIconUrlId: "widget-icon1",
          LauncherType: "IconOnly",
          Label: null,
          widgetButton: "Bottom-Left",
          "metaData.updatedAt": new Date(),
        },
      },
    );

    // Handle announcements: Disable all except the first one
    const widgetCustomizations = await WidgetCustomization.find({
      store_id: store._id,
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
    console.log(`✅ Customize Widget reset for store ${store._id}`);

    // ============================================
    // 6. EMAIL SETTINGS - Disable premium emails
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
    console.log(`✅ Email Settings reset for store ${store._id}`);

    console.log(`✅ Store ${store._id} fully reset to free plan defaults on uninstall`);
  } catch (error) {
    console.error(`❌ Error resetting store ${store._id} on uninstall:`, error.message);
    // Don't throw - continue with uninstall even if reset fails
  }
};

/**
 * Delete all widget scripts from all channels for this store on uninstall.
 * Also marks widget_visibility as false for all channels.
 * 
 * NOTE: 401 errors are expected during uninstall as BigCommerce often revokes
 * the access token before/during the uninstall callback.
 * 
 * @param {Object} store - Store document
 */
const deleteAllScriptsOnUninstall = async (store) => {
  let tokenRevoked = false;
  
  try {
    console.log(`🔄 Deleting all widget scripts for store ${store._id}...`);

    // Get all channels for this store
    const channels = await Channel.find({ store_id: store._id });

    if (channels.length === 0) {
      console.log(`ℹ️ No channels found for store ${store._id}`);
      return;
    }

    console.log(`📋 Found ${channels.length} channels to process`);

    for (const channel of channels) {
      try {
        // Delete script from BigCommerce if it exists and token not already revoked
        if (channel.script_id && !tokenRevoked) {
          const deleted = await deleteScriptForChannel(store, channel);
          if (deleted) {
            console.log(`✅ Script deleted for channel ${channel._id} (script_id: ${channel.script_id})`);
          } else {
            console.warn(`⚠️ Failed to delete script for channel ${channel._id}`);
          }
        } else if (!channel.script_id) {
          console.log(`ℹ️ No script to delete for channel ${channel._id}`);
        }

        // Update channel: set script_id to null and widget_visibility to false
        await Channel.findByIdAndUpdate(channel._id, {
          $set: {
            script_id: null,
            widget_visibility: false,
          },
        });
        console.log(`✅ Channel ${channel._id} updated: script_id=null, widget_visibility=false`);
      } catch (channelError) {
        // Check if it's a 401 error (token revoked during uninstall)
        const statusCode = channelError.response?.status || channelError.status;
        if (statusCode === 401) {
          console.log(`ℹ️ Token revoked during uninstall - skipping BigCommerce API calls for remaining channels`);
          tokenRevoked = true;
          // Still update the channel in our database
          await Channel.findByIdAndUpdate(channel._id, {
            $set: {
              script_id: null,
              widget_visibility: false,
            },
          });
          console.log(`✅ Channel ${channel._id} updated locally: script_id=null, widget_visibility=false`);
        } else {
          console.error(`❌ Error processing channel ${channel._id}:`, channelError.message);
        }
        // Continue with other channels even if one fails
      }
    }

    console.log(`✅ All channels updated for store ${store._id}`);
  } catch (error) {
    console.error(`❌ Error deleting scripts for store ${store._id}:`, error.message);
    // Don't throw - continue with uninstall even if script deletion fails
  }
};

/**
 * Unsubscribe from all BigCommerce webhooks for this store (called on uninstall).
 * Must run before Store.delete so we still have access_token.
 * 
 * NOTE: 401 errors are expected during uninstall as BigCommerce often revokes
 * the access token before/during the uninstall callback. BigCommerce will
 * automatically clean up webhooks when the app is uninstalled.
 * 
 * @param {string} storeHash - Store hash identifier
 * @param {string} accessToken - BigCommerce access token
 */
const unsubscribeWebhooksOnUninstall = async (storeHash, accessToken) => {
  if (!accessToken) {
    console.log(`ℹ️ No access token for store ${storeHash}, skipping webhook unsubscription`);
    return;
  }
  
  try {
    console.log(`🔄 Unsubscribing all webhooks for store ${storeHash}...`);
    
    // Use silentOnAuthError: true to handle 401 gracefully during uninstall
    const webhooks = await getWebhooks(storeHash, accessToken, { silentOnAuthError: true });
    
    if (webhooks.length === 0) {
      console.log(`ℹ️ No webhooks to unsubscribe for store ${storeHash}`);
      return;
    }
    
    console.log(`📋 Found ${webhooks.length} webhooks to unsubscribe`);
    
    for (const hook of webhooks) {
      try {
        await deleteWebhook(storeHash, accessToken, hook.id);
        console.log(`✅ Webhook unsubscribed: ${hook.scope} (id: ${hook.id})`);
      } catch (err) {
        // Check if it's a 401 error (token revoked during uninstall)
        const statusCode = err.response?.status || err.status;
        if (statusCode === 401) {
          console.log(`ℹ️ Token revoked during uninstall, BigCommerce will auto-cleanup webhooks`);
          return; // Exit early - no point trying other webhooks
        }
        console.error(`❌ Failed to delete webhook ${hook.id}:`, err.message);
        // Continue with other webhooks even if one fails
      }
    }
    
    console.log(`✅ All webhooks unsubscribed for store ${storeHash}`);
  } catch (err) {
    // Check if it's a 401 error (token revoked during uninstall - expected behavior)
    const statusCode = err.response?.status || err.status;
    if (statusCode === 401) {
      console.log(`ℹ️ Token already revoked during uninstall for store ${storeHash} - BigCommerce will auto-cleanup webhooks`);
      return; // This is expected, not an error
    }
    console.error(`❌ Failed to fetch webhooks on uninstall for store ${storeHash}:`, err.message);
    // Don't throw - continue with uninstall even if webhook deletion fails
  }
};

/**
 * Handle app uninstall callback from BigCommerce.
 * Performs cleanup in this order:
 * 1. Reset store to free plan (cancel subscriptions, reset settings)
 * 2. Delete all widget scripts from all channels
 * 3. Unsubscribe from all webhooks
 * 4. Mark store as deleted
 */
const handleUninstall = async (req, res) => {
  console.log("📥 Uninstall callback received");
  console.log("Query params:", req.query);

  const { signed_payload_jwt } = req.query;

  if (!signed_payload_jwt) {
    console.error("❌ Missing signed_payload_jwt");
    return res.status(400).send("Missing signed payload");
  }

  try {
    const payload = jwt.verify(signed_payload_jwt, process.env.CLIENT_SECRET, {
      algorithms: ["HS256"],
    });

    const storeHash = payload.sub.split("/")[1];
    console.log(`🔄 Processing uninstall for store: ${storeHash}`);

    // Find store (need access_token for API calls)
    const store = await Store.findByHash(storeHash);
    if (!store) {
      console.error(`❌ Store not found: ${storeHash}`);
      return res.status(404).send("Store not found");
    }

    console.log(`📋 Store found: ${store._id}, plan: ${store.plan}`);

    // STEP 1: Cancel paid plan & reset settings (if on paid plan)
    await resetStoreOnUninstall(store);

    // STEP 2: Delete all widget scripts from all channels
    await deleteAllScriptsOnUninstall(store);

    // STEP 3: Unsubscribe from all webhooks
    if (store.access_token) {
      await unsubscribeWebhooksOnUninstall(storeHash, store.access_token);
    } else {
      console.log(`ℹ️ No access token for store ${storeHash}, skipping webhook unsubscription`);
    }

    // STEP 4: Mark store as deleted
    await Store.delete(storeHash);

    console.log(`✅ App uninstalled completely for store: ${storeHash}`);

    // STEP 5: Send uninstall notification email
    await sendUninstallNotificationEmail(store);

    res.status(200).send("App uninstalled successfully");
  } catch (error) {
    console.error("❌ Uninstall Error:", error.message);
    res.status(500).send("Uninstall failed");
  }
};

module.exports = {
  handleUninstall,
};
