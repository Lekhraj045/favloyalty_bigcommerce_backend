const axios = require("axios");
const jwt = require("jsonwebtoken");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const Customer = require("../models/Customer");
const Point = require("../models/Point");
const CollectSettings = require("../models/CollectSettings");
const RedeemSettings = require("../models/RedeemSettings");
const Transaction = require("../models/Transaction");
const WidgetCustomization = require("../models/WidgetCustomization");
const Referral = require("../models/Referral");
const Subscription = require("../models/Subscription");
const mongoose = require("mongoose");
const { syncChannelScript } = require("../services/bigcommerceScriptsService");
const { getExpiryDate } = require("../helpers/emailHelpers");
const {
  calculateAndUpdateCustomerTier,
  checkAndScheduleTierUpgradeEmail,
} = require("../helpers/tierHelper");
const queueManager = require("../queues/queueManager");
const { awardBirthdayPointsIfEligible } = require("../helpers/birthdayRewardHelper");

const TIER_NAMES = ["Silver", "Gold", "Platinum", "Diamond"];

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
        },
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
 * Resolve store, channel, and bcCustomerId from JWT payload or from fallback (storeHash + channelId + customerId).
 * Returns { store, channel, bcCustomerId, email } or sends error response and returns null.
 */
async function resolveCustomerContext(req, res, payloadOrFallback) {
  const isJwt =
    payloadOrFallback && payloadOrFallback.operation === "current_customer";
  let storeHash;
  let bcCustomerId;
  let email = null;

  if (isJwt) {
    const payload = payloadOrFallback;
    if (!payload.customer || !payload.store_hash) return null;
    storeHash = payload.store_hash;
    bcCustomerId = payload.customer.id;
    email = payload.customer.email || null;
  } else {
    const fallback = payloadOrFallback;
    if (!fallback.storeHash) return null;
    storeHash = fallback.storeHash;
    const raw = fallback.customerId;
    if (raw == null || raw === "") {
      bcCustomerId = 0;
    } else {
      bcCustomerId = typeof raw === "number" ? raw : parseInt(raw, 10);
      if (isNaN(bcCustomerId)) bcCustomerId = 0;
    }
  }

  const channelId = req.body.channelId;

  const store = await Store.findByHash(storeHash);
  console.log(
    "[FavLoyalty API] resolveCustomerContext: store lookup storeHash=",
    storeHash,
    "found=",
    !!store,
    "storeId=",
    store?._id?.toString(),
  );
  if (!store) {
    res.status(404).json({
      success: false,
      inLoyaltyProgram: false,
      message: "Store not found",
    });
    return null;
  }

  let channel;
  if (channelId != null && channelId !== "") {
    const id = channelId.toString().trim();
    if (mongoose.Types.ObjectId.isValid(id)) {
      channel = await Channel.findOne({ store_id: store._id, _id: id });
    }
    if (!channel && !isNaN(parseInt(id, 10))) {
      channel = await Channel.findOne({
        store_id: store._id,
        channel_id: parseInt(id, 10),
      });
    }
    console.log(
      "[FavLoyalty API] resolveCustomerContext: channel by channelId=",
      channelId,
      "found=",
      !!channel,
    );
  }
  if (!channel) {
    channel = await Channel.findOne({ store_id: store._id });
    console.log(
      "[FavLoyalty API] resolveCustomerContext: channel fallback found=",
      !!channel,
      "channel_id(BC)=",
      channel?.channel_id,
    );
  }
  if (!channel) {
    res.status(404).json({
      success: false,
      inLoyaltyProgram: false,
      message: "No channel found for store",
    });
    return null;
  }

  return { store, channel, bcCustomerId, email };
}

/**
 * Check if returning customer qualifies for rejoin bonus and award points if eligible.
 * Called as fire-and-forget from verifyCurrentCustomer so it doesn't block the widget response.
 *
 * Criteria:
 * 1. Rejoin feature is active (collectSettings.rejoin.active) and pointRejoin > 0
 * 2. customer.lastVisit is set (baseline exists)
 * 3. Days since lastVisit >= dayOfRecall
 * 4. No "Rejoining Bonus" transaction awarded today (race-condition guard)
 *
 * On success: awards points, schedules welcome-back email, updates lastVisit.
 * On any error: logs and silently swallows (must never break the widget).
 */
async function checkAndAwardRejoin({
  customer,
  store,
  channel,
  collectSettings,
}) {
  try {
    console.log(
      `[FavLoyalty Rejoin] Starting rejoin check for customer ${customer._id}, store ${store._id}, channel ${channel._id}`,
    );

    // 1. Is rejoin feature active?
    const rejoinConfig = collectSettings?.rejoin;
    if (!rejoinConfig || rejoinConfig.active !== true) {
      console.log(
        `[FavLoyalty Rejoin] Skipped: rejoin feature not active (active=${rejoinConfig?.active}, hasConfig=${!!rejoinConfig})`,
      );
      return;
    }

    const dayOfRecall = Number(rejoinConfig.dayOfRecall) || 0;
    const rejoinPoints = Number(rejoinConfig.pointRejoin) || 0;
    if (dayOfRecall <= 0 || rejoinPoints <= 0) {
      console.log(
        `[FavLoyalty Rejoin] Skipped: invalid config (dayOfRecall=${dayOfRecall}, pointRejoin=${rejoinPoints})`,
      );
      return;
    }

    console.log(
      `[FavLoyalty Rejoin] Config OK: dayOfRecall=${dayOfRecall}, rejoinPoints=${rejoinPoints}, lastVisit=${customer.lastVisit}, ordersCount=${customer.ordersCount}`,
    );

    // 2. lastVisit must exist (no baseline → set it now for future checks and return)
    if (!customer.lastVisit) {
      await Customer.updateLastVisit(customer._id);
      console.log(
        `[FavLoyalty Rejoin] No lastVisit for customer ${customer._id}, setting baseline now.`,
      );
      return;
    }

    // 3. Calculate days since last visit
    const now = new Date();
    const lastVisitDate = new Date(customer.lastVisit);
    const msSinceLastVisit = now.getTime() - lastVisitDate.getTime();
    const daysSinceLastVisit = Math.floor(
      msSinceLastVisit / (1000 * 60 * 60 * 24),
    );

    console.log(
      `[FavLoyalty Rejoin] daysSinceLastVisit=${daysSinceLastVisit}, lastVisitDate=${lastVisitDate.toISOString()}, now=${now.toISOString()}`,
    );

    if (daysSinceLastVisit < dayOfRecall) {
      // Not enough days elapsed — just update lastVisit so the timer resets
      await Customer.updateLastVisit(customer._id);
      console.log(
        `[FavLoyalty Rejoin] Skipped: not enough days elapsed (${daysSinceLastVisit} < ${dayOfRecall}), updated lastVisit`,
      );
      return;
    }

    // 4. Race-condition guard: check if already awarded "Rejoining Bonus" today
    //    (prevents double-award on rapid page refreshes)
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const existingRejoinTx = await Transaction.findOne({
      customerId: customer._id,
      store_id: store._id,
      channel_id: channel.channel_id,
      description: "Rejoining Bonus",
      createdAt: { $gte: todayStart, $lt: todayEnd },
    });

    if (existingRejoinTx) {
      // Already awarded today — just refresh lastVisit
      await Customer.updateLastVisit(customer._id);
      console.log(
        `[FavLoyalty Rejoin] Skipped: already awarded today for customer ${customer._id}`,
      );
      return;
    }

    console.log(
      `[FavLoyalty Rejoin] All checks passed — awarding ${rejoinPoints} points to customer ${customer._id}`,
    );

    // 5. Award rejoin points
    const pointModel = await Point.findOne({
      store_id: store._id,
      channel_id: channel._id,
    });
    const expiresInDays = pointModel?.expiriesInDays ?? null;
    const { expiryDate } = getExpiryDate(expiresInDays);

    await Customer.addTransaction(customer._id, {
      customerId: customer._id,
      store_id: store._id,
      channel_id: channel.channel_id,
      bcCustomerId: customer.bcCustomerId,
      type: "earn",
      transactionCategory: "other",
      points: rejoinPoints,
      description: "Rejoining Bonus",
      status: "completed",
      expiresAt: expiryDate,
      source: "rejoin",
      metadata: { daysSinceLastVisit },
    });

    console.log(
      `[FavLoyalty Rejoin] Awarded ${rejoinPoints} rejoin points to customer ${customer._id} (absent ${daysSinceLastVisit} days, recall threshold ${dayOfRecall})`,
    );

    // 6. Recalculate tier (points may push customer to a higher tier)
    if (pointModel) {
      try {
        const rawTier = customer.currentTier;
        const previousTier = rawTier
          ? {
              ...(typeof rawTier.toObject === "function"
                ? rawTier.toObject()
                : rawTier),
            }
          : null;

        console.log(
          `[FavLoyalty Rejoin] Recalculating tier for customer ${customer._id}, previousTier=${JSON.stringify(previousTier)}, tierStatus=${pointModel.tierStatus}`,
        );

        const tierResult = await calculateAndUpdateCustomerTier(
          customer,
          pointModel,
        );
        console.log(
          `[FavLoyalty Rejoin] Tier recalculation result: tierUpdated=${tierResult.tierUpdated}, message=${tierResult.message}`,
        );

        if (tierResult.tierUpdated) {
          console.log(
            `[FavLoyalty Rejoin] Tier upgraded after rejoin points: ${tierResult.message}`,
          );
          await checkAndScheduleTierUpgradeEmail(
            tierResult,
            previousTier,
            customer._id,
            store._id,
            channel._id,
            pointModel,
          );
        }
      } catch (tierErr) {
        console.warn(
          "[FavLoyalty Rejoin] Tier recalculation failed:",
          tierErr?.message || tierErr,
        );
      }
    } else {
      console.log(
        `[FavLoyalty Rejoin] Skipping tier recalculation: no pointModel found for store ${store._id}, channel ${channel._id}`,
      );
    }

    // 7. Schedule welcome-back email
    try {
      await queueManager.addRejoiningEmailJob({
        customerId: customer._id.toString(),
        storeId: store._id.toString(),
        channelId: channel._id.toString(),
        rejoiningPoints: rejoinPoints,
      });
    } catch (emailErr) {
      console.warn(
        "[FavLoyalty Rejoin] Failed to schedule rejoining email:",
        emailErr?.message || emailErr,
      );
    }

    // 8. Update lastVisit to current date
    await Customer.updateLastVisit(customer._id);
  } catch (err) {
    // Swallow all errors — rejoin logic must never break the widget
    console.error(
      "[FavLoyalty Rejoin] Unexpected error in checkAndAwardRejoin:",
      err?.message || err,
    );
  }
}

