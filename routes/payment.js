const express = require("express");
const router = express.Router();
const paypalService = require("../services/paypalService");
const checkoutNodeJssdk = require("@paypal/checkout-server-sdk");
const Subscription = require("../models/Subscription");
const Plan = require("../models/Plan");
const Store = require("../models/Store");

// Test endpoint to verify PayPal credentials
router.get("/test-credentials", async (req, res) => {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  const mode = (process.env.PAYPAL_MODE || "sandbox").trim();

  const config = {
    hasClientId: !!clientId,
    hasClientSecret: !!clientSecret,
    clientIdLength: clientId?.length || 0,
    clientSecretLength: clientSecret?.length || 0,
    clientIdPreview: clientId ? `${clientId.substring(0, 20)}...` : "Not set",
    mode: mode,
  };

  // Test actual authentication
  try {
    const authTest = await paypalService.testAuthentication();
    res.json({
      ...config,
      authentication: authTest,
    });
  } catch (error) {
    res.json({
      ...config,
      authentication: {
        success: false,
        error: error.message,
      },
    });
  }
});

// One-time payment order creation
router.post("/create-order", async (req, res) => {
  const {
    value = "20.00",
    currency = "USD",
    returnUrl,
    cancelUrl,
    userId,
    channelId,
    storeId,
  } = req.body;

  // Build redirect URLs with query parameters
  const frontendBaseUrl =
    process.env.FRONTEND_BASE_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:3000";
  const defaultReturnPath = "/"; // Points & tier system page (main setup page)
  const defaultCancelPath = "/pricing";

  // Build return URL with query params
  let finalReturnUrl = returnUrl || `${frontendBaseUrl}${defaultReturnPath}`;
  if (userId || channelId || storeId) {
    const params = new URLSearchParams();
    if (userId) params.append("userId", userId);
    if (channelId) params.append("channelId", channelId);
    if (storeId) params.append("storeId", storeId);
    params.append("payment", "success");
    finalReturnUrl = `${finalReturnUrl}${finalReturnUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }

  // Build cancel URL
  let finalCancelUrl = cancelUrl || `${frontendBaseUrl}${defaultCancelPath}`;
  if (userId || channelId || storeId) {
    const params = new URLSearchParams();
    if (userId) params.append("userId", userId);
    if (channelId) params.append("channelId", channelId);
    if (storeId) params.append("storeId", storeId);
    params.append("payment", "cancelled");
    finalCancelUrl = `${finalCancelUrl}${finalCancelUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  }

  const request = new checkoutNodeJssdk.orders.OrdersCreateRequest();
  request.prefer("return=representation");
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: currency,
          value: value,
        },
      },
    ],
    application_context: {
      return_url: finalReturnUrl,
      cancel_url: finalCancelUrl,
      brand_name: "FavLoyalty",
      landing_page: "BILLING",
      user_action: "PAY_NOW",
    },
  });

  try {
    const order = await paypalService.client().execute(request);
    res.json({ id: order.result.id });
  } catch (err) {
    console.error("PayPal Order Creation Error:", {
      message: err.message,
      statusCode: err.statusCode,
      details: err.details || err,
      stack: err.stack,
    });

    // Extract more detailed error information
    let errorMessage = err.message;
    let errorDetails = null;

    // PayPal SDK errors often have details as a stringified JSON
    if (err.details) {
      try {
        if (typeof err.details === "string") {
          errorDetails = JSON.parse(err.details);
        } else {
          errorDetails = err.details;
        }
        errorMessage =
          errorDetails.error_description ||
          errorDetails.error ||
          errorDetails.message ||
          errorMessage;
      } catch (e) {
        // If parsing fails, try to extract from message
        if (err.message && err.message.includes("{")) {
          try {
            const match = err.message.match(/\{.*\}/);
            if (match) {
              errorDetails = JSON.parse(match[0]);
              errorMessage =
                errorDetails.error_description ||
                errorDetails.error ||
                errorMessage;
            }
          } catch (parseErr) {
            // If all parsing fails, use the original message
          }
        }
      }
    }

    // If it's an authentication error, provide helpful guidance
    if (
      errorMessage.includes("invalid_client") ||
      errorMessage.includes("Client Authentication failed")
    ) {
      errorMessage =
        "PayPal authentication failed. Please verify your PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in your .env file are correct and match your PayPal sandbox account. You may need to regenerate your credentials in the PayPal Developer Dashboard.";
    }

    res.status(err.statusCode || 500).json({
      error: errorMessage,
      details: errorDetails || err.details || null,
      statusCode: err.statusCode || 500,
      help: "Visit /api/payment/test-credentials to verify your PayPal credentials are configured correctly.",
    });
  }
});

