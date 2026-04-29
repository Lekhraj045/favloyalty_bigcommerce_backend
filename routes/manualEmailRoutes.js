const express = require("express");
const queueManager = require("../queues/queueManager");

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

function normalizeToDay28(date) {
  const d = new Date(date);
  d.setDate(28);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Manual trigger: monthly points statement (uses the same "28th" gating logic)
router.post("/monthly-points-statement", async (req, res) => {
  try {
    const { targetDate, delaySeconds = 2 } = req.body || {};

    const base = parseTargetDate(targetDate) || new Date();
    const d28 = normalizeToDay28(base);

    const job = await queueManager.addMonthlyPointsJob(
      {
        triggeredBy: "manual-route",
        targetDate: d28.toISOString(),
      },
      { delay: `in ${Math.max(0, Number(delaySeconds) || 0)} seconds` },
    );

    res.json({
      status: true,
      jobId: job?.attrs?._id || null,
      targetDate: d28.toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      message: err?.message || "Failed to queue monthly points statement",
    });
  }
});

// Manual trigger: points expiration notifications (earn transactions)
router.post("/points-expiration", async (req, res) => {
  try {
    const { targetDate, delaySeconds = 2 } = req.body || {};

    const base = parseTargetDate(targetDate) || new Date();
    const today = normalizeToStartOfDay(base);

    const job = await queueManager.addTransactionExpirationJob(
      {
        triggeredBy: "manual-route",
        targetDate: today.toISOString(),
        mode: "points",
      },
      { delay: `in ${Math.max(0, Number(delaySeconds) || 0)} seconds` },
    );

    res.json({
      status: true,
      jobId: job?.attrs?._id || null,
      targetDate: today.toISOString(),
      mode: "points",
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      message: err?.message || "Failed to queue points expiration",
    });
  }
});

// Manual trigger: coupon expiration warnings (redeem transactions)
router.post("/coupon-expiration", async (req, res) => {
  try {
    const { targetDate, delaySeconds = 2 } = req.body || {};

    const base = parseTargetDate(targetDate) || new Date();
    const today = normalizeToStartOfDay(base);

    const job = await queueManager.addTransactionExpirationJob(
      {
        triggeredBy: "manual-route",
        targetDate: today.toISOString(),
        mode: "coupon",
      },
      { delay: `in ${Math.max(0, Number(delaySeconds) || 0)} seconds` },
    );

    res.json({
      status: true,
      jobId: job?.attrs?._id || null,
      targetDate: today.toISOString(),
      mode: "coupon",
    });
  } catch (err) {
    res.status(500).json({
      status: false,
      message: err?.message || "Failed to queue coupon expiration",
    });
  }
});

module.exports = router;