/**
 * If today is the customer's birthday (store timezone) and they are eligible, award birthday points + email.
 * Fire-and-forget from verifyCurrentCustomer so the widget stays fast.
 */
async function checkAndAwardBirthdayOnVisit({
  customer,
  store,
  channel,
  collectSettings,
}) {
  try {
    const result = await awardBirthdayPointsIfEligible({
      customer,
      store,
      channel,
      collectSettings,
      sendEmail: true,
    });
    if (result.awarded) {
      console.log(
        `[FavLoyalty Birthday] Auto-awarded ${result.pointsAwarded} points on visit for customer ${customer._id}`,
      );
    }
  } catch (err) {
    console.error(
      "[FavLoyalty Birthday] checkAndAwardBirthdayOnVisit:",
      err?.message || err,
    );
  }
}

/**
 * Verify current customer from BigCommerce Current Customer JWT (or fallback: storeHash + channelId + customerId) and return loyalty data if in DB
 * POST body: { currentCustomerJwt?, channelId?, storeHash?, customerId? } — use JWT when available; when CORS blocks JWT, use storeHash + channelId + customerId
 */
const verifyCurrentCustomer = async (req, res, next) => {
  try {
    const { currentCustomerJwt, channelId, storeHash, customerId } = req.body;

    console.log(
      "[FavLoyalty API] verifyCurrentCustomer: body keys=",
      Object.keys(req.body || {}),
      "hasJwt=",
      !!currentCustomerJwt,
      "jwtLength=",
      currentCustomerJwt && typeof currentCustomerJwt === "string"
        ? currentCustomerJwt.length
        : 0,
      "channelId=",
      channelId,
      "storeHash=",
      storeHash || "(missing)",
      "customerId=",
      customerId ?? "(missing)",
    );

    let context = null;

    if (currentCustomerJwt && typeof currentCustomerJwt === "string") {
      const clientSecret = process.env.CLIENT_SECRET;
      if (!clientSecret) {
        console.log(
          "[FavLoyalty API] verifyCurrentCustomer: 500 - CLIENT_SECRET not set",
        );
        return res.status(500).json({
          success: false,
          inLoyaltyProgram: false,
          message: "Server configuration error",
        });
      }
      let payload;
      try {
        payload = jwt.verify(currentCustomerJwt, clientSecret, {
          algorithms: ["HS256"],
        });
        console.log(
          "[FavLoyalty API] verifyCurrentCustomer: JWT decoded ok, operation=",
          payload.operation,
          "store_hash=",
          payload.store_hash,
          "customer.id=",
          payload.customer?.id,
        );
      } catch (err) {
        console.log(
          "[FavLoyalty API] verifyCurrentCustomer: 401 - JWT verify failed",
          err.message,
        );
        return res.status(401).json({
          success: false,
          inLoyaltyProgram: false,
          message: "Invalid or expired customer token",
        });
      }
      if (
        payload.operation !== "current_customer" ||
        !payload.customer ||
        !payload.store_hash
      ) {
        return res.status(400).json({
          success: false,
          inLoyaltyProgram: false,
          message: "Invalid token payload",
        });
      }
      context = await resolveCustomerContext(req, res, payload);
    } else if (storeHash && channelId != null && channelId !== "") {
      // Allow empty customerId so widget can open immediately and show loading; backend returns inLoyaltyProgram: false until real customerId is sent
      console.log(
        "[FavLoyalty API] verifyCurrentCustomer: using fallback (storeHash + channelId + customerId)",
      );
      context = await resolveCustomerContext(req, res, {
        storeHash,
        channelId,
        customerId: customerId ?? "",
      });
    } else {
      console.log(
        "[FavLoyalty API] verifyCurrentCustomer: 400 - need JWT or (storeHash + channelId)",
      );
      return res.status(400).json({
        success: false,
        inLoyaltyProgram: false,
        message: "Current customer JWT or (storeHash + channelId) required",
      });
    }

    if (!context) return;

    const { store, channel, bcCustomerId, email } = context;

    // Fetch collect settings for widget (e.g. Refer & Earn enabled/points)
    const collectSettings = await CollectSettings.findByStoreAndChannel(
      store._id,
      channel._id,
    );
    const referAndEarnEnabled = collectSettings?.referAndEarn?.active === true;
    const referAndEarnPoints = collectSettings?.referAndEarn?.point ?? 0;

    const customerQuery = {
      store_id: store._id,
      channel_id: channel.channel_id,
      bcCustomerId: bcCustomerId,
    };
    console.log(
      "[FavLoyalty API] verifyCurrentCustomer: customer query=",
      JSON.stringify({
        store_id: store._id.toString(),
        channel_id: channel.channel_id,
        bcCustomerId,
      }),
    );

    const customer = await Customer.findOne(customerQuery).lean();

    console.log(
      "[FavLoyalty API] verifyCurrentCustomer: customer found=",
      !!customer,
      "customerId=",
      customer?._id?.toString(),
    );

    if (!customer) {
      return res.json({
        success: true,
        inLoyaltyProgram: false,
        bcCustomerId,
        email,
        message: "Customer not in loyalty program",
        referAndEarnEnabled,
        referAndEarnPoints,
      });
    }

    const pointConfig = await Point.findOne({
      store_id: store._id,
      channel_id: channel._id,
    }).lean();

    const pointsUnit = pointConfig?.pointName || "Points";
    const points = customer.points || 0;
    const tierSystemEnabled =
      pointConfig?.tierStatus === true &&
      Array.isArray(pointConfig?.tier) &&
      pointConfig.tier.length > 0;
    let tierDisplay = null;
    let tierIndex = null;
    let tierMultiplier = null;
    if (tierSystemEnabled && customer.currentTier != null) {
      tierIndex = customer.currentTier.tierIndex ?? 0;
      const sortedTiers = [...(pointConfig.tier || [])].sort(
        (a, b) => (a.pointRequired || 0) - (b.pointRequired || 0),
      );
      const tierAt = sortedTiers[tierIndex];
      tierDisplay = tierAt?.tierName || TIER_NAMES[tierIndex] || "Bronze";
      if (
        tierAt?.multiplier != null &&
        typeof tierAt.multiplier === "number" &&
        tierAt.multiplier > 0
      ) {
        tierMultiplier = tierAt.multiplier;
      }
    }
    const userName = customer.firstName
      ? `${customer.firstName} ${customer.lastName || ""}`.trim()
      : customer.email || "Guest";

    // Equivalent value from fixed discount (store credit) on Ways to Redeem: points -> currency
    let equivalentValue = 0;
    const redeemList = await RedeemSettings.findByStoreAndChannel(
      store._id,
      channel._id,
    );
    const fixedDiscount = Array.isArray(redeemList)
      ? redeemList.find(
          (r) =>
            r.redeemType === "storeCredit" &&
            r.coupon?.active &&
            (r.coupon?.value || 0) > 0 &&
            (r.coupon?.discountAmount ?? 0) >= 0,
        )
      : null;
    if (fixedDiscount?.coupon) {
      const value = Number(fixedDiscount.coupon.value) || 1;
      const discountAmount = Number(fixedDiscount.coupon.discountAmount) || 0;
      equivalentValue =
        Math.round((points / value) * discountAmount * 100) / 100;
    }

    // Check if customer has already used Complete Profile (received Profile Completion points once)
    const existingProfileTx = await Transaction.findOne({
      customerId: customer._id,
      store_id: store._id,
      channel_id: channel.channel_id,
      description: "Profile Completion",
    });

    // Check if customer has already subscribed to newsletter (received Newsletter Subscription points once)
    const existingNewsletterTx = await Transaction.findOne({
      customerId: customer._id,
      store_id: store._id,
      channel_id: channel.channel_id,
      description: "Newsletter Subscription",
    });

    const birthdayYear = new Date().getFullYear();
    const birthdayYearStart = new Date(birthdayYear, 0, 1);
    const birthdayYearEnd = new Date(birthdayYear, 11, 31, 23, 59, 59);
    const existingBirthdayCelebrationTx = await Transaction.findOne({
      customerId: customer._id,
      store_id: store._id,
      channel_id: channel.channel_id,
      description: "Birthday Celebration",
      createdAt: { $gte: birthdayYearStart, $lte: birthdayYearEnd },
    });

    // Fire-and-forget: check rejoin eligibility and award points if criteria met
    // This runs in the background and never blocks the widget response
    checkAndAwardRejoin({ customer, store, channel, collectSettings }).catch(
      (err) =>
        console.error(
          "[FavLoyalty Rejoin] fire-and-forget error:",
          err?.message || err,
        ),
    );

    checkAndAwardBirthdayOnVisit({
      customer,
      store,
      channel,
      collectSettings,
    }).catch((err) =>
      console.error(
        "[FavLoyalty Birthday] fire-and-forget error:",
        err?.message || err,
      ),
    );

    console.log(
      "[FavLoyalty API] verifyCurrentCustomer: 200 inLoyaltyProgram=true userName=",
      userName,
      "points=",
      customer.points,
    );

    res.json({
      success: true,
      inLoyaltyProgram: true,
      userName,
      name: userName,
      email: customer.email,
      points,
      pointsUnit,
      equivalentValue,
      currency: store.currency || "USD",
      tierSystemEnabled: !!tierSystemEnabled,
      tierDisplay: tierDisplay ?? undefined,
      tierIndex: tierIndex != null ? tierIndex : undefined,
      tierMultiplier: tierMultiplier != null ? tierMultiplier : undefined,
      referAndEarnEnabled,
      referAndEarnPoints,
      hasBirthday: !!(customer.dob != null && customer.dob !== undefined),
      /** YYYY-MM-DD for widget display / prefill when updating DOB */
      dob:
        customer.dob != null
          ? (() => {
              const t = new Date(customer.dob).getTime();
              return Number.isNaN(t)
                ? undefined
                : new Date(customer.dob).toISOString().slice(0, 10);
            })()
          : undefined,
      /** True when birthday points were already awarded this calendar year (matches earn logic). */
      birthdayRewardClaimedThisYear: !!existingBirthdayCelebrationTx,
      hasCompletedProfile: !!existingProfileTx,
      hasSubscribedNewsletter: !!existingNewsletterTx,
    });
  } catch (error) {
    console.error("Error verifying current customer:", error);
    next(error);
  }
};