// Capture payment after user approves
router.post("/capture-payment", async (req, res) => {
  const {
    orderID,
    storeId,
    planId,
    selectedOrderLimit,
    billingInterval = "EVERY_30_DAYS",
  } = req.body;

  // Validate orderID
  if (!orderID) {
    return res.status(400).json({
      error: "orderID is required",
      details: "Please provide the orderID in the request body",
    });
  }

  const request = new checkoutNodeJssdk.orders.OrdersCaptureRequest(orderID);
  request.requestBody({});

  try {
    const capture = await paypalService.client().execute(request);

    // Safely extract payment data
    const purchaseUnit = capture.result.purchase_units?.[0];
    const captureData = purchaseUnit?.payments?.captures?.[0];

    if (!captureData) {
      console.error(
        "Unexpected capture response structure:",
        JSON.stringify(capture.result, null, 2),
      );
      return res.status(500).json({
        error: "Unexpected response structure from PayPal",
        details: "Could not extract payment information from capture response",
      });
    }

    const paymentData = {
      id: capture.result.id,
      status: capture.result.status,
      amount: captureData.amount?.value,
      currency: captureData.amount?.currency_code,
      captureId: captureData.id,
      captureStatus: captureData.status,
      payer: capture.result.payer || null,
    };

    // Create subscription entry if storeId and planId are provided
    let subscription = null;
    if (storeId && planId) {
      try {
        // Verify store exists
        const store = await Store.findById(storeId);
        if (!store) {
          console.warn(`Store not found with ID: ${storeId}`);
          throw new Error(`Store not found with ID: ${storeId}`);
        }

        // Verify plan exists and get trial days
        const plan = await Plan.findById(planId);
        if (!plan) {
          console.warn(`Plan not found with ID: ${planId}`);
          throw new Error(`Plan not found with ID: ${planId}`);
        }

        // Determine trial days based on store's trialDaysRemaining
        // If null = first time subscriber, give full trial from plan
        // If has value = returning subscriber, give remaining trial days
        let trialDaysToGive;
        const defaultTrialDays = plan ? plan.trialDays : 14;
        
        if (store.trialDaysRemaining === null) {
          // First time subscriber - give full trial
          trialDaysToGive = defaultTrialDays;
          console.log(`📊 First time subscriber - giving full ${trialDaysToGive} day trial`);
        } else {
          // Returning subscriber - give remaining trial days (could be 0 if fully used)
          trialDaysToGive = Math.max(0, store.trialDaysRemaining);
          console.log(`📊 Returning subscriber - giving ${trialDaysToGive} remaining trial days (from store.trialDaysRemaining=${store.trialDaysRemaining})`);
        }

        // Create subscription
        subscription = await Subscription.createFromPayment({
          storeId,
          planId,
          paypalOrderId: orderID,
          amount: paymentData.amount,
          selectedOrderLimit:
            selectedOrderLimit || (plan ? plan.orderLimit : 750),
          billingInterval,
          trialDays: trialDaysToGive,
        });

        console.log("✅ Subscription created successfully:", subscription._id);

        // Update Store model with plan and trialDaysRemaining
        const trialDaysRemaining = trialDaysToGive;

        // Use the static method to update the store
        await Store.updatePlan(storeId, {
          plan: "paid",
          trialDaysRemaining: trialDaysRemaining,
          paypalSubscriptionId:
            subscription.paypalSubscriptionId ||
            subscription.paypalOrderId ||
            null,
        });
      } catch (subscriptionError) {
        console.error(
          "❌ Error creating subscription or updating store:",
          subscriptionError,
        );
        // Don't fail the payment if subscription creation fails
        // Payment was successful, subscription can be created manually if needed
      }
    }

    res.json({
      success: true,
      payment: paymentData,
      amount: paymentData.amount,
      subscription: subscription
        ? {
            id: subscription._id,
            status: subscription.status,
            planId: subscription.plan_id,
            storeId: subscription.store_id,
            nextBillingDate: subscription.nextBillingDate,
            trialEndsAt: subscription.trialEndsAt,
          }
        : null,
    });
  } catch (err) {
    console.error("PayPal Payment Capture Error:", {
      message: err.message,
      statusCode: err.statusCode,
      details: err.details || err,
      orderID: orderID,
      stack: err.stack,
    });

    // Extract more detailed error information
    let errorMessage = err.message;
    let errorDetails = null;

    // PayPal SDK errors often have details as a stringified JSON
    if (err.details) {
      try {
        if (typeof err.details === "string") {
          errorDetails = JSON.parse(err.details);
        } else {
          errorDetails = err.details;
        }
        errorMessage =
          errorDetails.details?.[0]?.description ||
          errorDetails.details?.[0]?.issue ||
          errorDetails.error_description ||
          errorDetails.message ||
          errorMessage;
      } catch (e) {
        // If parsing fails, try to extract from message
        if (err.message && err.message.includes("{")) {
          try {
            const match = err.message.match(/\{.*\}/);
            if (match) {
              errorDetails = JSON.parse(match[0]);
              errorMessage =
                errorDetails.error_description ||
                errorDetails.error ||
                errorMessage;
            }
          } catch (parseErr) {
            // If all parsing fails, use the original message
          }
        }
      }
    }

    // Provide helpful error messages for common issues
    if (
      errorMessage.includes("ORDER_NOT_APPROVED") ||
      errorMessage.includes("not approved")
    ) {
      errorMessage =
        "Order has not been approved yet. The order must be approved by the payer before it can be captured.";
    } else if (
      errorMessage.includes("ORDER_ALREADY_CAPTURED") ||
      errorMessage.includes("already captured")
    ) {
      errorMessage = "This order has already been captured.";
    } else if (
      errorMessage.includes("INVALID_RESOURCE_ID") ||
      errorMessage.includes("not found")
    ) {
      errorMessage =
        "Invalid order ID. The order may not exist or the orderID is incorrect.";
    }

    res.status(err.statusCode || 500).json({
      error: errorMessage,
      details: errorDetails || err.details || null,
      statusCode: err.statusCode || 500,
      orderID: orderID,
    });
  }
});

