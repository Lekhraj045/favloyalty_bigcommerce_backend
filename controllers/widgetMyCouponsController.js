const mongoose = require("mongoose");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const Customer = require("../models/Customer");
const Transaction = require("../models/Transaction");
const RedeemSettings = require("../models/RedeemSettings");
const { getCoupon } = require("../services/bigcommerceCouponService");

/**
 * GET /api/widget/my-coupons?storeHash=xxx&channelId=yyy&customerId=zzz
 * Returns redeemed coupons for the current customer (from redeem transactions).
 * Only returns coupons that: (1) are not expired, (2) exist on BigCommerce (getCoupon succeeds).
 * Coupons not found on BC (404) or without bcCouponId are omitted. Each returned coupon includes
 * `used`: true if fully used (BC num_uses >= max_uses) or used in an order by this customer.
 */
const getMyCoupons = async (req, res, next) => {
  try {
    const { storeHash, channelId, customerId } = req.query;
    if (
      !storeHash ||
      !channelId ||
      customerId == null ||
      String(customerId).trim() === ""
    ) {
      return res.status(400).json({
        success: false,
        message: "storeHash, channelId, and customerId are required",
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
      mongoose.Types.ObjectId.isValid(channelIdStr) &&
      channelIdStr.length === 24;
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
      return res.json([]);
    }

    const now = new Date();
    const redeemTxs = await Transaction.find({
      customerId: customer._id,
      channel_id: channel.channel_id,
      type: "redeem",
      status: "completed",
      "metadata.couponCode": { $exists: true, $ne: null },
    })
      .sort({ createdAt: -1 })
      .lean();

    const storeHashStr = store.store_hash;
    const accessToken = store.access_token;

    // Filter to transactions we will validate (not expired, have bcCouponId)
    const txsToValidate = [];
    for (const tx of redeemTxs) {
      const meta = tx.metadata || {};
      const expiresAt = meta.expiresAt ? new Date(meta.expiresAt) : null;
      if (expiresAt != null && expiresAt <= now) continue;
      if (meta.bcCouponId == null || !storeHashStr || !accessToken) continue;
      txsToValidate.push(tx);
    }

    // Fetch all BC coupons in parallel
    const bcResults = await Promise.allSettled(
      txsToValidate.map((tx) =>
        getCoupon(storeHashStr, accessToken, Number(tx.metadata.bcCouponId))
      )
    );

    // Batch load RedeemSettings for all unique redeemSettingIds
    const redeemSettingIdStrs = [
      ...new Set(
        txsToValidate
          .map((tx) => tx.metadata?.redeemSettingId)
          .filter(Boolean)
          .map((id) => String(id))
      ),
    ];
    const redeemSettingIds = redeemSettingIdStrs
      .filter((id) => mongoose.Types.ObjectId.isValid(id) && id.length === 24)
      .map((id) => new mongoose.Types.ObjectId(id));
    const redeemSettingsList =
      redeemSettingIds.length > 0
        ? await RedeemSettings.find({ _id: { $in: redeemSettingIds } }).lean()
        : [];
    const redeemSettingsByKey = new Map(
      redeemSettingsList.map((rs) => [rs._id.toString(), rs])
    );

    const coupons = [];
    for (let i = 0; i < txsToValidate.length; i++) {
      const tx = txsToValidate[i];
      const meta = tx.metadata || {};
      const expiresAt = meta.expiresAt ? new Date(meta.expiresAt) : null;
      const settled = bcResults[i];
      if (settled.status === "rejected") {
        const err = settled.reason;
        const status = err.response?.status;
        if (status === 404) {
          console.warn(
            "getMyCoupons: coupon not found on BigCommerce, skipping bcCouponId",
            meta.bcCouponId
          );
        } else {
          console.warn(
            "getMyCoupons: getCoupon failed for bcCouponId",
            meta.bcCouponId,
            err?.message
          );
        }
        continue;
      }
      const bcCoupon = settled.value;

      let used = meta.usedInOrder === true;
      if (!used && bcCoupon) {
        const maxUses = bcCoupon.max_uses;
        const numUses = bcCoupon.num_uses;
        if (
          maxUses != null &&
          typeof numUses === "number" &&
          numUses >= maxUses
        ) {
          used = true;
        }
      }

      let appliesToProducts = undefined;
      let redeemType = null;
      if (meta.redeemSettingId) {
        const redeemSetting = redeemSettingsByKey.get(
          String(meta.redeemSettingId)
        );
        if (redeemSetting) {
          redeemType = redeemSetting.redeemType || null;
          if (redeemSetting.coupon) {
            const restriction = redeemSetting.coupon.restriction || {};
            const selectedItems = restriction.selectedItems;
            if (
              selectedItems?.status === true &&
              Array.isArray(selectedItems.items) &&
              selectedItems.items.length > 0
            ) {
              appliesToProducts = selectedItems.items.map((item) => ({
                id: item.productId || item.ids || undefined,
                name: item.value || "",
                imgUrl: item.imgUrl || null,
                url: item.itemUrl || null,
                productId: item.productId || null,
                variantId: item.variantId || null,
              }));
            }
          }
        }
      }

      coupons.push({
        id: tx._id.toString(),
        offer: meta.offerLabel || "Loyalty reward",
        expires: expiresAt
          ? `Expires: ${expiresAt.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}`
          : "Expires: Never",
        code: meta.couponCode || "",
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        used,
        redeemType,
        appliesToProducts,
      });
    }

    return res.json(coupons);
  } catch (err) {
    console.error("Error getting my-coupons:", err);
    next(err);
  }
};

module.exports = { getMyCoupons };
