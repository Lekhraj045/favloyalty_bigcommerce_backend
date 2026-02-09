const mongoose = require("mongoose");
const WebhookLog = require("../models/WebhookLog");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const CollectSettings = require("../models/CollectSettings");
const Customer = require("../models/Customer");
const Transaction = require("../models/Transaction");
const Point = require("../models/Point");
const Referral = require("../models/Referral");
const Subscription = require("../models/Subscription");
const {
  createWebhook,
  getWebhooks,
  getWebhookById,
  updateWebhook,
  deleteWebhook,
  findWebhookByScope,
  createOrUpdateWebhook,
  getOrder,
  getOrderCoupons,
  getCustomer,
} = require("../services/bigcommerceWebhookService");
const {
  applyTierMultiplierToPurchasePoints,
  calculateAndUpdateCustomerTier,
  checkAndScheduleTierUpgradeEmail,
} = require("../helpers/tierHelper");
const { applyFreePlanRestrictions } = require("./storeController");
const queueManager = require("../queues/queueManager");

/**
 * Subscribe to a webhook (create or update)
 */
const subscribeWebhook = async (req, res, next) => {
  try {
    const { scope, channelId } = req.body;
    const { storeHash, storeId } = req;

    if (!scope) {
      return res.status(400).json({
        status: false,
        message: "Webhook scope is required",
      });
    }

    // Get store to access access token
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({
        status: false,
        message: "Store not found",
      });
    }

    // Build webhook destination URL
    const baseUrl = process.env.BACKEND_URL || process.env.WEBHOOK_BASE_URL;
    if (!baseUrl) {
      return res.status(500).json({
        status: false,
        message: "Webhook base URL not configured",
      });
    }

    const destination = `${baseUrl}/api/webhooks/receive`;

    // Create or update webhook in BigCommerce
    const webhook = await createOrUpdateWebhook(
      storeHash,
      store.access_token,
      scope,
      destination,
    );

    // Log webhook subscription
    try {
      await WebhookLog.create({
        endpoint: `/api/webhooks/subscribe`,
        method: "POST",
        status: "success",
        responseCode: 200,
        store_id: storeId,
        channel_id: channelId ? channelId : null,
        webhookType: "bigcommerce",
        webhookScope: scope,
        requestBody: { scope, channelId },
        metadata: {
          webhookId: webhook.id,
          destination: destination,
        },
      });
    } catch (logError) {
      console.error("❌ Error logging webhook subscription:", logError.message);
      // Don't fail the request if logging fails
    }

    res.json({
      status: true,
      message: "Webhook subscribed successfully",
      data: webhook,
    });
  } catch (error) {
    console.error("❌ Error subscribing webhook:", error.message);

    // Log error
    try {
      await WebhookLog.create({
        endpoint: `/api/webhooks/subscribe`,
        method: "POST",
        status: "error",
        responseCode: error.response?.status || 500,
        store_id: req.storeId,
        channel_id: req.body.channelId || null,
        webhookType: "bigcommerce",
        webhookScope: req.body.scope || null,
        requestBody: req.body,
        error: {
          message: error.message,
          code: error.response?.status || 500,
        },
      });
    } catch (logError) {
      console.error("❌ Error logging webhook error:", logError.message);
    }

    next(error);
  }
};

/**
 * Get all webhooks for a store
 */
const getAllWebhooks = async (req, res, next) => {
  try {
    const { storeHash, storeId } = req;

    // Get store to access access token
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({
        status: false,
        message: "Store not found",
      });
    }

    const webhooks = await getWebhooks(storeHash, store.access_token);

    res.json({
      status: true,
      message: "Webhooks fetched successfully",
      data: webhooks,
    });
  } catch (error) {
    console.error("❌ Error fetching webhooks:", error.message);
    next(error);
  }
};

/**
 * Get a specific webhook by ID
 */
const getWebhook = async (req, res, next) => {
  try {
    const { webhookId } = req.params;
    const { storeHash, storeId } = req;

    // Get store to access access token
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({
        status: false,
        message: "Store not found",
      });
    }

    const webhook = await getWebhookById(
      storeHash,
      store.access_token,
      webhookId,
    );

    res.json({
      status: true,
      message: "Webhook fetched successfully",
      data: webhook,
    });
  } catch (error) {
    console.error("❌ Error fetching webhook:", error.message);
    next(error);
  }
};

/**
 * Receive webhook from BigCommerce
 * This is the endpoint that BigCommerce will call when events occur
 */