// Subscription creation (returns PayPal subscription approval link)
router.post("/create-subscription", async (req, res) => {
  const { plan_id } = req.body;
  const request =
    new checkoutNodeJssdk.subscriptions.SubscriptionsCreateRequest();
  request.requestBody({
    plan_id: plan_id,
  });

  try {
    const subscription = await paypalService.client().execute(request);
    res.json(subscription.result);
  } catch (err) {
    console.error("PayPal Payment Capture Error:", {
      message: err.message,
      statusCode: err.statusCode,
      details: err.details || err,
      stack: err.stack,
    });

    // Extract more detailed error information
    let errorMessage = err.message;
    if (err.details) {
      try {
        const details =
          typeof err.details === "string"
            ? JSON.parse(err.details)
            : err.details;
        errorMessage =
          details.error_description || details.message || errorMessage;
      } catch (e) {
        // If parsing fails, use the original message
      }
    }

    res.status(err.statusCode || 500).json({
      error: errorMessage,
      details: err.details || null,
    });
  }
});

// Capture subscription payment
router.post("/capture-subscription", async (req, res) => {
  const { subscriptionID } = req.body;

  try {
    // Handle subscription activation
    // You'd typically store subscription details in your database
    res.json({ success: true, subscriptionID });
  } catch (err) {
    console.error("PayPal Payment Capture Error:", {
      message: err.message,
      statusCode: err.statusCode,
      details: err.details || err,
      stack: err.stack,
    });

    // Extract more detailed error information
    let errorMessage = err.message;
    if (err.details) {
      try {
        const details =
          typeof err.details === "string"
            ? JSON.parse(err.details)
            : err.details;
        errorMessage =
          details.error_description || details.message || errorMessage;
      } catch (e) {
        // If parsing fails, use the original message
      }
    }

    res.status(err.statusCode || 500).json({
      error: errorMessage,
      details: err.details || null,
    });
  }
});

module.exports = router;