/**
 * Return a short-lived storefront API token for the store so the widget loader can call the store's GraphQL (customer query) from the browser.
 * GET /api/widget/storefront-token?storeHash=xxx&origin=xxx&channelId=yyy (channelId optional; use correct channel for multi-storefront)
 * See: https://developer.bigcommerce.com/docs/start/authentication/graphql-storefront
 * Requires app OAuth scope: Storefront API tokens creation (or "Content" may include it).
 */
const getStorefrontToken = async (req, res, next) => {
  try {
    const { storeHash, origin, channelId } = req.query;
    if (!storeHash || !origin) {
      return res.status(400).json({
        success: false,
        message: "storeHash and origin query params are required",
      });
    }
    const store = await Store.findByHash(storeHash);
    if (!store || !store.access_token) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }
    // Use the store's channel so the token is valid for the frontend (avoids 401 on some storefronts)
    let numericChannelIds = [1];
    if (channelId && String(channelId).trim()) {
      const id = String(channelId).trim();
      const channelByMongoId = mongoose.Types.ObjectId.isValid(id)
        ? await Channel.findOne({
            store_id: store._id,
            _id: new mongoose.Types.ObjectId(id),
          })
        : null;
      const channelByBcId =
        !channelByMongoId && !isNaN(parseInt(id, 10))
          ? await Channel.findOne({
              store_id: store._id,
              channel_id: parseInt(id, 10),
            })
          : null;
      const channel = channelByMongoId || channelByBcId;
      if (channel && channel.channel_id != null) {
        numericChannelIds = [channel.channel_id];
      }
    }
    // BigCommerce rejects allowed_cors_origins with trailing slash or path — normalize to origin only, no trailing slash
    const normalizedOrigin =
      String(origin || "")
        .trim()
        .replace(/\/+$/, "") || origin;
    const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const url = `https://api.bigcommerce.com/stores/${store.store_hash}/v3/storefront/api-token`;
    const body = {
      channel_ids: numericChannelIds,
      expires_at: expiresAt,
      allowed_cors_origins: [normalizedOrigin],
    };
    let response;
    try {
      response = await axios.post(url, body, {
        headers: {
          "X-Auth-Token": store.access_token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });
    } catch (bcError) {
      const status = bcError?.response?.status;
      const data = bcError?.response?.data;
      console.error(
        "[FavLoyalty] getStorefrontToken: BigCommerce API error:",
        status,
        data,
      );
      const message =
        data?.title ||
        data?.detail ||
        (status === 403
          ? "Missing OAuth scope: ensure app has Storefront API tokens creation scope and re-authorize the app"
          : "Failed to create storefront token");
      // Forward 4xx from BigCommerce (403 scope, 400/422 validation) so client sees real error
      const httpStatus = status >= 400 && status < 500 ? status : 502;
      return res.status(httpStatus).json({
        success: false,
        message,
      });
    }
    const token = response.data?.token ?? response.data?.data?.token;
    if (!token) {
      console.error(
        "[FavLoyalty] getStorefrontToken: no token in response:",
        JSON.stringify(response.data).slice(0, 200),
      );
      return res.status(502).json({
        success: false,
        message: "Failed to create storefront token (invalid response)",
      });
    }
    res.json({ success: true, token });
  } catch (error) {
    console.error(
      "Error getting storefront token:",
      error?.response?.data ?? error.message,
    );
    res.status(502).json({
      success: false,
      message:
        error?.response?.data?.title ||
        error?.response?.data?.detail ||
        "Failed to get storefront token",
    });
  }
};