const receiveWebhook = async (req, res) => {
  const startTime = Date.now();
  let webhookLog = null;

  try {
    const webhookPayload = req.body;
    const { scope, store_id, data, hash, created_at, producer } =
      webhookPayload;

    console.log(`📥 Webhook received: ${scope}`, {
      store_id,
      data,
      hash,
    });

    // Extract store hash from producer (format: "stores/{store_hash}")
    const storeHash = producer ? producer.split("/")[1] : null;

    if (!storeHash) {
      console.error("❌ Could not extract store hash from webhook");
      return res.status(400).json({
        status: false,
        message: "Invalid webhook payload: missing store hash",
      });
    }

    // Find store by hash
    const store = await Store.findByHash(storeHash);
    if (!store) {
      console.error(`❌ Store not found for hash: ${storeHash}`);
      return res.status(404).json({
        status: false,
        message: "Store not found",
      });
    }

    // Determine channel_id if possible (from processing result for logging)
    let channelId = null;

    // Process the webhook based on scope
    let processingResult = null;
    if (scope === "store/order/statusUpdated") {
      processingResult = await processOrderStatusUpdatedWebhook(
        store,
        webhookPayload,
      );
      if (processingResult?.channelId != null) {
        channelId = processingResult.channelId;
      }
    } else if (scope === "store/customer/created") {
      processingResult = await processCustomerCreatedWebhook(
        store,
        webhookPayload,
      );
      if (processingResult?.channelId != null) {
        channelId = processingResult.channelId;
      }
    }

    const processingTime = Date.now() - startTime;

    // Log successful webhook receipt
    const metadata = {
      processingResult: processingResult,
    };
    if (data?.id != null) {
      metadata[data.type === "customer" ? "customerId" : "orderId"] = data.id;
    }

    webhookLog = await WebhookLog.create({
      endpoint: `/api/webhooks/receive`,
      method: "POST",
      status: "success",
      responseCode: 200,
      domain: storeHash,
      store_id: store._id,
      channel_id: channelId,
      webhookType: "bigcommerce",
      webhookScope: scope,
      requestBody: webhookPayload,
      requestHeaders: req.headers,
      processingTime: processingTime,
      metadata,
    });

    // Always return 200 to acknowledge receipt
    // BigCommerce will retry if we return an error status
    res.status(200).json({
      status: true,
      message: "Webhook received and processed",
      webhookId: webhookLog._id,
    });
  } catch (error) {
    console.error("❌ Error processing webhook:", error.message, error.stack);

    const processingTime = Date.now() - startTime;

    // Log error (WebhookLog requires store_id as ObjectId; only log when we have store)
    try {
      if (store?._id) {
        webhookLog = await WebhookLog.create({
          endpoint: `/api/webhooks/receive`,
          method: "POST",
          status: "error",
          responseCode: 500,
          store_id: store._id,
          webhookType: "bigcommerce",
          webhookScope: req.body?.scope || null,
          requestBody: req.body,
          requestHeaders: req.headers,
          error: {
            message: error.message,
            stack: error.stack,
          },
          processingTime: processingTime,
        });
      }
    } catch (logError) {
      console.error("❌ Error logging webhook error:", logError.message);
    }

    // Still return 200 to prevent BigCommerce from retrying
    // Log the error for manual investigation
    res.status(200).json({
      status: false,
      message: "Webhook received but processing failed",
      error: error.message,
    });
  }
};

/** Status ID for "Completed" in BigCommerce - award points only when order reaches this status */
const ORDER_COMPLETED_STATUS_ID = 10;

/**
 * Process order status updated webhook:
 * - If new_status_id is 10 (Completed), fetch order, get channel_id, find channel & collect settings, award points.
 */
