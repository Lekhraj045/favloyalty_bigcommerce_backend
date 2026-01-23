const Handlebars = require("handlebars");
const { sendEmail, renderTemplate } = require("../services/emailService");
const EmailTemplate = require("../models/EmailTemplate");
const CollectSettings = require("../models/CollectSettings");
const Point = require("../models/Point");
const Store = require("../models/Store");
const { getAbsoluteImageUrl } = require("./imageUrlHelper");
const { renderEmailTemplate, createBannerImageHtml } = require("./emailTemplateLoader");

/**
 * Get expiry date based on expiration days
 */
function getExpiryDate(expiresInDays) {
  if (!expiresInDays) {
    return {
      currentDate: new Date(),
      expiryDate: null,
    };
  }

  const currentDate = new Date();
  const expiryDate = new Date(currentDate);
  expiryDate.setDate(currentDate.getDate() + expiresInDays);

  return {
    currentDate: currentDate,
    expiryDate: expiryDate,
  };
}

/**
 * Send birthday email to customer
 */
async function sendBirthdayEmail(customer, store, pointModel, totalPoints, channelId) {
  try {
    const collectSettings = await CollectSettings.findOne({
      store_id: store._id,
      channel_id: channelId,
    });

    if (!collectSettings) {
      console.warn("CollectSettings not found for birthday email");
      return false;
    }

    // Check if email is enabled
    if (
      !(
        collectSettings.emailSetting?.all?.enable ||
        collectSettings.emailSetting?.birthday?.enable
      )
    ) {
      return false;
    }

    // Get email template from database (for heading and image URL)
    const birthdayEmailTemplate = await EmailTemplate.findByChannelAndType(
      channelId,
      "birthday"
    );

    if (!birthdayEmailTemplate) {
      console.warn("Birthday email template not found");
      return false;
    }

    // Create banner image HTML
    const bannerHtml = createBannerImageHtml(birthdayEmailTemplate.imageUrl);

    const customerName = customer.firstName
      ? `${customer.firstName} ${customer.lastName || ""}`.trim()
      : customer.email;

    // Render email using HTML template files
    const birthdayTemplate = renderEmailTemplate("birthday", {
      customer_name: customerName,
      shop_link: store.store_url || store.store_domain || "",
      birthday_points: totalPoints,
      point_name: pointModel.pointName,
      banner_image: bannerHtml,
      store_name: store.store_name || "Store",
    });

    await sendEmail(
      customer.email,
      process.env.EMAIL_FROM || "support@favloyalty.com",
      birthdayEmailTemplate.heading || "Happy Birthday!",
      birthdayTemplate,
      store.store_name || "FavLoyalty"
    );

    return true;
  } catch (error) {
    console.error("Error sending birthday email:", error);
    return false;
  }
}

/**
 * Send festival/event email to customer
 */
async function sendFestivalEmail(
  customer,
  store,
  pointModel,
  totalPoints,
  eventName,
  channelId
) {
  try {
    console.log(
      `🔍 Starting email send process for customer ${customer.email}, event "${eventName}"`
    );

    const collectSettings = await CollectSettings.findOne({
      store_id: store._id,
      channel_id: channelId,
    });

    if (!collectSettings) {
      console.warn(
        `⚠️ Email not sent: CollectSettings not found for store ${store._id}, channel ${channelId}`
      );
      return false;
    }

    // Check if email is enabled
    const allEmailEnabled = collectSettings.emailSetting?.all?.enable || false;
    const festivalEmailEnabled = collectSettings.emailSetting?.festival?.enable || false;
    
    console.log(
      `📋 Email settings check: all.enable=${allEmailEnabled}, festival.enable=${festivalEmailEnabled}`
    );
    
    if (!allEmailEnabled && !festivalEmailEnabled) {
      console.warn(
        `⚠️ Email not sent: Email settings disabled. all.enable=${allEmailEnabled}, festival.enable=${festivalEmailEnabled}`
      );
      return false;
    }

    // Get email template from database (for heading and image URL)
    console.log(`🔍 Looking for festival email template for channel ${channelId}`);
    const festivalEmailTemplate = await EmailTemplate.findByChannelAndType(
      channelId,
      "festival"
    );

    if (!festivalEmailTemplate) {
      console.warn(
        `⚠️ Email not sent: Festival email template not found for channel ${channelId}`
      );
      return false;
    }
    
    console.log(
      `✅ Festival email template found for channel ${channelId}`
    );

    // Create banner image HTML
    const absoluteImageUrl = getAbsoluteImageUrl(festivalEmailTemplate.imageUrl);
    console.log(
      `🖼️  Festival email image: original="${festivalEmailTemplate.imageUrl}", absolute="${absoluteImageUrl}"`
    );
    const bannerHtml = createBannerImageHtml(festivalEmailTemplate.imageUrl);

    const customerName = customer.firstName
      ? `${customer.firstName} ${customer.lastName || ""}`.trim()
      : customer.email;

    // Render email using HTML template files
    const festivalTemplate = renderEmailTemplate("festival", {
      customer_name: customerName,
      shop_link: store.store_url || store.store_domain || "",
      event_points: totalPoints,
      point_name: pointModel.pointName,
      event_name: eventName,
      current_points: customer.points || 0,
      banner_image: bannerHtml,
      store_name: store.store_name || "Store",
    });

    console.log(
      `📧 Attempting to send festival email to ${customer.email} for event "${eventName}"`
    );
    
    await sendEmail(
      customer.email,
      process.env.EMAIL_FROM || "support@favloyalty.com",
      festivalEmailTemplate.heading || "Event Celebration",
      festivalTemplate,
      store.store_name || "FavLoyalty"
    );

    console.log(
      `✅ Festival email sent successfully to ${customer.email} for event "${eventName}"`
    );
    return true;
  } catch (error) {
    console.error(`❌ Error sending festival email to ${customer.email}:`, error);
    console.error(`❌ Error stack:`, error.stack);
    return false;
  }
}