/**
 * Return channel settings for the widget (e.g. Refer & Earn enabled/points).
 * GET /api/widget/channel-settings?storeHash=xxx&channelId=yyy
 * Used so the widget can show Refer card enabled/disabled even for guests.
 */
const getWidgetChannelSettings = async (req, res, next) => {
  try {
    const { storeHash, channelId } = req.query;
    if (!storeHash || !channelId) {
      return res.status(400).json({
        success: false,
        message: "storeHash and channelId query params are required",
      });
    }
    const store = await Store.findByHash(storeHash);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }
    if (!mongoose.Types.ObjectId.isValid(channelId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid channelId format",
      });
    }
    const collectSettings = await CollectSettings.findByStoreAndChannel(
      store._id,
      new mongoose.Types.ObjectId(channelId),
    );
    const referAndEarnEnabled = collectSettings?.referAndEarn?.active === true;
    const referAndEarnPoints = collectSettings?.referAndEarn?.point ?? 0;

    // Points logo from Points & Tier System (prefer customLogo, else default logo)
    let pointsLogoSrc = null;
    const pointConfig = await Point.findOne({
      store_id: store._id,
      channel_id: new mongoose.Types.ObjectId(channelId),
    }).lean();
    if (pointConfig) {
      const logoObj = pointConfig.customLogo?.src
        ? pointConfig.customLogo
        : pointConfig.logo;
      if (logoObj?.src) {
        if (logoObj.src.startsWith("http") || logoObj.src.startsWith("data:")) {
          pointsLogoSrc = logoObj.src;
        } else if (/^point-icon\d\.svg$/i.test(logoObj.src)) {
          pointsLogoSrc = logoObj.src;
        } else {
          const baseUrl = process.env.BACKEND_URL || process.env.API_URL || "";
          const path = logoObj.src.startsWith("/")
            ? logoObj.src
            : `/${logoObj.src}`;
          pointsLogoSrc = baseUrl.replace(/\/$/, "") + path;
        }
      } else if (logoObj?.name && /^point-icon\d\.svg$/i.test(logoObj.name)) {
        pointsLogoSrc = logoObj.name;
      }
    }
    if (!pointsLogoSrc) pointsLogoSrc = "point-icon1.svg";
    const pointsUnit = pointConfig?.pointName || "Points";

    // Announcements from Customise Widget (only enabled with image)
    let announcements = [];
    const customization = await WidgetCustomization.findByStoreAndChannel(
      store._id,
      new mongoose.Types.ObjectId(channelId),
    );
    if (customization?.announcements?.length) {
      const baseUrl = process.env.BACKEND_URL || process.env.API_URL || "";
      announcements = customization.announcements
        .filter((a) => a.enable === true && a.image)
        .map((a) => {
          let imageUrl = a.image;
          if (
            imageUrl &&
            !imageUrl.startsWith("http") &&
            !imageUrl.startsWith("data:")
          ) {
            const path = imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`;
            imageUrl = baseUrl.replace(/\/$/, "") + path;
          }
          return { image: imageUrl, link: a.link || null };
        });
    }

    // Widget theme from Customise Widget (header color, heading text color, icon color, background pattern, launcher icon)
    const widgetBgColor = customization?.widgetBgColor || "#62a63f";
    const headingColor = customization?.headingColor ?? "#ffffff";
    const widgetIconColor = customization?.widgetIconColor ?? "#ffffff";
    const widgetIconUrlId = customization?.widgetIconUrlId || null;
    const backgroundPatternEnabled = !!customization?.backgroundPatternEnabled;
    const backgroundPatternUrlId =
      customization?.backgroundPatternUrlId || null;
    // Launcher display: IconOnly | LabelOnly | Icon&Label; Label text when label is shown
    const launcherType = customization?.LauncherType || "IconOnly";
    const label =
      customization?.Label != null && String(customization.Label).trim() !== ""
        ? String(customization.Label).trim()
        : "Reward";

    // Placement of widget on storefront (from "Placement of widget on your website")
    const widgetButton = customization?.widgetButton || "Bottom-Right";
    const positionMap = {
      "Top-Left": "top-left",
      "Top-Right": "top-right",
      "Bottom-Left": "bottom-left",
      "Bottom-Right": "bottom-right",
    };
    const position = positionMap[widgetButton] || "bottom-right";

    // Ways to earn (from Ways to Earn page): show/hide and points for widget Earn Points cards
    const waysToEarn = {
      birthday: {
        enabled: !!collectSettings?.basic?.birthday?.active,
        points: collectSettings?.basic?.birthday?.point ?? 0,
      },
      profileCompletion: {
        enabled: !!collectSettings?.basic?.profileComplition?.active,
        points: collectSettings?.basic?.profileComplition?.point ?? 0,
      },
      newsletter: {
        enabled: !!collectSettings?.basic?.subucribing?.active,
        points: collectSettings?.basic?.subucribing?.point ?? 0,
      },
      everyPurchase: {
        enabled: !!collectSettings?.basic?.spent?.active,
        points: collectSettings?.basic?.spent?.point ?? 0,
      },
    };

    return res.json({
      success: true,
      referAndEarnEnabled,
      referAndEarnPoints,
      pointsLogoSrc: pointsLogoSrc || "point-icon1.svg",
      pointsUnit,
      announcements,
      widgetBgColor,
      headingColor,
      widgetIconColor,
      widgetIconUrlId,
      backgroundPatternEnabled,
      backgroundPatternUrlId,
      launcherType,
      label,
      position,
      waysToEarn,
    });
  } catch (error) {
    console.error("Error getting widget channel settings:", error);
    next(error);
  }
};

/**
 * Check if widget should be visible based on channel setup status and widget_visibility flag
 */
const checkWidgetVisibility = async (req, res, next) => {
  try {
    const { storeId, storeHash, channelId } = req.query;

    // Support lookup by storeId (dashboard) or storeHash (widget-loader on storefront)
    let store = null;
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      store = await Store.findById(storeId);
    } else if (storeHash) {
      store = await Store.findOne({ store_hash: storeHash, is_active: true });
    } else {
      return res.status(400).json({
        success: false,
        visible: false,
        message: "storeId or storeHash is required",
      });
    }

    if (!store) {
      return res.status(404).json({
        success: false,
        visible: false,
        message: "Store not found",
      });
    }

    // Check if the store's order limit is reached — widget must be hidden when limit is hit
    const activeSubscription = await Subscription.findActiveByStore(store._id);
    const limitReached = activeSubscription?.limitReached || false;

    if (limitReached) {
      return res.json({
        success: true,
        visible: false,
        reason: "Order limit reached — widget disabled until subscription renews",
        limitReached: true,
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

      // Final visibility: setup complete AND widget_visibility is true AND limit not reached
      const isVisible = isSetupComplete && channel.widget_visibility !== false;

      return res.json({
        success: true,
        visible: isVisible,
        reason: isVisible
          ? "Widget is active"
          : isSetupComplete
            ? "Widget disabled for this channel"
            : "Setup not complete",
        limitReached: false,
        setupProgress: channel.setupprogress || 0,
        pointsTierSystemCompleted: channel.pointsTierSystemCompleted || false,
        waysToEarnCompleted: channel.waysToEarnCompleted || false,
        waysToRedeemCompleted: channel.waysToRedeemCompleted || false,
        customiseWidgetCompleted: channel.customiseWidgetCompleted || false,
      });
    }

    // If no channelId, check if any channel has completed setup and is not disabled
    const channels = await Channel.findByStoreId(store._id.toString());
    const hasActiveChannel = channels.some(
      (channel) =>
        channel.pointsTierSystemCompleted &&
        channel.waysToEarnCompleted &&
        channel.waysToRedeemCompleted &&
        channel.customiseWidgetCompleted &&
        channel.widget_visibility !== false,
    );

    return res.json({
      success: true,
      visible: hasActiveChannel,
      reason: hasActiveChannel
        ? "At least one channel is active"
        : "No active channels found",
      limitReached: false,
      channelCount: channels.length,
    });
  } catch (error) {
    console.error("Error checking widget visibility:", error);
    next(error);
  }
};

/**
 * Update widget visibility for a specific channel
 * Used by the dashboard "Disable/Enable widget" button
 */
const updateWidgetVisibility = async (req, res, next) => {
  try {
    const { channelId, visible } = req.body;

    if (!req.storeId) {
      return res.status(401).json({
        success: false,
        message: "Store context is required",
      });
    }

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

    // Ensure the channel belongs to the authenticated store
    const channel = await Channel.findOne({
      _id: channelId,
      store_id: req.storeId,
    });

    if (!channel) {
      return res.status(404).json({
        success: false,
        message: "Channel not found",
      });
    }

    // If trying to enable the widget, ensure setup is complete (setupprogress === 4)
    if (visible && (channel.setupprogress || 0) < 4) {
      return res.status(400).json({
        success: false,
        message: "To enable the widget, please finish the setup first",
      });
    }

    // Perform the update
    channel.widget_visibility = !!visible;
    await channel.save();

    // Sync BigCommerce script: create when setupprogress 4 & widget_visibility true, else delete
    if (req.store) {
      await syncChannelScript(req.store, channel);
    }

    return res.json({
      success: true,
      message: "Widget visibility updated successfully",
      data: {
        channelId: channel._id.toString(),
        widget_visibility: channel.widget_visibility,
      },
    });
  } catch (error) {
    console.error("Error updating widget visibility:", error);
    next(error);
  }
};

/**
 * Get transaction history + summary for the widget customer.
 * POST body: same as current-customer — currentCustomerJwt? or storeHash + channelId + customerId?
 * Returns { success, summary: { available, earned, spent }, transactions: [...] }
 */
const getWidgetTransactions = async (req, res, next) => {
  try {
    const { currentCustomerJwt, channelId, storeHash, customerId } = req.body;

    let context = null;
    if (currentCustomerJwt && typeof currentCustomerJwt === "string") {
      const clientSecret = process.env.CLIENT_SECRET;
      if (!clientSecret) {
        return res.status(500).json({
          success: false,
          message: "Server configuration error",
        });
      }
      let payload;
      try {
        payload = jwt.verify(currentCustomerJwt, clientSecret, {
          algorithms: ["HS256"],
        });
      } catch (err) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired customer token",
        });
      }
      if (
        payload.operation !== "current_customer" ||
        !payload.customer ||
        !payload.store_hash
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid token payload",
        });
      }
      context = await resolveCustomerContext(req, res, payload);
    } else if (storeHash && channelId != null && channelId !== "") {
      context = await resolveCustomerContext(req, res, {
        storeHash,
        channelId,
        customerId: customerId ?? "",
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Current customer JWT or (storeHash + channelId) required",
      });
    }

    if (!context) return;

    const { store, channel, bcCustomerId } = context;
    const numericChannelId = channel.channel_id;

    const customer = await Customer.findOne({
      store_id: store._id,
      channel_id: numericChannelId,
      bcCustomerId,
    }).lean();

    if (!customer) {
      return res.json({
        success: true,
        summary: { available: 0, earned: 0, spent: 0 },
        transactions: [],
        pointsUnit: "Points",
      });
    }

    const available = customer.points ?? 0;

    const pointConfig = await Point.findOne({
      store_id: store._id,
      channel_id: channel._id,
    }).lean();
    const pointName = pointConfig?.pointName || "Points";

    const txList = await Transaction.find({
      customerId: customer._id,
      channel_id: numericChannelId,
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    let earned = 0;
    let spent = 0;
    const transactions = txList.map((tx) => {
      const pts = tx.points ?? 0;
      if (pts > 0) earned += pts;
      else if (pts < 0) spent += Math.abs(pts);
      const d = tx.createdAt ? new Date(tx.createdAt) : new Date();
      const rawTitle =
        tx.description ||
        (tx.transactionCategory === "signup" && "Sign Up Bonus") ||
        (tx.transactionCategory === "referral" && "Referral Bonus") ||
        (tx.transactionCategory === "order" && "Product Purchase") ||
        (tx.type === "redeem" && "Points Redeemed") ||
        (tx.type === "expiration" && "Points Expired") ||
        (tx.type === "refund" && "Refund") ||
        (tx.type === "adjustment" && "Adjustment") ||
        "Points";
      const title = String(rawTitle).replace(/\bPoints\b/g, pointName);
      return {
        id: tx._id.toString(),
        title,
        date: d.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }),
        time: d.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        }),
        amount: pts >= 0 ? `+${pts.toFixed(2)}` : `${pts.toFixed(2)}`,
        points: pts,
        createdAt: tx.createdAt,
      };
    });

    return res.json({
      success: true,
      summary: {
        available,
        earned,
        spent,
      },
      transactions,
      pointsUnit: pointName,
    });
  } catch (err) {
    console.error("Error getting widget transactions:", err);
    next(err);
  }
};

/**
 * Create a referral (Refer & Earn). Same auth as verifyCurrentCustomer.
 * POST body: { referredEmail, currentCustomerJwt? } or { referredEmail, storeHash, channelId, customerId }
 * Returns 400 with error "already_customer" when referred email is already a customer on this storefront (widget shows error on card).
 */
const createReferral = async (req, res, next) => {
  try {
    const {
      currentCustomerJwt,
      channelId,
      storeHash,
      customerId,
      referredEmail,
    } = req.body;

    const trimmedEmail =
      referredEmail != null ? String(referredEmail).trim() : "";
    if (!trimmedEmail) {
      return res.status(400).json({
        success: false,
        error: "invalid_email",
        message: "Please enter a valid email address.",
      });
    }

    let context = null;
    if (currentCustomerJwt && typeof currentCustomerJwt === "string") {
      const clientSecret = process.env.CLIENT_SECRET;
      if (!clientSecret) {
        return res.status(500).json({
          success: false,
          message: "Server configuration error",
        });
      }
      let payload;
      try {
        payload = jwt.verify(currentCustomerJwt, clientSecret, {
          algorithms: ["HS256"],
        });
      } catch (err) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired customer token",
        });
      }
      if (
        payload.operation !== "current_customer" ||
        !payload.customer ||
        !payload.store_hash
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid token payload",
        });
      }
      context = await resolveCustomerContext(req, res, payload);
    } else if (storeHash && channelId != null && channelId !== "") {
      context = await resolveCustomerContext(req, res, {
        storeHash,
        channelId,
        customerId: customerId ?? "",
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Current customer JWT or (storeHash + channelId) required",
      });
    }

    if (!context) return;

    const { store, channel, bcCustomerId, email: referrerEmail } = context;
    const numericChannelId = channel.channel_id;

    const customer = await Customer.findOne({
      store_id: store._id,
      channel_id: numericChannelId,
      bcCustomerId,
    });
    if (!customer) {
      return res.status(403).json({
        success: false,
        error: "not_in_loyalty",
        message: "You must be in the loyalty program to refer friends.",
      });
    }

    const collectSettings = await CollectSettings.findByStoreAndChannel(
      store._id,
      channel._id,
    );
    const referAndEarnEnabled = collectSettings?.referAndEarn?.active === true;
    const referAndEarnPoints =
      Number(collectSettings?.referAndEarn?.point) || 0;
    if (!referAndEarnEnabled || referAndEarnPoints <= 0) {
      return res.status(400).json({
        success: false,
        error: "refer_disabled",
        message: "Refer & Earn is not enabled for this store.",
      });
    }

    const normalizedReferred = trimmedEmail.toLowerCase();
    const normalizedReferrer =
      referrerEmail != null ? String(referrerEmail).trim().toLowerCase() : "";
    if (normalizedReferred === normalizedReferrer) {
      return res.status(400).json({
        success: false,
        error: "self_referral",
        message: "You cannot refer yourself.",
      });
    }

    const existingCustomer = await Customer.findOne({
      store_id: store._id,
      channel_id: numericChannelId,
      email: {
        $regex: new RegExp(
          `^${normalizedReferred.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          "i",
        ),
      },
    });
    if (existingCustomer) {
      return res.status(400).json({
        success: false,
        error: "already_customer",
        message: "This person is already a customer on this store.",
      });
    }

    const existingPending = await Referral.findOne({
      store_id: store._id,
      channel_id: numericChannelId,
      referrer_user_id: customer._id,
      referred_user_email: normalizedReferred,
      status: { $in: ["Pending", "Referred Claimed"] },
    });
    if (existingPending) {
      return res.status(200).json({
        success: true,
        message: "You have already referred this email.",
      });
    }

    await Referral.create({
      store_id: store._id,
      channel_id: numericChannelId,
      referral_points: referAndEarnPoints,
      referred_user_email: normalizedReferred,
      referrer_user_id: customer._id,
      referred_user_id: null,
      status: "Pending",
    });

    try {
      await queueManager.addReferralInvitationEmailJob({
        referrerCustomerId: customer._id.toString(),
        referredEmail: normalizedReferred,
        storeId: store._id.toString(),
        channelId: channel._id.toString(),
      });
    } catch (emailJobError) {
      console.warn(
        "[FavLoyalty] createReferral: failed to schedule referral invitation email:",
        emailJobError?.message,
      );
    }

    return res.status(201).json({
      success: true,
      message:
        "Referral sent! Your friend will get signup points when they join, and you'll earn points after their first order is completed.",
    });
  } catch (err) {
    console.error("Error creating referral:", err);
    next(err);
  }
};