const processOrderStatusUpdatedWebhook = async (store, webhookPayload) => {
  try {
    const { data } = webhookPayload;
    const { id: orderId, status } = data;
    const newStatusId = status?.new_status_id;

    console.log(`🔄 Processing order status update:`, {
      orderId,
      previousStatus: status?.previous_status_id,
      newStatus: newStatusId,
    });

    // Only award points when order is Completed (status_id 10)
    if (newStatusId !== ORDER_COMPLETED_STATUS_ID) {
      return {
        processed: true,
        orderId,
        previousStatus: status?.previous_status_id,
        newStatus: newStatusId,
        skipped: "status_not_completed",
      };
    }

    // ============================================
    // EARLY CHECK: If order limit already reached, skip awarding points
    // Orders still process, but no loyalty points awarded
    // ============================================
    const subscription = await Subscription.findActiveByStore(store._id);
    if (subscription && subscription.limitReached) {
      console.log(
        `⏭️ Skipping points for order ${orderId}: store ${store._id} order limit already reached (${subscription.orderCount}/${subscription.selectedOrderLimit})`,
      );
      return {
        processed: true,
        orderId,
        newStatus: newStatusId,
        skipped: "order_limit_reached",
        orderCount: subscription.orderCount,
        orderLimit: subscription.selectedOrderLimit,
      };
    }

    // Before calling BigCommerce Get Order API: if "Every purchase (Per INR spent)" is
    // disabled for all channels on the Ways to Earn page, do not distribute points.
    const channels = await Channel.find({ store_id: store._id });
    let atLeastOneChannelHasPurchaseEnabled = false;
    for (const ch of channels) {
      const settings = await CollectSettings.findByStoreAndChannel(
        store._id,
        ch._id,
      );
      if (settings?.basic?.spent?.active === true) {
        atLeastOneChannelHasPurchaseEnabled = true;
        break;
      }
    }
    if (!atLeastOneChannelHasPurchaseEnabled) {
      console.log(
        `⏭️ Skipping order ${orderId}: Every purchase (Per INR spent) is disabled for all channels`,
      );
      return {
        processed: true,
        orderId,
        newStatus: newStatusId,
        skipped: "every_purchase_disabled",
      };
    }

    // Fetch full order from BigCommerce to get channel_id and customer_id
    const storeHash = store.store_hash;
    const order = await getOrder(storeHash, store.access_token, orderId);

    // BigCommerce v2 order: channel_id, customer_id (0 = guest)
    const orderChannelId = order.channel_id ?? 1;
    const bcCustomerId = order.customer_id ?? 0;

    if (!bcCustomerId) {
      console.log(`⏭️ Skipping order ${orderId}: guest order (no customer_id)`);
      return {
        processed: true,
        orderId,
        newStatus: newStatusId,
        skipped: "guest_order",
      };
    }

    // Find Channel by store_id + BigCommerce channel_id
    const channel = await Channel.findOne({
      store_id: store._id,
      channel_id: orderChannelId,
    });

    if (!channel) {
      console.warn(
        `⚠️ Channel not found for store ${store._id}, BC channel_id ${orderChannelId}; skipping points for order ${orderId}`,
      );
      return {
        processed: true,
        orderId,
        newStatus: newStatusId,
        skipped: "channel_not_found",
      };
    }

    // Get channel's collect settings (channel_id in CollectSettings is Channel MongoDB _id)
    const collectSettings = await CollectSettings.findByStoreAndChannel(
      store._id,
      channel._id,
    );

    if (
      !collectSettings?.basic?.spent?.active ||
      collectSettings.basic.spent.point == null
    ) {
      console.log(
        `⏭️ Skipping order ${orderId}: spent/purchase points not enabled for channel`,
      );
      return {
        processed: true,
        orderId,
        newStatus: newStatusId,
        skipped: "spent_not_enabled",
      };
    }

    const pointsPerUnit = Number(collectSettings.basic.spent.point) || 0;
    if (pointsPerUnit <= 0) {
      return {
        processed: true,
        orderId,
        newStatus: newStatusId,
        skipped: "zero_points_configured",
      };
    }

    // Only consider channel's default currency: if order currency doesn't match, skip
    const channelCurrency = channel.default_currency || null;
    const orderCurrency = order.currency_code || null;
    if (channelCurrency && orderCurrency && orderCurrency !== channelCurrency) {
      console.log(
        `⏭️ Skipping order ${orderId}: order currency ${orderCurrency} does not match channel default ${channelCurrency}`,
      );
      return {
        processed: true,
        orderId,
        newStatus: newStatusId,
        skipped: "currency_mismatch",
      };
    }

    // Order total in channel currency (total including tax = amount spent)
    const orderTotal =
      parseFloat(order.total_inc_tax) ||
      parseFloat(order.subtotal_inc_tax) ||
      0;
    if (orderTotal <= 0) {
      console.log(`⏭️ Skipping order ${orderId}: invalid or zero order total`);
      return {
        processed: true,
        orderId,
        newStatus: newStatusId,
        skipped: "invalid_order_total",
      };
    }

    // Base points = order total × points per unit (e.g. 2 pts per USD → $35 = 70 base points)
    const basePoints = Math.floor(orderTotal * pointsPerUnit);
    if (basePoints <= 0) {
      return {
        processed: true,
        orderId,
        newStatus: newStatusId,
        skipped: "zero_points_calculated",
      };
    }

    // Find customer in our DB (store + channel + bcCustomerId)
    const customer = await Customer.findOne({
      store_id: store._id,
      channel_id: orderChannelId,
      bcCustomerId,
    });

    if (!customer) {
      console.log(
        `⏭️ Skipping order ${orderId}: customer not found in DB (bcCustomerId ${bcCustomerId}, channel ${orderChannelId})`,
      );
      return {
        processed: true,
        orderId,
        newStatus: newStatusId,
        skipped: "customer_not_found",
      };
    }

    // Mark loyalty redeem coupons as "used in order" when they appear on this completed order
    try {
      const orderCoupons = await getOrderCoupons(
        storeHash,
        store.access_token,
        orderId,
      );
      for (const { code } of orderCoupons) {
        const codeStr = String(code || "").trim();
        if (!codeStr) continue;
        const result = await Transaction.updateMany(
          {
            customerId: customer._id,
            channel_id: orderChannelId,
            type: "redeem",
            status: "completed",
            "metadata.couponCode": codeStr,
            "metadata.usedInOrder": { $ne: true },
          },
          {
            $set: {
              "metadata.usedInOrder": true,
              "metadata.bigcommerceOrderId": orderId,
            },
          },
        );
        if (result.modifiedCount > 0) {
          console.log(
            `✅ Order ${orderId}: marked coupon "${codeStr}" as used for customer ${customer._id}`,
          );
        }
      }
    } catch (couponErr) {
      console.warn(
        "⚠️ Error marking coupons used for order",
        orderId,
        couponErr?.message,
      );
    }

    // Get Point model to check if tier system is enabled (for tier multiplier)
    const pointModelForTier = await Point.findOne({
      store_id: store._id,
      channel_id: channel._id,
    });
    const tierEnabled = pointModelForTier?.tierStatus === true;

    // Apply tier multiplier to purchase points only (e.g. Gold 1.5x → 70 base → 105 points)
    // Only applies multiplier if tier system is enabled
    const {
      pointsToAward,
      multiplier: tierMultiplier,
      basePoints: basePointsForMeta,
    } = applyTierMultiplierToPurchasePoints(basePoints, customer, tierEnabled);
    if (pointsToAward <= 0) {
      return {
        processed: true,
        orderId,
        newStatus: newStatusId,
        skipped: "zero_points_after_multiplier",
      };
    }

    // Avoid duplicate points for the same order
    const existingTransaction = await Transaction.findOne({
      store_id: store._id,
      channel_id: orderChannelId,
      transactionCategory: "order",
      "metadata.bc_order_id": orderId,
    });

    if (existingTransaction) {
      console.log(
        `⏭️ Skipping order ${orderId}: points already awarded (duplicate)`,
      );
      return {
        processed: true,
        orderId,
        newStatus: newStatusId,
        skipped: "already_awarded",
      };
    }

    // Create earn transaction for order completion (points include tier multiplier)
    const transaction = await Transaction.createTransaction({
      customerId: customer._id,
      store_id: store._id,
      channel_id: orderChannelId,
      bcCustomerId: customer.bcCustomerId,
      type: "earn",
      transactionCategory: "order",
      points: pointsToAward,
      description:
        tierMultiplier !== 1
          ? `Points for completed order #${orderId} (${basePointsForMeta} × ${tierMultiplier} tier)`
          : `Points for completed order #${orderId} (${orderTotal} ${
              channelCurrency || orderCurrency || ""
            } × ${pointsPerUnit} pts)`,
      reason: null,
      status: "completed",
      expiresAt: null,
      notificationSent: false,
      adminUserId: null,
      source: "webhook",
      metadata: {
        bc_order_id: orderId,
        bc_order_total: orderTotal,
        currency: channelCurrency || orderCurrency,
        points_per_unit: pointsPerUnit,
        base_points: basePointsForMeta,
        tier_multiplier: tierMultiplier,
      },
      relatedTransactionId: null,
    });

    // Update customer points balance
    await Customer.updatePoints(customer._id, pointsToAward, "earn");

    // Recalculate customer tier using global helper (e.g. 150 signup + 0 order → Gold if Gold requires 100)
    // Reuse pointModelForTier fetched earlier to avoid duplicate DB call
    if (pointModelForTier) {
      try {
        const updatedCustomer = await Customer.findById(customer._id);
        if (updatedCustomer) {
          // Capture previous tier before recalculation
          const previousTier = updatedCustomer.currentTier
            ? { ...updatedCustomer.currentTier.toObject?.() || updatedCustomer.currentTier }
            : null;
          
          const tierResult = await calculateAndUpdateCustomerTier(updatedCustomer, pointModelForTier);
          
          // Schedule tier upgrade email if tier was upgraded
          if (tierResult.tierUpdated) {
            await checkAndScheduleTierUpgradeEmail(
              tierResult,
              previousTier,
              updatedCustomer._id,
              store._id,
              channel._id,
              pointModelForTier,
            );
          }
        }
      } catch (tierError) {
        console.error(
          `⚠️ Error recalculating tier for customer ${customer._id}:`,
          tierError.message,
        );
      }
    }

    console.log(
      `✅ Order ${orderId} completed: awarded ${pointsToAward} points to customer ${customer._id} (channel ${orderChannelId})`,
    );

    // Refer & Earn: award referrer when referred customer completes first order
    try {
      if (collectSettings?.referAndEarn?.active === true) {
        const claimableReferrals =
          await Referral.findClaimableByReferredCustomer(
            customer._id,
            store._id,
            orderChannelId,
          );
        for (const ref of claimableReferrals) {
          const referrerId = ref.referrer_user_id;
          if (!referrerId) continue;
          const referrer = await Customer.findById(referrerId).lean();
          if (!referrer) continue;

          await Transaction.createTransaction({
            customerId: referrerId,
            store_id: store._id,
            channel_id: orderChannelId,
            bcCustomerId: referrer.bcCustomerId,
            type: "referral",
            transactionCategory: "referral",
            points: ref.referral_points,
            description: `Referral bonus – friend's order #${orderId} completed`,
            reason: null,
            status: "completed",
            expiresAt: null,
            notificationSent: false,
            adminUserId: null,
            source: "webhook",
            metadata: {
              referred_customer_id: customer._id.toString(),
              bc_order_id: orderId,
              referral_id: ref._id?.toString(),
            },
            relatedTransactionId: null,
          });
          await Customer.updatePoints(
            referrerId,
            ref.referral_points,
            "referral",
          );

          await Referral.updateOne(
            { _id: ref._id },
            {
              $set: { status: "Completed", updatedAt: new Date() },
            },
          );
          console.log(
            `✅ Referral ${ref._id}: awarded ${ref.referral_points} points to referrer ${referrerId} (referred customer order #${orderId})`,
          );

          // Schedule Refer & Earn reward email (only sends if emailSetting.referAndEarn is enabled)
          try {
            await queueManager.addReferAndEarnEmailJob({
              customerId: referrerId.toString(),
              storeId: store._id.toString(),
              channelId: channel._id.toString(),
              referralPoints: ref.referral_points,
            });
          } catch (emailJobError) {
            console.warn(
              "[FavLoyalty] processOrderStatusUpdatedWebhook: failed to schedule Refer & Earn email job:",
              emailJobError?.message,
            );
          }
        }
      }
    } catch (referralErr) {
      console.warn(
        "⚠️ Error awarding referral points for order",
        orderId,
        referralErr?.message,
      );
    }

    // ============================================
    // INCREMENT ORDER COUNT & CHECK LIMIT
    // ============================================
    try {
      // Re-fetch subscription to ensure we have latest data (we checked it earlier for early skip)
      const subscriptionForIncrement = await Subscription.findActiveByStore(
        store._id,
      );
      if (subscriptionForIncrement) {
        // Get actual item quantity from order (items_total = total quantity of all items in order)
        const orderItemQuantity = parseInt(order.items_total) || 1;

        // Increment order count by actual item quantity
        subscriptionForIncrement.orderCount =
          (subscriptionForIncrement.orderCount || 0) + orderItemQuantity;

        console.log(
          `📊 Store ${store._id} order count: ${subscriptionForIncrement.orderCount}/${subscriptionForIncrement.selectedOrderLimit} (added ${orderItemQuantity} items from order #${orderId})`,
        );

        // Check if limit NOW reached (and not already flagged)
        if (
          subscriptionForIncrement.orderCount >=
            subscriptionForIncrement.selectedOrderLimit &&
          !subscriptionForIncrement.limitReached
        ) {
          subscriptionForIncrement.limitReached = true;
          subscriptionForIncrement.limitReachedAt = new Date();

          console.log(
            `⚠️ Store ${store._id} reached order limit (${subscriptionForIncrement.orderCount}/${subscriptionForIncrement.selectedOrderLimit})`,
          );

          // Only apply free plan restrictions for PAID users (reset settings to free defaults)
          // For FREE users, just the limitReached flag is enough - they stop getting points on next order
          if (store.plan === "paid") {
            console.log(
              `🔄 Applying free plan restrictions for paid store ${store._id}`,
            );
            await applyFreePlanRestrictions(store._id);
          } else {
            console.log(
              `ℹ️ Free store ${store._id} limit reached - points will be skipped on future orders`,
            );
          }
        }

        await subscriptionForIncrement.save();
      }
    } catch (subscriptionErr) {
      console.warn(
        "⚠️ Error updating subscription order count:",
        subscriptionErr?.message,
      );
      // Don't throw - order processing was successful, just log the error
    }

    // ============================================
    // INCREMENT CUSTOMER ordersCount
    // ============================================
    try {
      await Customer.updateCustomer(customer._id, {
        ordersCount: (customer.ordersCount || 0) + 1,
      });
      console.log(
        `📊 Customer ${customer._id} ordersCount incremented to ${(customer.ordersCount || 0) + 1}`,
      );
    } catch (customerOrderCountErr) {
      console.warn(
        "⚠️ Error updating customer ordersCount:",
        customerOrderCountErr?.message,
      );
      // Don't throw - order processing was successful, just log the error
    }

    // Get item quantity for response
    const orderItemQuantity = parseInt(order.items_total) || 1;

    return {
      processed: true,
      orderId,
      newStatus: newStatusId,
      channelId: channel._id,
      customerId: customer._id.toString(),
      pointsAwarded: pointsToAward,
      transactionId: transaction._id.toString(),
      itemsInOrder: orderItemQuantity,
    };
  } catch (error) {
    console.error(
      "❌ Error processing order status updated webhook:",
      error.message,
    );
    throw error;
  }
};

