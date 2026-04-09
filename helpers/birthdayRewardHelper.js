const Customer = require("../models/Customer");
const CollectSettings = require("../models/CollectSettings");
const Transaction = require("../models/Transaction");
const Point = require("../models/Point");
const Channel = require("../models/Channel");
const Store = require("../models/Store");
const { getExpiryDate } = require("./emailHelpers");
const {
  calculateAndUpdateCustomerTier,
  checkAndScheduleTierUpgradeEmail,
} = require("./tierHelper");

/**
 * Today's calendar month (1–12) and day (1–31) in the store's IANA timezone.
 */
function getTodayMonthDayInStoreTimeZone(storeTimeZone) {
  const tz =
    storeTimeZone && String(storeTimeZone).trim()
      ? String(storeTimeZone).trim()
      : "UTC";
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "numeric",
      day: "numeric",
    });
    const parts = formatter.formatToParts(new Date());
    const month = parseInt(parts.find((p) => p.type === "month")?.value, 10);
    const day = parseInt(parts.find((p) => p.type === "day")?.value, 10);
    if (Number.isNaN(month) || Number.isNaN(day)) {
      const now = new Date();
      return { month: now.getUTCMonth() + 1, day: now.getUTCDate() };
    }
    return { month, day };
  } catch {
    const now = new Date();
    return { month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  }
}

/**
 * True when today's calendar month/day in the store timezone matches the DOB month/day.
 * DOB month/day use UTC so date-only strings like "1990-05-15" match that calendar date.
 */
function isBirthdayTodayForStore(dob, storeTimeZone) {
  const dobD = dob instanceof Date ? dob : new Date(dob);
  if (Number.isNaN(dobD.getTime())) return false;
  const dobMonth = dobD.getUTCMonth() + 1;
  const dobDay = dobD.getUTCDate();
  const { month, day } = getTodayMonthDayInStoreTimeZone(storeTimeZone);
  return month === dobMonth && day === dobDay;
}

/**
 * Award birthday points if Ways to Earn birthday is on, today is birthday in store TZ,
 * and no "Birthday Celebration" this calendar year.
 * @param {object} params
 * @param {object} params.customer - Customer doc or lean (must have _id, dob, bcCustomerId, channel_id)
 * @param {object} params.store - Store doc
 * @param {object} params.channel - Channel doc (Mongo) with channel_id and _id
 * @param {object} [params.collectSettings] - Optional preloaded CollectSettings
 * @param {boolean} [params.sendEmail=true] - Schedule birthday email via queueManager
 * @returns {Promise<{ awarded: boolean, pointsAwarded: number, reason?: string }>}
 */