/**
 * Get current customer's referrals for the widget (Refer & Earn card / history).
 * POST body: same as verifyCurrentCustomer — currentCustomerJwt? or storeHash + channelId + customerId
 */
const getMyReferrals = async (req, res, next) => {
  try {
    const { currentCustomerJwt, channelId, storeHash, customerId } = req.body;

    let context = null;
    if (currentCustomerJwt && typeof currentCustomerJwt === "string") {
      const clientSecret = process.env.CLIENT_SECRET;
      if (!clientSecret) {
        return res.status(500).json({
          success: false,
          message: "Server configuration error",
        });
      }
      let payload;
      try {
        payload = jwt.verify(currentCustomerJwt, clientSecret, {
          algorithms: ["HS256"],
        });
      } catch (err) {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired customer token",
        });
      }
      if (
        payload.operation !== "current_customer" ||
        !payload.customer ||
        !payload.store_hash
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid token payload",
        });
      }
      context = await resolveCustomerContext(req, res, payload);
    } else if (storeHash && channelId != null && channelId !== "") {
      context = await resolveCustomerContext(req, res, {
        storeHash,
        channelId,
        customerId: customerId ?? "",
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Current customer JWT or (storeHash + channelId) required",
      });
    }

    if (!context) return;

    const { store, channel, bcCustomerId } = context;
    const numericChannelId = channel.channel_id;

    const customer = await Customer.findOne({
      store_id: store._id,
      channel_id: numericChannelId,
      bcCustomerId,
    }).lean();
    if (!customer) {
      return res.json({ success: true, referrals: [] });
    }

    const referrals = await Referral.find({
      referrer_user_id: customer._id,
      store_id: store._id,
      channel_id: numericChannelId,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const list = referrals.map((r) => ({
      id: r._id?.toString(),
      referredEmail: r.referred_user_email,
      status: r.status,
      referralPoints: r.referral_points,
      createdAt: r.createdAt,
      completedAt: r.status === "Completed" ? r.updatedAt : null,
    }));

    return res.json({ success: true, referrals: list });
  } catch (err) {
    console.error("Error getting my referrals:", err);
    next(err);
  }
};