/**
 * Send points expiration email
 */
async function sendPointsExpirationEmail(
  customer,
  store,
  pointModel,
  pointsDeducted,
  channelId
) {
  try {
    const collectSettings = await CollectSettings.findOne({
      store_id: store._id,
      channel_id: channelId,
    });

    if (!collectSettings) {
      console.warn("CollectSettings not found for points expiration email");
      return false;
    }

    // Check if email is enabled
    if (
      !(
        collectSettings.emailSetting?.all?.enable ||
        collectSettings.emailSetting?.pointsExpire?.enable
      )
    ) {
      return false;
    }

    // Get email template from database (for heading and image URL)
    const pointsExpireEmailTemplate = await EmailTemplate.findByChannelAndType(
      channelId,
      "pointsExpire"
    );

    if (!pointsExpireEmailTemplate) {
      console.warn("Points expiration email template not found");
      return false;
    }

    // Create banner image HTML
    const bannerHtml = createBannerImageHtml(pointsExpireEmailTemplate.imageUrl);

    const customerName = customer.firstName
      ? `${customer.firstName} ${customer.lastName || ""}`.trim()
      : customer.email;

    // Render email using HTML template files
    const pointsExpireTemplate = renderEmailTemplate("pointsExpire", {
      customer_name: customerName,
      shop_link: store.store_url || store.store_domain || "",
      expired_points: pointsDeducted,
      remaining_points: customer.points || 0,
      point_name: pointModel.pointName,
      banner_image: bannerHtml,
      store_name: store.store_name || "Store",
    });

    await sendEmail(
      customer.email,
      process.env.EMAIL_FROM || "support@favloyalty.com",
      pointsExpireEmailTemplate.heading || "Points Expired",
      pointsExpireTemplate,
      store.store_name || "FavLoyalty"
    );

    return true;
  } catch (error) {
    console.error("Error sending points expiration email:", error);
    return false;
  }
}

/**
 * Send coupon expiration warning email
 */
