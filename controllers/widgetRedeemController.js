const mongoose = require("mongoose");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const Customer = require("../models/Customer");
const Point = require("../models/Point");
const RedeemSettings = require("../models/RedeemSettings");
const { createCoupon } = require("../services/bigcommerceCouponService");
const { calculateAndUpdateCustomerTier } = require("../helpers/tierHelper");

async function createBCCoupon(opts) {
  try {
    return await createCoupon(opts);
  } catch (bcErr) {
    const status = bcErr.response && bcErr.response.status;
    const data = bcErr.response && bcErr.response.data;
    console.error("BigCommerce create coupon failed:", status, data);
    const err = new Error(
      (data && (data.message || data.title)) ||
        "Failed to create coupon on store"
    );
    err.status = status || 502;
    throw err;
  }
}

/**
 * POST /api/widget/redeem
 * Body: { storeHash, channelId, customerId, redeemSettingId }
 * Creates a BigCommerce coupon for the selected redeem method, deducts customer points,
 * and records a redeem transaction with coupon metadata (for Coupons tab).
 */
async function runCreateRedeem(req, res) {
  const body = req.body || {};
  const { storeHash, channelId, customerId, redeemSettingId, pointsToRedeem } =
    body;
  if (!storeHash || !channelId || !customerId || !redeemSettingId) {
    return res.status(400).json({
      success: false,
      message:
        "storeHash, channelId, customerId, and redeemSettingId are required",
    });
  }

  const store = await Store.findByHash(storeHash);
  if (!store) {
    return res.status(404).json({
      success: false,
      message: "Store not found",
    });
  }

  const channelIdStr = String(channelId).trim();
  const isObjectId =
    mongoose.Types.ObjectId.isValid(channelIdStr) && channelIdStr.length === 24;
  let channel = null;
  if (isObjectId) {
    channel = await Channel.findOne({
      store_id: store._id,
      _id: new mongoose.Types.ObjectId(channelIdStr),
    });
  }
  if (!channel && !isNaN(parseInt(channelIdStr, 10))) {
    channel = await Channel.findOne({
      store_id: store._id,
      channel_id: parseInt(channelIdStr, 10),
    });
  }
  if (!channel) {
    channel = await Channel.findOne({ store_id: store._id });
  }
  if (!channel) {
    return res.status(404).json({
      success: false,
      message: "Channel not found",
    });
  }

  const customer = await Customer.findOne({
    store_id: store._id,
    channel_id: channel.channel_id,
    bcCustomerId: String(customerId).trim(),
  });
  if (!customer) {
    return res.status(404).json({
      success: false,
      message: "Customer not found",
    });
  }

  const redeemSetting = await RedeemSettings.findById(
    new mongoose.Types.ObjectId(redeemSettingId)
  );
  if (!redeemSetting) {
    return res.status(404).json({
      success: false,
      message: "Redeem method not found",
    });
  }
  if (
    !redeemSetting.store_id.equals(store._id) ||
    !redeemSetting.channel_id.equals(channel._id)
  ) {
    return res.status(400).json({
      success: false,
      message: "Redeem method does not belong to this store/channel",
    });
  }
  if (!redeemSetting.coupon?.active) {
    return res.status(400).json({
      success: false,
      message: "This redeem method is not active",
    });
  }
  const coupon = redeemSetting.coupon;
  let pointsPerUnit = Number(coupon.value) || 0;
  // For freeProduct, derive from product points when coupon.value is missing/zero (e.g. legacy data)
  if (
    redeemSetting.redeemType === "freeProduct" &&
    pointsPerUnit < 1 &&
    coupon.restriction?.selectedItems?.items?.length
  ) {
    const points = coupon.restriction.selectedItems.items
      .map((item) => parseInt(String(item.pointRequired || "0"), 10))
      .filter((n) => !Number.isNaN(n) && n > 0);
    if (points.length) pointsPerUnit = Math.min(...points);
  }
  if (pointsPerUnit < 1) {
    return res.status(400).json({
      success: false,
      message: "Invalid points required for this method",
    });
  }
  const customerPoints = Number(customer.points) || 0;
  let pointsRequired = pointsPerUnit;
  if (
    redeemSetting.redeemType === "storeCredit" &&
    pointsToRedeem != null &&
    !Number.isNaN(Number(pointsToRedeem))
  ) {
    const requested = Math.floor(Number(pointsToRedeem));
    const restriction = coupon.restriction || {};
    const maxRedemption =
      restriction.maxReduption?.status &&
      Number(restriction.maxReduption?.value) > 0
        ? Math.floor(Number(restriction.maxReduption.value))
        : null;
    const minPoints = Math.max(1, pointsPerUnit);
    const maxBySetting = maxRedemption != null ? maxRedemption : Infinity;
    const maxByCustomer = customerPoints;
    const effectiveMax = Math.min(maxBySetting, maxByCustomer);
    if (requested < minPoints) {
      return res.status(400).json({
        success: false,
        message: `Minimum redemption is ${minPoints} points`,
      });
    }
    if (requested > effectiveMax) {
      return res.status(400).json({
        success: false,
        message:
          effectiveMax <= customerPoints
            ? `Maximum redemption is ${effectiveMax} points`
            : "Insufficient points",
      });
    }
    pointsRequired = requested;
  } else if (customerPoints < pointsRequired) {
    return res.status(400).json({
      success: false,
      message: "Insufficient points",
    });
  }

  const restriction = coupon.restriction || {};
  const selectedItems = restriction.selectedItems;
  const hasProductRestriction =
    selectedItems?.status === true &&
    Array.isArray(selectedItems.items) &&
    selectedItems.items.length > 0;
  let applies_to;
  if (hasProductRestriction) {
    const productIds = selectedItems.items
      .map((item) => {
        const id = item.productId || item.ids;
        const num = id != null ? Number(id) : NaN;
        return isNaN(num) ? null : num;
      })
      .filter(Boolean);
    if (productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "This reward is restricted to specific products but no valid product IDs were found. Please contact support.",
      });
    }
    applies_to = { entity: "products", ids: productIds };
  } else {
    applies_to = { entity: "categories", ids: [0] };
  }

  let expires = null;
  if (coupon.hasExpiry && coupon.expire != null && coupon.expire !== "") {
    const days = parseInt(String(coupon.expire), 10);
    if (!isNaN(days) && days > 0) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + days);
      expires = d.toUTCString();
    }
  }

  let min_purchase = null;
  const minAmount = restriction.minimumPurchaseAmount;
  if (
    minAmount?.status === true &&
    minAmount.value != null &&
    Number(minAmount.value) > 0
  ) {
    min_purchase = Number(minAmount.value);
  }

  let bcType = "percentage_discount";
  let bcAmount = "0";
  let offerLabel = "Loyalty reward";
  switch (redeemSetting.redeemType) {
    case "purchase":
      bcType = "percentage_discount";
      bcAmount = String(Number(coupon.discountAmount) || 0);
      offerLabel = coupon.name || `Loyalty: ${coupon.discountAmount ?? 0}% off`;
      break;
    case "storeCredit": {
      bcType = "per_total_discount";
      const discountPerUnit = Number(coupon.discountAmount) || 0;
      const computedAmount =
        pointsPerUnit > 0
          ? (pointsRequired / pointsPerUnit) * discountPerUnit
          : discountPerUnit;
      bcAmount = String(Math.round(computedAmount * 100) / 100);
      offerLabel =
        coupon.name ||
        `Loyalty: $${Math.round(computedAmount * 100) / 100} off`;
      break;
    }
    case "freeShipping":
      bcType = "free_shipping";
      bcAmount = "0";
      offerLabel = coupon.name || "Loyalty: Free Shipping";
      break;
    case "freeProduct": {
      if (!hasProductRestriction || !applies_to?.ids?.length) {
        return res.status(400).json({
          success: false,
          message:
            "Free product reward must have at least one product selected. Please contact support.",
        });
      }
      // Cap discount at one unit's price so coupon applies to only one quantity (not all)
      const prices = (selectedItems.items || [])
        .map((item) => parseFloat(String(item.price || "0"), 10))
        .filter((n) => !Number.isNaN(n) && n > 0);
      if (prices.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            "Free product reward has no valid product price. Please reconfigure this reward in the admin.",
        });
      }
      const oneUnitPrice = Math.min(...prices);
      bcType = "per_total_discount";
      bcAmount = String(Math.round(oneUnitPrice * 100) / 100);
      offerLabel = coupon.name || "Loyalty: Free Product";
      break;
    }
    default:
      offerLabel = coupon.name || "Loyalty reward";
      bcAmount = String(Number(coupon.discountAmount) || 0);
  }

  const uniqueCode =
    "FAV" +
    String(customer._id).slice(-6) +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 6).toUpperCase();
  const nameSuffix = uniqueCode.slice(-6);
  const rawName = `${offerLabel} (${nameSuffix})`;
  const name = rawName.length <= 100 ? rawName : rawName.slice(0, 97) + "...";

  const created = await createBCCoupon({
    storeHash: store.store_hash,
    accessToken: store.access_token,
    name,
    code: uniqueCode,
    type: bcType,
    amount: bcAmount,
    applies_to,
    expires: expires || undefined,
    min_purchase: min_purchase != null ? String(min_purchase) : undefined,
    max_uses: 1,
    max_uses_per_customer: 1,
  });
  if (!created || created.id == null) {
    return res.status(502).json({
      success: false,
      message: "Failed to create coupon",
    });
  }

  await Customer.addTransaction(customer._id, {
    store_id: store._id,
    channel_id: channel.channel_id,
    type: "redeem",
    points: -pointsRequired,
    description: "Points Redeemed",
    transactionCategory: "order",
    metadata: {
      bcCouponId: created.id,
      couponCode: created.code,
      offerLabel: name,
      expiresAt: expires || null,
      redeemSettingId: redeemSetting._id.toString(),
    },
    source: "api",
  });

  // Recalculate customer tier after points deduction (tier may drop if points go below threshold)
  try {
    const pointModel = await Point.findOne({
      store_id: store._id,
      channel_id: channel._id,
    });
    if (pointModel) {
      await calculateAndUpdateCustomerTier(customer._id, pointModel);
    }
  } catch (tierErr) {
    console.warn(
      "[FavLoyalty] widget redeem: tier recalculation after redemption failed:",
      tierErr?.message || tierErr
    );
  }

  res.status(200).json({
    success: true,
    couponCode: created.code,
    expiresAt: expires || null,
    offerLabel: name,
  });
}

const createRedeemCoupon = (req, res, next) => {
  runCreateRedeem(req, res).catch((e) => {
    if (e.status != null) {
      return res.status(e.status).json({
        success: false,
        message: e.message,
      });
    }
    console.error("Error creating redeem coupon:", e);
    next(e);
  });
};

module.exports = { createRedeemCoupon };