/**
 * Save customer birthday (DOB) and optionally award points from channel Ways to Earn "Birthday" setting.
 * POST body: { storeHash, channelId, customerId (BC id), dob (ISO date string e.g. "1990-05-15") }
 */
const saveCustomerBirthday = async (req, res, next) => {
  try {
    const {
      storeHash,
      channelId,
      customerId: bcCustomerIdRaw,
      dob: dobRaw,
    } = req.body;
    if (!storeHash || channelId == null || channelId === "" || !dobRaw) {
      return res.status(400).json({
        success: false,
        message: "storeHash, channelId, and dob are required",
      });
    }
    const dobDate = new Date(dobRaw);
    if (isNaN(dobDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid dob date",
      });
    }

    const context = await resolveCustomerContext(req, res, {
      storeHash,
      channelId,
      customerId: bcCustomerIdRaw ?? "",
    });
    if (!context) return;

    const { store, channel } = context;
    const bcCustomerId = context.bcCustomerId;
    if (!bcCustomerId) {
      return res.status(400).json({
        success: false,
        message: "Customer ID is required to save birthday",
      });
    }

    const customer = await Customer.findOne({
      store_id: store._id,
      channel_id: channel.channel_id,
      bcCustomerId,
    });
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found in loyalty program",
      });
    }

    // 1) Update DOB in customers table
    await Customer.updateCustomer(customer._id, { dob: dobDate });

    // 2) Check channel Ways to Earn "Birthday" — if disabled or 0 points, do not award
    const collectSettings = await CollectSettings.findOne({
      store_id: store._id,
      channel_id: channel._id,
    });
    if (!collectSettings?.basic?.birthday?.active) {
      return res.json({
        success: true,
        message: "Birthday saved",
        pointsAwarded: 0,
      });
    }
    const birthdayPoints = collectSettings.basic.birthday.point ?? 0;
    if (birthdayPoints <= 0) {
      return res.json({
        success: true,
        message: "Birthday saved",
        pointsAwarded: 0,
      });
    }

    const customerPlain =
      typeof customer.toObject === "function"
        ? customer.toObject()
        : { ...customer };
    const result = await awardBirthdayPointsIfEligible({
      customer: { ...customerPlain, dob: dobDate },
      store,
      channel,
      collectSettings,
      sendEmail: true,
    });

    if (result.awarded) {
      return res.json({
        success: true,
        message: "Birthday saved and points awarded",
        pointsAwarded: result.pointsAwarded,
      });
    }

    if (result.reason === "not_birthday_today") {
      return res.json({
        success: true,
        message:
          "Birthday saved; points are awarded when you visit on your birthday",
        pointsAwarded: 0,
      });
    }

    if (result.reason === "already_awarded_this_year") {
      return res.json({
        success: true,
        message: "Birthday saved; points already awarded this year",
        pointsAwarded: 0,
      });
    }

    return res.json({
      success: true,
      message: "Birthday saved",
      pointsAwarded: 0,
    });
  } catch (err) {
    console.error("Error saving customer birthday:", err);
    next(err);
  }
};

/**
 * Save customer profile from Complete Profile widget form.
 * POST body: { currentCustomerJwt?, channelId?, storeHash?, customerId?, firstName, lastName, contactNo, ageGroup, gender, weddingAnniversary (ISO or null) }
 * Use JWT when available; otherwise storeHash + channelId + customerId.
 * Updates customer.firstName, customer.lastName, and customer.profile (name = firstName + lastName, contactNo, ageGroup, gender, weddingAnniversary).
 */