async function awardBirthdayPointsIfEligible({
  customer,
  store,
  channel,
  collectSettings: collectSettingsIn,
  sendEmail = true,
}) {
  if (!customer?.dob) {
    return { awarded: false, pointsAwarded: 0, reason: "no_dob" };
  }

  if (!isBirthdayTodayForStore(customer.dob, store.timezone)) {
    return { awarded: false, pointsAwarded: 0, reason: "not_birthday_today" };
  }

  const collectSettings =
    collectSettingsIn ||
    (await CollectSettings.findOne({
      store_id: store._id,
      channel_id: channel._id,
    }));

  if (!collectSettings?.basic?.birthday?.active) {
    return { awarded: false, pointsAwarded: 0, reason: "birthday_inactive" };
  }

  const birthdayPoints = collectSettings.basic.birthday.point ?? 0;
  if (birthdayPoints <= 0) {
    return { awarded: false, pointsAwarded: 0, reason: "zero_points" };
  }

  const currentYear = new Date().getFullYear();
  const yearStart = new Date(currentYear, 0, 1);
  const yearEnd = new Date(currentYear, 11, 31, 23, 59, 59);

  const existingTransaction = await Transaction.findOne({
    customerId: customer._id,
    store_id: store._id,
    channel_id: channel.channel_id,
    description: "Birthday Celebration",
    createdAt: { $gte: yearStart, $lte: yearEnd },
  });

  if (existingTransaction) {
    return { awarded: false, pointsAwarded: 0, reason: "already_awarded_this_year" };
  }

  const customerId = customer._id;
  const customerDoc =
    customer.points !== undefined && typeof customer.save === "function"
      ? customer
      : await Customer.findById(customerId);
  if (!customerDoc) {
    return { awarded: false, pointsAwarded: 0, reason: "customer_not_found" };
  }

  const pointModel = await Point.findOne({
    store_id: store._id,
    channel_id: channel._id,
  });
  const expiresInDays = pointModel?.expiriesInDays ?? null;
  const { expiryDate } = getExpiryDate(expiresInDays);

  await Customer.addTransaction(customerId, {
    customerId,
    store_id: store._id,
    channel_id: channel.channel_id,
    bcCustomerId: customerDoc.bcCustomerId,
    type: "earn",
    transactionCategory: "other",
    points: birthdayPoints,
    description: "Birthday Celebration",
    status: "completed",
    expiresAt: expiryDate,
    source: "birthday",
    metadata: { birthdayYear: currentYear },
  });

  if (pointModel) {
    try {
      const previousTier = customerDoc.currentTier
        ? {
            ...(customerDoc.currentTier.toObject?.() || customerDoc.currentTier),
          }
        : null;
      const updatedCustomer = await Customer.findById(customerId);
      if (updatedCustomer) {
        const tierResult = await calculateAndUpdateCustomerTier(
          updatedCustomer,
          pointModel,
        );
        if (tierResult.tierUpdated) {
          await checkAndScheduleTierUpgradeEmail(
            tierResult,
            previousTier,
            customerId,
            store._id,
            channel._id,
            pointModel,
          );
        }
      }
    } catch (tierError) {
      console.warn(
        "[birthdayRewardHelper] tier recalculation failed:",
        tierError.message,
      );
    }
  }

  if (sendEmail) {
    try {
      const queueManager = require("../queues/queueManager");
      await queueManager.addBirthdayEmailJob(
        {
          customerId: customerId.toString(),
          storeId: store._id.toString(),
          channelId: channel._id.toString(),
          birthdayPoints,
        },
        { delay: "in 5 seconds" },
      );
    } catch (emailErr) {
      console.warn(
        "[birthdayRewardHelper] failed to schedule birthday email:",
        emailErr.message,
      );
    }
  }

  return { awarded: true, pointsAwarded: birthdayPoints };
}

/**
 * Run daily: for each active store, find customers whose DOB month/day (UTC) matches today's date in that store's timezone, then award if eligible.
 */
async function processAllStoresBirthdayPoints() {
  const stores = await Store.find({ is_active: true }).lean();
  let processed = 0;
  let awarded = 0;
  let failed = 0;

  for (const storeLean of stores) {
    const store = await Store.findById(storeLean._id);
    if (!store) continue;

    const { month, day } = getTodayMonthDayInStoreTimeZone(store.timezone);

    const candidates = await Customer.find({
      store_id: store._id,
      dob: { $exists: true, $ne: null },
      $expr: {
        $and: [
          { $eq: [{ $month: "$dob" }, month] },
          { $eq: [{ $dayOfMonth: "$dob" }, day] },
        ],
      },
    });

    for (const customer of candidates) {
      processed++;
      try {
        const channel = await Channel.findOne({
          store_id: store._id,
          channel_id: customer.channel_id,
        });
        if (!channel) {
          console.warn(
            `[birthdayRewardHelper] daily job: no channel for customer ${customer._id} channel_id=${customer.channel_id}`,
          );
          continue;
        }

        const result = await awardBirthdayPointsIfEligible({
          customer,
          store,
          channel,
          sendEmail: true,
        });
        if (result.awarded) awarded++;
      } catch (err) {
        failed++;
        console.error(
          `[birthdayRewardHelper] daily job failed customer ${customer._id}:`,
          err.message,
        );
      }
    }
  }

  return { processed, awarded, failed, stores: stores.length };
}

module.exports = {
  getTodayMonthDayInStoreTimeZone,
  isBirthdayTodayForStore,
  awardBirthdayPointsIfEligible,
  processAllStoresBirthdayPoints,
};