/**
 * Process store/customer/created webhook:
 * - Fetch customer from BigCommerce to get channel_ids / origin_channel_id.
 * - For each channel: if customer already exists in our DB, skip (no points).
 * - If new: create customer, then if Sign up is enabled for that channel, award signup points (once per customer).
 */
const processCustomerCreatedWebhook = async (store, webhookPayload) => {
  try {
    const { data } = webhookPayload;
    const bcCustomerId = data?.id;

    if (!bcCustomerId) {
      console.warn("⚠️ store/customer/created webhook missing data.id");
      return {
        processed: true,
        skipped: "missing_customer_id",
      };
    }

    console.log(`🔄 Processing customer created: bcCustomerId=${bcCustomerId}`);

    const storeHash =
      store.store_hash ||
      (webhookPayload.producer && webhookPayload.producer.split("/")[1]);
    if (!storeHash) {
      return { processed: true, skipped: "missing_store_hash" };
    }

    const bcCustomer = await getCustomer(
      storeHash,
      store.access_token,
      bcCustomerId,
    );
    if (!bcCustomer) {
      console.warn(`⚠️ BigCommerce customer ${bcCustomerId} not found`);
      return {
        processed: true,
        bcCustomerId,
        skipped: "customer_not_found_in_bc",
      };
    }

    let customerChannelIds = [];
    if (
      bcCustomer.channel_ids &&
      Array.isArray(bcCustomer.channel_ids) &&
      bcCustomer.channel_ids.length > 0
    ) {
      customerChannelIds = bcCustomer.channel_ids.map((id) => parseInt(id, 10));
    } else if (bcCustomer.origin_channel_id) {
      customerChannelIds = [parseInt(bcCustomer.origin_channel_id, 10)];
    } else {
      customerChannelIds = [1];
    }

    const validChannels = await Channel.find({
      store_id: store._id,
      channel_id: { $in: customerChannelIds },
    });
    if (!validChannels || validChannels.length === 0) {
      return {
        processed: true,
        bcCustomerId,
        skipped: "no_valid_channels",
      };
    }

    let firstChannelMongoId = null;
    let created = false;
    let signupPointsAwarded = 0;
    const results = [];

    for (const channel of validChannels) {
      const numericChannelId = channel.channel_id;

      const existingCustomer = await Customer.findOne({
        store_id: store._id,
        channel_id: numericChannelId,
        bcCustomerId,
      });

      if (existingCustomer) {
        console.log(
          `⏭️ Customer ${bcCustomerId} already exists for channel ${numericChannelId}, skipping (no signup points)`,
        );
        results.push({
          channelId: numericChannelId,
          created: false,
          signupPointsAwarded: 0,
        });
        continue;
      }

      const customerData = {
        email: bcCustomer.email || "",
        shop: store.store_url || null,
        store_id: store._id,
        channel_id: numericChannelId,
        bcCustomerId: bcCustomer.id || bcCustomerId,
        acceptsMarketing:
          bcCustomer.accepts_product_review_abandoned_cart_emails !== undefined
            ? bcCustomer.accepts_product_review_abandoned_cart_emails
            : bcCustomer.accepts_marketing || false,
        firstName: bcCustomer.first_name || null,
        lastName: bcCustomer.last_name || null,
        joiningDate: bcCustomer.date_created
          ? new Date(bcCustomer.date_created)
          : new Date(),
        lastVisit: bcCustomer.date_modified
          ? new Date(bcCustomer.date_modified)
          : null,
        ordersCount: bcCustomer.orders_count || 0,
        totalSpent: parseFloat(bcCustomer.total_spent || 0) || 0,
        tags: bcCustomer.tags || [],
      };

      if (bcCustomer.addresses && bcCustomer.addresses.length > 0) {
        const defaultAddr =
          bcCustomer.addresses.find(
            (addr) => addr.address1 || addr.address_1,
          ) || bcCustomer.addresses[0];
        customerData.default_address = {
          address1: defaultAddr.address1 || defaultAddr.address_1 || null,
          address2: defaultAddr.address2 || defaultAddr.address_2 || null,
          city: defaultAddr.city || null,
          company: defaultAddr.company || null,
          country: defaultAddr.country || defaultAddr.country_code || null,
          zip: defaultAddr.zip || defaultAddr.postal_code || null,
          province: defaultAddr.state || defaultAddr.state_or_province || null,
          default:
            defaultAddr.address_type === "residential" ||
            defaultAddr.is_default ||
            false,
        };
      }

      const customer = await Customer.create(customerData);
      created = true;
      if (firstChannelMongoId == null) {
        firstChannelMongoId = channel._id;
      }

      // Link any pending Refer & Earn referrals for this email (referred friend just signed up)
      const newCustomerEmail = (bcCustomer.email || "").trim().toLowerCase();
      if (newCustomerEmail) {
        try {
          const pendingReferrals =
            await Referral.findPendingByEmailAndStoreChannel(
              newCustomerEmail,
              store._id,
              numericChannelId,
            );
          for (const ref of pendingReferrals) {
            await Referral.updateOne(
              { _id: ref._id },
              {
                $set: {
                  referred_user_id: customer._id,
                  status: "Referred Claimed",
                  updatedAt: new Date(),
                },
              },
            );
            console.log(
              `✅ Referral ${ref._id} linked: referred customer ${customer._id} (channel ${numericChannelId})`,
            );
          }
        } catch (linkErr) {
          console.warn(
            "[FavLoyalty] processCustomerCreatedWebhook: failed to link referral:",
            linkErr?.message,
          );
        }
      }

      const collectSettings = await CollectSettings.findByStoreAndChannel(
        store._id,
        channel._id,
      );

      const signupActive =
        collectSettings?.basic?.signup?.active &&
        (collectSettings.basic.signup.point || 0) > 0;
      if (!signupActive) {
        results.push({
          channelId: numericChannelId,
          created: true,
          customerId: customer._id.toString(),
          signupPointsAwarded: 0,
        });
        continue;
      }

      const existingSignup = await Transaction.findOne({
        customerId: customer._id,
        type: "signup",
      });
      if (existingSignup) {
        results.push({
          channelId: numericChannelId,
          created: true,
          customerId: customer._id.toString(),
          signupPointsAwarded: 0,
        });
        continue;
      }

      const pointsToAward = Number(collectSettings.basic.signup.point) || 0;
      await Transaction.createTransaction({
        customerId: customer._id,
        store_id: store._id,
        channel_id: numericChannelId,
        bcCustomerId: customer.bcCustomerId,
        type: "signup",
        transactionCategory: "signup",
        points: pointsToAward,
        description: "Sign up bonus",
        reason: null,
        status: "completed",
        expiresAt: null,
        notificationSent: false,
        adminUserId: null,
        source: "webhook",
        metadata: { bc_customer_created_webhook: true },
        relatedTransactionId: null,
      });
      await Customer.updatePoints(customer._id, pointsToAward, "signup");
      signupPointsAwarded += pointsToAward;

      // Recalculate tier using global helper (e.g. 150 signup → Gold if Gold requires 100)
      const point = await Point.findOne({
        store_id: store._id,
        channel_id: channel._id,
      });
      if (point) {
        try {
          const updatedCustomer = await Customer.findById(customer._id);
          if (updatedCustomer) {
            // Capture previous tier before recalculation
            const previousTier = updatedCustomer.currentTier
              ? { ...updatedCustomer.currentTier.toObject?.() || updatedCustomer.currentTier }
              : null;
            
            const tierResult = await calculateAndUpdateCustomerTier(updatedCustomer, point);
            
            // Schedule tier upgrade email if tier was upgraded
            if (tierResult.tierUpdated) {
              await checkAndScheduleTierUpgradeEmail(
                tierResult,
                previousTier,
                updatedCustomer._id,
                store._id,
                channel._id,
                point,
              );
            }
          }
        } catch (tierError) {
          console.error(
            `⚠️ Error recalculating tier for customer ${customer._id}:`,
            tierError.message,
          );
        }
      }

      // Schedule sign-up email via Agenda (only if points awarded; email sent only if enabled in collectSettings.emailSetting.signUp)
      if (pointsToAward > 0) {
        try {
          queueManager
            .addSignUpEmailJob({
              customerId: customer._id.toString(),
              storeId: store._id.toString(),
              channelId: channel._id.toString(),
              signupPoints: pointsToAward,
            })
            .catch(function (err) {
              console.warn(
                "[FavLoyalty] processCustomerCreatedWebhook: failed to schedule sign-up email job:",
                err && err.message,
              );
            });
        } catch (emailJobError) {
          console.warn(
            "[FavLoyalty] processCustomerCreatedWebhook: failed to schedule sign-up email job:",
            emailJobError && emailJobError.message,
          );
        }
      }

      results.push({
        channelId: numericChannelId,
        created: true,
        customerId: customer._id.toString(),
        signupPointsAwarded: pointsToAward,
      });
      console.log(
        `✅ Customer ${bcCustomerId} created for channel ${numericChannelId}; signup points awarded: ${pointsToAward}`,
      );
    }

    return {
      processed: true,
      bcCustomerId,
      channelId: firstChannelMongoId,
      created,
      signupPointsAwarded,
      results,
    };
  } catch (error) {
    console.error(
      "❌ Error processing customer created webhook:",
      error.message,
    );
    throw error;
  }
};