const saveCustomerProfile = async (req, res, next) => {
  try {
    const {
      currentCustomerJwt,
      storeHash,
      channelId,
      customerId: bcCustomerIdRaw,
      firstName,
      lastName,
      contactNo,
      ageGroup,
      gender,
      weddingAnniversary: weddingAnniversaryRaw,
    } = req.body;

    let context = null;
    if (currentCustomerJwt && typeof currentCustomerJwt === "string") {
      const clientSecret = process.env.CLIENT_SECRET;
      if (!clientSecret) {
        return res.status(500).json({
          success: false,
          message: "Server configuration error",
        });
      }
      let payload;
      try {
        payload = jwt.verify(currentCustomerJwt, clientSecret, {
          algorithms: ["HS256"],
        });
      } catch {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired customer token",
        });
      }
      if (
        payload.operation !== "current_customer" ||
        !payload.customer ||
        !payload.store_hash
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid token payload",
        });
      }
      context = await resolveCustomerContext(req, res, payload);
    } else if (storeHash && channelId != null && channelId !== "") {
      context = await resolveCustomerContext(req, res, {
        storeHash,
        channelId,
        customerId: bcCustomerIdRaw ?? "",
      });
    }

    if (!context) {
      return res.status(400).json({
        success: false,
        message: "Current customer JWT or (storeHash + channelId) required",
      });
    }

    const { store, channel } = context;
    const bcCustomerId = context.bcCustomerId;
    if (!bcCustomerId) {
      return res.status(400).json({
        success: false,
        message: "Customer ID is required to save profile",
      });
    }

    const customer = await Customer.findOne({
      store_id: store._id,
      channel_id: channel.channel_id,
      bcCustomerId,
    });
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found in loyalty program",
      });
    }

    const trimmedFirst = typeof firstName === "string" ? firstName.trim() : "";
    const trimmedLast = typeof lastName === "string" ? lastName.trim() : "";
    const fullName = [trimmedFirst, trimmedLast].filter(Boolean).join(" ");
    const contactNoStr =
      typeof contactNo === "string" ? contactNo.trim() : null;
    const ageGroupStr =
      typeof ageGroup === "string" ? ageGroup.trim() || null : null;
    const genderStr = typeof gender === "string" ? gender.trim() || null : null;
    let weddingAnniversaryDate = null;
    if (
      weddingAnniversaryRaw != null &&
      weddingAnniversaryRaw !== "" &&
      String(weddingAnniversaryRaw).trim() !== ""
    ) {
      const d = new Date(weddingAnniversaryRaw);
      if (!isNaN(d.getTime())) weddingAnniversaryDate = d;
    }

    const existingProfile = customer.profile || {};
    const profileUpdate = {
      name: fullName || existingProfile.name || null,
      contactNo:
        contactNoStr != null
          ? contactNoStr
          : existingProfile.contactNo != null
            ? existingProfile.contactNo
            : null,
      ageGroup:
        ageGroupStr != null && ageGroupStr !== ""
          ? ageGroupStr
          : existingProfile.ageGroup != null
            ? existingProfile.ageGroup
            : null,
      gender:
        genderStr != null && genderStr !== ""
          ? genderStr
          : existingProfile.gender != null
            ? existingProfile.gender
            : null,
      weddingAnniversary:
        weddingAnniversaryDate != null
          ? weddingAnniversaryDate
          : existingProfile.weddingAnniversary != null
            ? existingProfile.weddingAnniversary
            : null,
    };

    await Customer.updateCustomer(customer._id, {
      firstName: trimmedFirst || null,
      lastName: trimmedLast || null,
      profile: profileUpdate,
    });

    // Award profile completion points if channel has it enabled (Ways to Earn "Complete Profile")
    let pointsAwarded = 0;
    const collectSettings = await CollectSettings.findOne({
      store_id: store._id,
      channel_id: channel._id,
    });
    // Support both spellings: profileComplition (typo in schema) and profileCompletion
    const profileRule =
      collectSettings &&
      collectSettings.basic &&
      (collectSettings.basic.profileComplition ||
        collectSettings.basic.profileCompletion);
    const profileCompletionActive = profileRule && profileRule.active === true;
    const profileCompletionPoints =
      profileCompletionActive && profileRule.point != null
        ? Number(profileRule.point)
        : 0;

    if (!collectSettings) {
      console.log(
        "[FavLoyalty] saveCustomerProfile: no CollectSettings for store/channel, profile points not awarded",
      );
    } else if (!profileCompletionActive || profileCompletionPoints <= 0) {
      console.log(
        "[FavLoyalty] saveCustomerProfile: Complete Profile not enabled or 0 points in Ways to Earn (basic.profileComplition), profile points not awarded",
      );
    }

    if (profileCompletionActive && profileCompletionPoints > 0) {
      // Avoid double-award: only award once per customer (one "Profile Completion" transaction ever)
      const existingProfileTx = await Transaction.findOne({
        customerId: customer._id,
        store_id: store._id,
        channel_id: channel.channel_id,
        description: "Profile Completion",
      });
      if (existingProfileTx) {
        console.log(
          "[FavLoyalty] saveCustomerProfile: customer already received Profile Completion points once, skipping award",
        );
      }
      if (!existingProfileTx) {
        const pointModel = await Point.findOne({
          store_id: store._id,
          channel_id: channel._id,
        });
        const expiresInDays =
          pointModel && pointModel.expiriesInDays != null
            ? pointModel.expiriesInDays
            : null;
        const { expiryDate } = getExpiryDate(expiresInDays);

        await Customer.addTransaction(customer._id, {
          customerId: customer._id,
          store_id: store._id,
          channel_id: channel.channel_id,
          bcCustomerId: customer.bcCustomerId,
          type: "earn",
          transactionCategory: "other",
          points: profileCompletionPoints,
          description: "Profile Completion",
          status: "completed",
          expiresAt: expiryDate,
          source: "profile_completion",
          metadata: {},
        });
        pointsAwarded = profileCompletionPoints;

        // Recalculate customer tier after awarding points
        if (pointModel) {
          try {
            // Capture previous tier before recalculation
            const previousTier = customer.currentTier
              ? {
                  ...(customer.currentTier.toObject?.() ||
                    customer.currentTier),
                }
              : null;

            const tierResult = await calculateAndUpdateCustomerTier(
              customer,
              pointModel,
            );
            if (tierResult.tierUpdated) {
              console.log(
                "[FavLoyalty] saveCustomerProfile: tier updated after profile completion points:",
                tierResult.message,
              );

              // Schedule tier upgrade email if tier was upgraded
              await checkAndScheduleTierUpgradeEmail(
                tierResult,
                previousTier,
                customer._id,
                store._id,
                channel._id,
                pointModel,
              );
            }
          } catch (tierError) {
            console.warn(
              "[FavLoyalty] saveCustomerProfile: tier recalculation failed:",
              tierError.message,
            );
          }
        }

        // Schedule profile completion email via Agenda (only if points awarded; email sent only if enabled in collectSettings.emailSetting.profileCompletion)
        try {
          queueManager
            .addProfileCompletionEmailJob({
              customerId: customer._id.toString(),
              storeId: store._id.toString(),
              channelId: channel._id.toString(),
              profileCompletionPoints: profileCompletionPoints,
            })
            .catch(function (err) {
              console.warn(
                "[FavLoyalty] saveCustomerProfile: failed to schedule profile completion email job:",
                err && err.message,
              );
            });
        } catch (emailJobError) {
          console.warn(
            "[FavLoyalty] saveCustomerProfile: failed to schedule profile completion email job:",
            emailJobError && emailJobError.message,
          );
        }
      }
    }

    return res.json({
      success: true,
      message: "Profile saved",
      pointsAwarded: pointsAwarded,
    });
  } catch (err) {
    console.error("Error saving customer profile:", err);
    next(err);
  }
};

/**
 * Award newsletter subscription points to the current customer.
 * Subscription to the store's newsletter is done from the storefront browser via /api/storefront/subscriptions (so it is for the correct store). This endpoint only records and awards loyalty points.
 * POST body: { currentCustomerJwt?, channelId?, storeHash?, customerId? } — same as verifyCurrentCustomer.
 */
