const express = require("express");
const CollectSettings = require("../models/CollectSettings");
const Customer = require("../models/Customer");
const Transaction = require("../models/Transaction");
const Point = require("../models/Point");
const Channel = require("../models/Channel");
const {
  sendMonthlyPointsEmail,
  sendPointsExpirationEmail,
  sendCouponExpirationWarningEmail,
} = require("../helpers/emailHelpers");

const router = express.Router();

function parseTargetDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function normalizeToStartOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Manual trigger: monthly points statement (runs immediately, no Agenda)
router.post("/monthly-points-statement", async (req, res) => {
  try {
    const { limitCustomers = 0 } = req.body || {};

    const activeSettings = await CollectSettings.find({
      $or: [
        { "emailSetting.all.enable": true },
        { "emailSetting.monthlyPoints.enable": true },
      ],
    })
      .populate("store_id")
      .populate("channel_id");

    let processedCount = 0;
    let failedCount = 0;
    let totalCustomers = 0;

    for (const settings of activeSettings) {
      const store = settings.store_id;
      const channel = settings.channel_id;
      if (!store || !channel) continue;

      const numericChannelId = channel.channel_id;

      const pointModel = await Point.findOne({
        store_id: store._id,
        channel_id: channel._id,
      });
      if (!pointModel) continue;

      const customersQuery = Customer.find({
        store_id: store._id,
        channel_id: numericChannelId,
      });
      if (Number(limitCustomers) > 0) customersQuery.limit(Number(limitCustomers));
      const customers = await customersQuery;
      totalCustomers += customers.length;

      for (const customer of customers) {
        try {
          const sent = await sendMonthlyPointsEmail(
            customer,
            store,
            pointModel,
            channel._id,
            channel.site_url,
          );
          if (sent) processedCount++;
          else failedCount++;
        } catch (e) {
          failedCount++;
        }
      }
    }

    res.json({
      status: true,
      channels: activeSettings.length,
      totalCustomers,
      processedCount,
      failedCount,
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      message: err?.message || "Failed to send monthly points statements",
    });
  }
});

// Manual trigger: points expiration notifications (earn transactions, runs immediately)
router.post("/points-expiration", async (req, res) => {
  try {
    const { targetDate, limitTransactions = 0 } = req.body || {};

    const base = parseTargetDate(targetDate) || new Date();
    const today = normalizeToStartOfDay(base);

    let txQuery = Transaction.find({
      expiresAt: { $lte: today },
      status: "completed",
      type: "earn",
    })
      .populate("customerId")
      .populate("store_id");
    if (Number(limitTransactions) > 0) txQuery = txQuery.limit(Number(limitTransactions));
    const expiringTransactions = await txQuery;

    let processedCount = 0;
    let failedCount = 0;

    for (const transaction of expiringTransactions) {
      try {
        const customer = transaction.customerId;
        const store = transaction.store_id;
        if (!customer || !store) continue;

        const channel = await Channel.findOne({
          store_id: store._id,
          channel_id: transaction.channel_id,
        });
        if (!channel) continue;

        const pointModel = await Point.findOne({
          store_id: store._id,
          channel_id: channel._id,
        });
        if (!pointModel) continue;

        const pointsToDeduct = transaction.points || 0;
        if (pointsToDeduct > 0) {
          customer.points = Math.max(0, (customer.points || 0) - pointsToDeduct);
          await customer.save();

          await sendPointsExpirationEmail(
            customer,
            store,
            pointModel,
            pointsToDeduct,
            channel._id,
            channel.site_url,
          );
        }

        transaction.status = "expired";
        await transaction.save();

        processedCount++;
      } catch (e) {
        failedCount++;
      }
    }

    res.json({
      status: true,
      targetDate: today.toISOString(),
      totalTransactions: expiringTransactions.length,
      processedCount,
      failedCount,
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      message: err?.message || "Failed to process points expiration",
    });
  }
});

// Manual trigger: coupon expiration warnings (redeem transactions, runs immediately)
router.post("/coupon-expiration", async (req, res) => {
  try {
    const { targetDate, limitTransactions = 0 } = req.body || {};

    const base = parseTargetDate(targetDate) || new Date();
    const today = normalizeToStartOfDay(base);
    const twoDaysFromNow = new Date(today);
    twoDaysFromNow.setDate(today.getDate() + 2);

    let txQuery = Transaction.find({
      expiresAt: { $gte: today, $lte: twoDaysFromNow },
      status: "completed",
      type: "redeem",
    })
      .populate("customerId")
      .populate("store_id");
    if (Number(limitTransactions) > 0) txQuery = txQuery.limit(Number(limitTransactions));
    const expiringTransactions = await txQuery;

    let processedCount = 0;
    let failedCount = 0;

    for (const transaction of expiringTransactions) {
      try {
        const customer = transaction.customerId;
        const store = transaction.store_id;
        if (!customer || !store) continue;

        const channel = await Channel.findOne({
          store_id: store._id,
          channel_id: transaction.channel_id,
        });
        if (!channel) continue;

        const pointModel = await Point.findOne({
          store_id: store._id,
          channel_id: channel._id,
        });
        if (!pointModel) continue;

        const daysUntilExpiry = Math.ceil(
          (transaction.expiresAt - today) / (1000 * 60 * 60 * 24),
        );

        if (daysUntilExpiry <= 2 && daysUntilExpiry >= 0) {
          await sendCouponExpirationWarningEmail(
            customer,
            store,
            transaction,
            daysUntilExpiry,
            channel._id,
            channel.site_url,
          );

          if (transaction.expiresAt <= today) {
            transaction.status = "expired";
            await transaction.save();
          }
        }

        processedCount++;
      } catch (e) {
        failedCount++;
      }
    }

    res.json({
      status: true,
      targetDate: today.toISOString(),
      totalTransactions: expiringTransactions.length,
      processedCount,
      failedCount,
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      message: err?.message || "Failed to process coupon expiration",
    });
  }
});

module.exports = router;