async function sendCouponExpirationWarningEmail(
  customer,
  store,
  transaction,
  daysRemaining,
  channelId
) {
  try {
    const collectSettings = await CollectSettings.findOne({
      store_id: store._id,
      channel_id: channelId,
    });

    if (!collectSettings) {
      console.warn("CollectSettings not found for coupon expiration email");
      return false;
    }

    // Check if email is enabled
    if (
      !(
        collectSettings.emailSetting?.all?.enable ||
        collectSettings.emailSetting?.couponExpire?.enable
      )
    ) {
      return false;
    }

    // Get email template from database (for heading and image URL)
    const couponExpireEmailTemplate = await EmailTemplate.findByChannelAndType(
      channelId,
      "couponExpire"
    );

    if (!couponExpireEmailTemplate) {
      console.warn("Coupon expiration email template not found");
      return false;
    }

    // Create banner image HTML
    const bannerHtml = createBannerImageHtml(couponExpireEmailTemplate.imageUrl);

    const customerName = customer.firstName
      ? `${customer.firstName} ${customer.lastName || ""}`.trim()
      : customer.email;

    const expiryDate = transaction.expiresAt
      ? new Date(transaction.expiresAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "";

    // Render email using HTML template files
    const couponExpireTemplate = renderEmailTemplate("couponExpire", {
      customer_name: customerName,
      shop_link: store.store_url || store.store_domain || "",
      coupon_code: transaction.metadata?.couponCode || "N/A",
      coupon_value: transaction.metadata?.couponValue || "N/A",
      coupon_expiry_days: daysRemaining,
      expiry_date: expiryDate,
      banner_image: bannerHtml,
      store_name: store.store_name || "Store",
    });

    await sendEmail(
      customer.email,
      process.env.EMAIL_FROM || "support@favloyalty.com",
      couponExpireEmailTemplate.heading || "Coupon Expiring Soon",
      couponExpireTemplate,
      store.store_name || "FavLoyalty"
    );

    return true;
  } catch (error) {
    console.error("Error sending coupon expiration warning email:", error);
    return false;
  }
}

/**
 * Send monthly points statement email
 */
async function sendMonthlyPointsEmail(customer, store, pointModel, channelId) {
  try {
    const collectSettings = await CollectSettings.findOne({
      store_id: store._id,
      channel_id: channelId,
    });

    if (!collectSettings) {
      console.warn("CollectSettings not found for monthly points email");
      return false;
    }

    // Check if email is enabled
    if (
      !(
        collectSettings.emailSetting?.all?.enable ||
        collectSettings.emailSetting?.monthlyPoints?.enable
      )
    ) {
      return false;
    }

    // Get email template from database (for heading and image URL)
    const monthlyPointsTemplate = await EmailTemplate.findByChannelAndType(
      channelId,
      "monthlyPoints"
    );

    if (!monthlyPointsTemplate) {
      console.warn("Monthly points email template not found");
      return false;
    }

    // Get transactions from last month
    const Transaction = require("../models/Transaction");
    const lastMonthStart = new Date();
    lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
    lastMonthStart.setDate(1);
    lastMonthStart.setHours(0, 0, 0, 0);

    const lastMonthEnd = new Date();
    lastMonthEnd.setDate(0);
    lastMonthEnd.setHours(23, 59, 59, 999);

    const transactions = await Transaction.find({
      customerId: customer._id,
      createdAt: {
        $gte: lastMonthStart,
        $lte: lastMonthEnd,
      },
    });

    const pointsEarned = transactions
      .filter((t) => t.type === "earn")
      .reduce((sum, t) => sum + (t.points || 0), 0);

    const pointsSpent = transactions
      .filter((t) => t.type === "redeem")
      .reduce((sum, t) => sum + Math.abs(t.points || 0), 0);

    // Calculate expiring points (next month)
    const nextMonthEnd = new Date();
    nextMonthEnd.setMonth(nextMonthEnd.getMonth() + 2, 0);

    const expiringTransactions = await Transaction.find({
      customerId: customer._id,
      expiresAt: {
        $gte: new Date(),
        $lte: nextMonthEnd,
      },
      status: "completed",
      type: "earn",
    });

    const pointsExpiring = expiringTransactions.reduce(
      (sum, t) => sum + (t.points || 0),
      0
    );

    // Create banner image HTML
    const bannerHtml = createBannerImageHtml(monthlyPointsTemplate.imageUrl);

    const customerName = customer.firstName
      ? `${customer.firstName} ${customer.lastName || ""}`.trim()
      : customer.email;

    // Render email using HTML template files
    const monthlyStatementTemplate = renderEmailTemplate("monthlyPoints", {
      customer_name: customerName,
      shop_link: store.store_url || store.store_domain || "",
      point_name: pointModel.pointName,
      current_balance: customer.points || 0,
      points_earned: pointsEarned,
      points_spent: pointsSpent,
      points_expiring: pointsExpiring,
      expiry_date: nextMonthEnd.toLocaleDateString(),
      tierStatus: pointModel.tierStatus || false,
      banner_image: bannerHtml,
      store_name: store.store_name || "Store",
    });

    await sendEmail(
      customer.email,
      process.env.EMAIL_FROM || "support@favloyalty.com",
      monthlyPointsTemplate.heading || "Monthly Points Statement",
      monthlyStatementTemplate,
      store.store_name || "FavLoyalty"
    );

    return true;
  } catch (error) {
    console.error("Error sending monthly points email:", error);
    return false;
  }
}

module.exports = {
  getExpiryDate,
  sendBirthdayEmail,
  sendFestivalEmail,
  sendPointsExpirationEmail,
  sendCouponExpirationWarningEmail,
  sendMonthlyPointsEmail,
};