/**
 * Get webhook logs
 */
const getWebhookLogs = async (req, res, next) => {
  try {
    const { storeId } = req;
    const { channelId, scope, limit = 100 } = req.query;

    let logs;

    if (channelId) {
      logs = await WebhookLog.findByChannelId(channelId, parseInt(limit));
    } else if (scope) {
      logs = await WebhookLog.findByScope(storeId, scope, parseInt(limit));
    } else {
      logs = await WebhookLog.findByStoreId(storeId, parseInt(limit));
    }

    res.json({
      status: true,
      message: "Webhook logs fetched successfully",
      data: logs,
      count: logs.length,
    });
  } catch (error) {
    console.error("❌ Error fetching webhook logs:", error.message);
    next(error);
  }
};

/**
 * Delete a webhook subscription
 */
const unsubscribeWebhook = async (req, res, next) => {
  try {
    const { webhookId } = req.params;
    const { storeHash, storeId } = req;

    // Get store to access access token
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({
        status: false,
        message: "Store not found",
      });
    }

    await deleteWebhook(storeHash, store.access_token, webhookId);

    // Log webhook unsubscription
    try {
      await WebhookLog.create({
        endpoint: `/api/webhooks/unsubscribe/${webhookId}`,
        method: "DELETE",
        status: "success",
        responseCode: 200,
        store_id: storeId,
        webhookType: "bigcommerce",
        requestBody: { webhookId },
      });
    } catch (logError) {
      console.error(
        "❌ Error logging webhook unsubscription:",
        logError.message,
      );
    }

    res.json({
      status: true,
      message: "Webhook unsubscribed successfully",
    });
  } catch (error) {
    console.error("❌ Error unsubscribing webhook:", error.message);
    next(error);
  }
};

module.exports = {
  subscribeWebhook,
  getAllWebhooks,
  getWebhook,
  receiveWebhook,
  getWebhookLogs,
  unsubscribeWebhook,
};