const subscribeCustomerNewsletter = async (req, res, next) => {
  try {
    const pointsAwarded = await (async () => {
      const {
        currentCustomerJwt,
        storeHash,
        channelId,
        customerId: bcCustomerIdRaw,
      } = req.body;

      let context = null;
      if (currentCustomerJwt && typeof currentCustomerJwt === "string") {
        const clientSecret = process.env.CLIENT_SECRET;
        if (!clientSecret) {
          const e = new Error("Server configuration error");
          e.status = 500;
          throw e;
        }
        let payload;
        try {
          payload = jwt.verify(currentCustomerJwt, clientSecret, {
            algorithms: ["HS256"],
          });
        } catch (e) {
          const err = new Error("Invalid or expired customer token");
          err.status = 401;
          throw err;
        }
        if (
          payload.operation !== "current_customer" ||
          !payload.customer ||
          !payload.store_hash
        ) {
          const e = new Error("Invalid token payload");
          e.status = 400;
          throw e;
        }
        context = await resolveCustomerContext(req, res, payload);
      } else if (storeHash && channelId != null && channelId !== "") {
        context = await resolveCustomerContext(req, res, {
          storeHash,
          channelId,
          customerId: bcCustomerIdRaw ?? "",
        });
      }

      if (!context) {
        const e = new Error(
          "Current customer JWT or (storeHash + channelId) required",
        );
        e.status = 400;
        e.alreadySent = true;
        throw e;
      }

      const { store, channel, bcCustomerId } = context;
      if (!bcCustomerId || bcCustomerId === 0) {
        const e = new Error(
          "You must be logged in to subscribe to the newsletter",
        );
        e.status = 400;
        throw e;
      }

      let pointsAwarded = 0;
      const customer = await Customer.findOne({
        store_id: store._id,
        channel_id: channel.channel_id,
        bcCustomerId,
      });
      if (customer) {
        const collectSettings = await CollectSettings.findOne({
          store_id: store._id,
          channel_id: channel._id,
        });
        const newsletterRule =
          collectSettings &&
          collectSettings.basic &&
          collectSettings.basic.subucribing;
        const newsletterActive =
          newsletterRule && newsletterRule.active === true;
        const newsletterPoints =
          newsletterActive && newsletterRule.point != null
            ? Number(newsletterRule.point)
            : 0;

        if (newsletterActive && newsletterPoints > 0) {
          const existingNewsletterTx = await Transaction.findOne({
            customerId: customer._id,
            store_id: store._id,
            channel_id: channel.channel_id,
            description: "Newsletter Subscription",
          });
          if (!existingNewsletterTx) {
            const pointModel = await Point.findOne({
              store_id: store._id,
              channel_id: channel._id,
            });
            const expiresInDays =
              pointModel && pointModel.expiriesInDays != null
                ? pointModel.expiriesInDays
                : null;
            const { expiryDate } = getExpiryDate(expiresInDays);

            await Customer.addTransaction(customer._id, {
              customerId: customer._id,
              store_id: store._id,
              channel_id: channel.channel_id,
              bcCustomerId: customer.bcCustomerId,
              type: "earn",
              transactionCategory: "other",
              points: newsletterPoints,
              description: "Newsletter Subscription",
              status: "completed",
              expiresAt: expiryDate,
              source: "newsletter_subscription",
              metadata: {},
            });
            pointsAwarded = newsletterPoints;

            if (pointModel) {
              try {
                // Capture previous tier before recalculation
                const previousTier = customer.currentTier
                  ? {
                      ...(customer.currentTier.toObject?.() ||
                        customer.currentTier),
                    }
                  : null;

                const tierResult = await calculateAndUpdateCustomerTier(
                  customer,
                  pointModel,
                );

                if (tierResult.tierUpdated) {
                  // Schedule tier upgrade email if tier was upgraded
                  await checkAndScheduleTierUpgradeEmail(
                    tierResult,
                    previousTier,
                    customer._id,
                    store._id,
                    channel._id,
                    pointModel,
                  );
                }
              } catch (tierError) {
                console.warn(
                  "[FavLoyalty] subscribeCustomerNewsletter: tier recalculation failed:",
                  tierError && tierError.message,
                );
              }
            }

            // Schedule newsletter subscription email via Agenda (only when Loyalty Program Newsletter email is enabled for this channel)
            const newsletterEmailEnabled =
              collectSettings.emailSetting &&
              (collectSettings.emailSetting.all?.enable === true ||
                collectSettings.emailSetting.newsletter?.enable === true);
            if (newsletterEmailEnabled) {
              queueManager
                .addNewsletterSubscriptionEmailJob({
                  customerId: customer._id,
                  storeId: store._id,
                  channelId: channel._id,
                  newsletterPoints: pointsAwarded,
                })
                .catch((queueErr) => {
                  console.warn(
                    "[FavLoyalty] subscribeCustomerNewsletter: failed to schedule newsletter email:",
                    queueErr && queueErr.message,
                  );
                });
            }
          }
        }
      }

      return pointsAwarded;
    })();

    return res.json({
      success: true,
      message: "Subscribed to newsletter",
      pointsAwarded: pointsAwarded,
    });
  } catch (err) {
    if (err && err.alreadySent) return;
    if (err.status && err.response) {
      return res.status(err.status).json({
        success: false,
        message: err.message || "Failed to subscribe to newsletter",
      });
    }
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        message: err.message || "Request failed",
      });
    }
    console.error("Error subscribing customer to newsletter:", err);
    next(err);
  }
};

/**
 * GET /api/widget/redeem-settings?storeHash=xxx&channelId=yyy&customerId=zzz
 * Returns only enabled coupon methods for the channel (for widget Methods tab).
 * When "Allow direct discount for selected customers" is enabled on a coupon,
 * that coupon is only returned if customerId is provided and the customer's
 * tier is in the allowed list (or no customer restriction on the coupon).
 * customerId is optional; when omitted (e.g. guest), only coupons without
 * customer restriction are returned.
 */
const getWidgetRedeemSettings = async (req, res, next) => {
  try {
    const { storeHash, channelId, customerId } = req.query;
    if (!storeHash || !channelId) {
      return res.status(400).json({
        success: false,
        message: "storeHash and channelId query params are required",
      });
    }
    const store = await Store.findByHash(storeHash);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }
    const channelIdObj =
      mongoose.Types.ObjectId.isValid(channelId) &&
      String(channelId).length === 24
        ? new mongoose.Types.ObjectId(channelId)
        : null;
    if (!channelIdObj) {
      const channelByNum = await Channel.findOne({
        store_id: store._id,
        channel_id: parseInt(channelId, 10),
      });
      if (!channelByNum) {
        return res.status(400).json({
          success: false,
          message: "Invalid channelId",
        });
      }
    }
    const channel = channelIdObj
      ? await Channel.findOne({ store_id: store._id, _id: channelIdObj })
      : await Channel.findOne({
          store_id: store._id,
          channel_id: parseInt(channelId, 10),
        });
    if (!channel) {
      return res.status(404).json({
        success: false,
        message: "Channel not found",
      });
    }
    const channelIdForQuery = channel._id;
    const settings = await RedeemSettings.findByStoreAndChannel(
      store._id,
      channelIdForQuery,
    );
    const activeOnly = Array.isArray(settings)
      ? settings.filter((s) => s.coupon?.active === true)
      : [];

    let customerTierIndex = null;
    if (customerId != null && String(customerId).trim() !== "") {
      const customer = await Customer.findOne({
        store_id: store._id,
        channel_id: channel.channel_id,
        bcCustomerId: String(customerId).trim(),
      }).lean();
      if (
        customer?.currentTier != null &&
        typeof customer.currentTier.tierIndex === "number"
      ) {
        customerTierIndex = customer.currentTier.tierIndex;
      }
    }

    const filtered = activeOnly.filter((doc) => {
      const custRestriction = doc.coupon?.restriction?.selectedCustomber;
      const restrictionEnabled = custRestriction?.status === true;
      if (!restrictionEnabled) return true;
      if (customerTierIndex === null) return false;
      const allowedTiers = (custRestriction.tier || []).filter(
        (t) => t && t.status === true,
      );
      if (allowedTiers.length === 0) return false;
      const allowedIndices = new Set(
        allowedTiers
          .map((t) => t.tierIndex)
          .filter((n) => typeof n === "number"),
      );
      return allowedIndices.has(customerTierIndex);
    });

    res.json(filtered);
  } catch (error) {
    console.error("Error getting widget redeem settings:", error);
    next(error);
  }
};

module.exports = {
  getCustomerData,
  verifyCurrentCustomer,
  getStorefrontToken,
  getWidgetChannelSettings,
  getWidgetRedeemSettings,
  getWidgetTransactions,
  createReferral,
  getMyReferrals,
  checkWidgetVisibility,
  updateWidgetVisibility,
  saveCustomerBirthday,
  saveCustomerProfile,
  subscribeCustomerNewsletter,
};
