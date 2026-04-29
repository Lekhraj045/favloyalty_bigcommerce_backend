const Handlebars = require("handlebars");
const { sendEmail, renderTemplate } = require("../services/emailService");
const EmailTemplate = require("../models/EmailTemplate");
const CollectSettings = require("../models/CollectSettings");
const Point = require("../models/Point");
const Store = require("../models/Store");
const { getAbsoluteImageUrl } = require("./imageUrlHelper");
const {
  renderEmailTemplate,
  createBannerImageHtml,
} = require("./emailTemplateLoader");

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
async function sendBirthdayEmail(
  customer,
  store,
  pointModel,
  totalPoints,
  channelId,
  channelSiteUrl,
) {
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
      "birthday",
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
      shop_link: channelSiteUrl || store.store_url || store.store_domain || "",
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
      store.store_name || "FavLoyalty",
    );

    return true;
  } catch (error) {
    console.error("Error sending birthday email:", error);
    return false;
  }
}

/**
 * Send profile completion reward email to customer (only if emailSetting.profileCompletion.enable is true).
 */
async function sendProfileCompletionEmail(
  customer,
  store,
  pointModel,
  totalPoints,
  channelId,
  channelSiteUrl,
) {
  try {
    const collectSettings = await CollectSettings.findOne({
      store_id: store._id,
      channel_id: channelId,
    });

    if (!collectSettings) {
      console.warn("CollectSettings not found for profile completion email");
      return false;
    }

    // Only send if Profile Completion Reward email is enabled in collectSettings.emailSetting
    const emailEnabled =
      collectSettings.emailSetting &&
      (collectSettings.emailSetting.all?.enable === true ||
        collectSettings.emailSetting.profileCompletion?.enable === true);
    if (!emailEnabled) {
      return false;
    }

    const profileCompletionTemplate = await EmailTemplate.findByChannelAndType(
      channelId,
      "profileCompletion",
    );

    if (!profileCompletionTemplate) {
      console.warn("Profile completion email template not found for channel");
      return false;
    }

    const bannerHtml = createBannerImageHtml(
      profileCompletionTemplate.imageUrl,
    );

    const customerName =
      customer.firstName && customer.lastName
        ? `${customer.firstName} ${customer.lastName}`.trim()
        : customer.firstName || customer.email;

    const profileTemplate = renderEmailTemplate("profileCompletion", {
      customer_name: customerName,
      shop_link: channelSiteUrl || store.store_url || store.store_domain || "",
      profile_completion_points: totalPoints,
      point_name: (pointModel && pointModel.pointName) || "Points",
      banner_image: bannerHtml,
      store_name: store.store_name || "Store",
    });

    await sendEmail(
      customer.email,
      process.env.EMAIL_FROM || "support@favloyalty.com",
      profileCompletionTemplate.heading || "Profile Completed!",
      profileTemplate,
      store.store_name || "FavLoyalty",
    );

    return true;
  } catch (error) {
    console.error("Error sending profile completion email:", error);
    return false;
  }
}

/**
 * Send newsletter subscription reward email to customer (only if emailSetting.newsletter.enable is true).
 */
async function sendNewsletterSubscriptionEmail(
  customer,
  store,
  pointModel,
  totalPoints,
  channelId,
  channelSiteUrl,
) {
  try {
    const collectSettings = await CollectSettings.findOne({
      store_id: store._id,
      channel_id: channelId,
    });

    if (!collectSettings) {
      console.warn(
        "CollectSettings not found for newsletter subscription email",
      );
      return false;
    }

    const emailEnabled =
      collectSettings.emailSetting &&
      (collectSettings.emailSetting.all?.enable === true ||
        collectSettings.emailSetting.newsletter?.enable === true);
    if (!emailEnabled) {
      return false;
    }

    const newsletterTemplate = await EmailTemplate.findByChannelAndType(
      channelId,
      "newsletter",
    );

    if (!newsletterTemplate) {
      console.warn("Newsletter email template not found for channel");
      return false;
    }

    const bannerHtml = createBannerImageHtml(newsletterTemplate.imageUrl);

    const customerName =
      customer.firstName && customer.lastName
        ? `${customer.firstName} ${customer.lastName}`.trim()
        : customer.firstName || customer.email;

    const newsletterEmailHtml = renderEmailTemplate("newsletter", {
      customer_name: customerName,
      shop_link: channelSiteUrl || store.store_url || store.store_domain || "",
      newsletter_points: totalPoints,
      point_name: (pointModel && pointModel.pointName) || "Points",
      banner_image: bannerHtml,
      store_name: store.store_name || "Store",
    });

    await sendEmail(
      customer.email,
      process.env.EMAIL_FROM || "support@favloyalty.com",
      newsletterTemplate.heading || "Thanks for subscribing!",
      newsletterEmailHtml,
      store.store_name || "FavLoyalty",
    );

    return true;
  } catch (error) {
    console.error("Error sending newsletter subscription email:", error);
    return false;
  }
}

/**
 * Send sign-up welcome email to customer (only if emailSetting.signUp.enable is true).
 */
async function sendSignUpEmail(
  customer,
  store,
  pointModel,
  totalPoints,
  channelId,
  channelSiteUrl,
) {
  try {
    const collectSettings = await CollectSettings.findOne({
      store_id: store._id,
      channel_id: channelId,
    });

    if (!collectSettings) {
      console.warn("CollectSettings not found for sign-up email");
      return false;
    }

    // Only send if Sign Up email is enabled in collectSettings.emailSetting
    const emailEnabled =
      collectSettings.emailSetting &&
      (collectSettings.emailSetting.all?.enable === true ||
        collectSettings.emailSetting.signUp?.enable === true);
    if (!emailEnabled) {
      return false;
    }

    const signUpTemplate = await EmailTemplate.findByChannelAndType(
      channelId,
      "signUp",
    );

    if (!signUpTemplate) {
      console.warn("Sign-up email template not found for channel");
      return false;
    }

    const bannerHtml = createBannerImageHtml(signUpTemplate.imageUrl);

    const customerName =
      customer.firstName && customer.lastName
        ? `${customer.firstName} ${customer.lastName}`.trim()
        : customer.firstName || customer.email;

    const signUpEmailHtml = renderEmailTemplate("signUp", {
      customer_name: customerName,
      shop_link: channelSiteUrl || store.store_url || store.store_domain || "",
      signup_points: totalPoints,
      point_name: (pointModel && pointModel.pointName) || "Points",
      banner_image: bannerHtml,
      store_name: store.store_name || "Store",
    });

    await sendEmail(
      customer.email,
      process.env.EMAIL_FROM || "support@favloyalty.com",
      signUpTemplate.heading || "Welcome to Our Loyalty Program",
      signUpEmailHtml,
      store.store_name || "FavLoyalty",
    );

    return true;
  } catch (error) {
    console.error("Error sending sign-up email:", error);
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
  channelId,
  channelSiteUrl,
) {
  try {
    console.log(
      `🔍 Starting email send process for customer ${customer.email}, event "${eventName}"`,
    );

    const collectSettings = await CollectSettings.findOne({
      store_id: store._id,
      channel_id: channelId,
    });

    if (!collectSettings) {
      console.warn(
        `⚠️ Email not sent: CollectSettings not found for store ${store._id}, channel ${channelId}`,
      );
      return false;
    }

    // Check if email is enabled
    const allEmailEnabled = collectSettings.emailSetting?.all?.enable || false;
    const festivalEmailEnabled =
      collectSettings.emailSetting?.festival?.enable || false;

    console.log(
      `📋 Email settings check: all.enable=${allEmailEnabled}, festival.enable=${festivalEmailEnabled}`,
    );

    if (!allEmailEnabled && !festivalEmailEnabled) {
      console.warn(
        `⚠️ Email not sent: Email settings disabled. all.enable=${allEmailEnabled}, festival.enable=${festivalEmailEnabled}`,
      );
      return false;
    }

    // Get email template from database (for heading and image URL)
    console.log(
      `🔍 Looking for festival email template for channel ${channelId}`,
    );
    const festivalEmailTemplate = await EmailTemplate.findByChannelAndType(
      channelId,
      "festival",
    );

    if (!festivalEmailTemplate) {
      console.warn(
        `⚠️ Email not sent: Festival email template not found for channel ${channelId}`,
      );
      return false;
    }

    console.log(`✅ Festival email template found for channel ${channelId}`);

    // Create banner image HTML
    const absoluteImageUrl = getAbsoluteImageUrl(
      festivalEmailTemplate.imageUrl,
    );
    console.log(
      `🖼️  Festival email image: original="${festivalEmailTemplate.imageUrl}", absolute="${absoluteImageUrl}"`,
    );
    const bannerHtml = createBannerImageHtml(festivalEmailTemplate.imageUrl);

    const customerName = customer.firstName
      ? `${customer.firstName} ${customer.lastName || ""}`.trim()
      : customer.email;

    // Render email using HTML template files
    const festivalTemplate = renderEmailTemplate("festival", {
      customer_name: customerName,
      shop_link: channelSiteUrl || store.store_url || store.store_domain || "",
      event_points: totalPoints,
      point_name: pointModel.pointName,
      event_name: eventName,
      current_points: customer.points || 0,
      banner_image: bannerHtml,
      store_name: store.store_name || "Store",
    });

    console.log(
      `📧 Attempting to send festival email to ${customer.email} for event "${eventName}"`,
    );

    await sendEmail(
      customer.email,
      process.env.EMAIL_FROM || "support@favloyalty.com",
      festivalEmailTemplate.heading || "Event Celebration",
      festivalTemplate,
      store.store_name || "FavLoyalty",
    );

    console.log(
      `✅ Festival email sent successfully to ${customer.email} for event "${eventName}"`,
    );
    return true;
  } catch (error) {
    console.error(
      `❌ Error sending festival email to ${customer.email}:`,
      error,
    );
    console.error(`❌ Error stack:`, error.stack);
    return false;
  }
}

/**
 * Send Refer & Earn reward email to referrer (only if emailSetting.referAndEarn.enable is true).
 */
async function sendReferAndEarnEmail(
  customer,
  store,
  pointModel,
  totalPoints,
  channelId,
  channelSiteUrl,
) {
  try {
    const collectSettings = await CollectSettings.findOne({
      store_id: store._id,
      channel_id: channelId,
    });

    if (!collectSettings) {
      console.warn("CollectSettings not found for refer & earn email");
      return false;
    }

    const emailEnabled =
      collectSettings.emailSetting &&
      (collectSettings.emailSetting.all?.enable === true ||
        collectSettings.emailSetting.referAndEarn?.enable === true);
    if (!emailEnabled) {
      return false;
    }

    const referTemplate = await EmailTemplate.findByChannelAndType(
      channelId,
      "referAndEarn",
    );

    if (!referTemplate) {
      console.warn("Refer & Earn email template not found for channel");
      return false;
    }

    const bannerHtml = createBannerImageHtml(referTemplate.imageUrl);

    const customerName =
      customer.firstName && customer.lastName
        ? `${customer.firstName} ${customer.lastName}`.trim()
        : customer.firstName || customer.email;

    const referEmailHtml = renderEmailTemplate("referAndEarn", {
      customer_name: customerName,
      shop_link: channelSiteUrl || store.store_url || store.store_domain || "",
      referral_points: totalPoints,
      point_name: (pointModel && pointModel.pointName) || "Points",
      banner_image: bannerHtml,
      store_name: store.store_name || "Store",
    });

    await sendEmail(
      customer.email,
      process.env.EMAIL_FROM || "support@favloyalty.com",
      referTemplate.heading || "You earned referral rewards!",
      referEmailHtml,
      store.store_name || "FavLoyalty",
    );

    return true;
  } catch (error) {
    console.error("Error sending refer & earn email:", error);
    return false;
  }
}

/**
 * Send purchase reward email to customer (only if emailSetting.purchase.enable is true).
 */
async function sendPurchaseEmail(
  customer,
  store,
  pointModel,
  purchasePoints,
  channelId,
  channelSiteUrl,
) {
  try {
    const collectSettings = await CollectSettings.findOne({
      store_id: store._id,
      channel_id: channelId,
    });

    if (!collectSettings) {
      console.warn("CollectSettings not found for purchase email");
      return false;
    }

    const emailEnabled =
      collectSettings.emailSetting &&
      (collectSettings.emailSetting.all?.enable === true ||
        collectSettings.emailSetting.purchase?.enable === true);
    if (!emailEnabled) {
      return false;
    }

    const purchaseTemplate = await EmailTemplate.findByChannelAndType(
      channelId,
      "purchase",
    );

    if (!purchaseTemplate) {
      console.warn("Purchase email template not found for channel");
      return false;
    }

    const bannerHtml = createBannerImageHtml(purchaseTemplate.imageUrl);

    const customerName =
      customer.firstName && customer.lastName
        ? `${customer.firstName} ${customer.lastName}`.trim()
        : customer.firstName || customer.email;

    const purchaseEmailHtml = renderEmailTemplate("purchase", {
      customer_name: customerName,
      shop_link: channelSiteUrl || store.store_url || store.store_domain || "",
      purchase_points: Number(purchasePoints) || 0,
      point_name: (pointModel && pointModel.pointName) || "Points",
      banner_image: bannerHtml,
      store_name: store.store_name || "Store",
    });

    await sendEmail(
      customer.email,
      process.env.EMAIL_FROM || "support@favloyalty.com",
      purchaseTemplate.heading || "Thanks for your purchase!",
      purchaseEmailHtml,
      store.store_name || "FavLoyalty",
    );

    return true;
  } catch (error) {
    console.error("Error sending purchase email:", error);
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
  channelId,
  channelSiteUrl,
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
      "pointsExpire",
    );

    if (!pointsExpireEmailTemplate) {
      console.warn("Points expiration email template not found");
      return false;
    }

    // Create banner image HTML
    const bannerHtml = createBannerImageHtml(
      pointsExpireEmailTemplate.imageUrl,
    );

    const customerName = customer.firstName
      ? `${customer.firstName} ${customer.lastName || ""}`.trim()
      : customer.email;

    // Render email using HTML template files
    const pointsExpireTemplate = renderEmailTemplate("pointsExpire", {
      customer_name: customerName,
      shop_link: channelSiteUrl || store.store_url || store.store_domain || "",
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
      store.store_name || "FavLoyalty",
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
  channelId,
  channelSiteUrl,
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
      "couponExpire",
    );

    if (!couponExpireEmailTemplate) {
      console.warn("Coupon expiration email template not found");
      return false;
    }

    // Create banner image HTML
    const bannerHtml = createBannerImageHtml(
      couponExpireEmailTemplate.imageUrl,
    );

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
      shop_link: channelSiteUrl || store.store_url || store.store_domain || "",
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
      store.store_name || "FavLoyalty",
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
async function sendMonthlyPointsEmail(
  customer,
  store,
  pointModel,
  channelId,
  channelSiteUrl,
) {
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
      "monthlyPoints",
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
      0,
    );

    // Create banner image HTML
    const bannerHtml = createBannerImageHtml(monthlyPointsTemplate.imageUrl);

    const customerName = customer.firstName
      ? `${customer.firstName} ${customer.lastName || ""}`.trim()
      : customer.email;

    // Render email using HTML template files
    const monthlyStatementTemplate = renderEmailTemplate("monthlyPoints", {
      customer_name: customerName,
      shop_link: channelSiteUrl || store.store_url || store.store_domain || "",
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
      store.store_name || "FavLoyalty",
    );

    return true;
  } catch (error) {
    console.error("Error sending monthly points email:", error);
    return false;
  }
}

/**
 * Send referral invitation email to the referred person (friend).
 * Only sends if CollectSettings.emailSetting.referAndEarn.enable or all.enable is true.
 */
async function sendReferralInvitationEmail(
  referrerCustomer,
  referredEmail,
  store,
  channelId,
  channelSiteUrl,
) {
  try {
    const collectSettings = await CollectSettings.findOne({
      store_id: store._id,
      channel_id: channelId,
    });

    if (!collectSettings) {
      console.warn("CollectSettings not found for referral invitation email");
      return false;
    }

    const emailEnabled =
      collectSettings.emailSetting &&
      (collectSettings.emailSetting.all?.enable === true ||
        collectSettings.emailSetting.referAndEarn?.enable === true);
    if (!emailEnabled) {
      return false;
    }

    const pointModel = await Point.findOne({
      store_id: store._id,
      channel_id: channelId,
    });
    const pointName = (pointModel && pointModel.pointName) || "Points";
    const signupPoints =
      collectSettings.basic?.signup?.point != null
        ? collectSettings.basic.signup.point
        : 0;

    let storeBase = (store.store_url || store.store_domain || "")
      .trim()
      .replace(/\/+$/, "");
    if (storeBase && !/^https?:\/\//i.test(storeBase)) {
      storeBase = "https://" + storeBase;
    }
    const storeLink = storeBase
      ? `${storeBase}/login.php?action=create_account`
      : "#";
    const storeName = store.store_name || "Store";
    const referrerName =
      `${referrerCustomer.firstName || ""} ${
        referrerCustomer.lastName || ""
      }`.trim() || "A friend";

    const referralInvitationTemplate = `
    <table align="center" border="0" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; font-family: Arial, sans-serif;">
      <tr>
        <td style="padding: 40px 20px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">You've Been Invited!</h1>
        </td>
      </tr>
      <tr>
        <td style="padding: 40px 30px;">
          <h2 style="color: #333; margin: 0 0 20px 0; font-size: 24px;">Join {{storeName}} and Earn Rewards!</h2>
          <p style="color: #666; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
            Your friend <strong>{{referrerName}}</strong> has invited you to join {{storeName}} and earn amazing rewards!
          </p>
          <div style="background: #f8f9fa; padding: 25px; border-radius: 8px; margin: 30px 0; text-align: center;">
            <h3 style="color: #333; margin: 0 0 15px 0; font-size: 20px;">🎉 Special Signup Bonus</h3>
            <p style="color: #666; font-size: 18px; margin: 0 0 10px 0;">
              Get <strong style="color: #28a745; font-size: 24px;">{{signupPoints}}</strong> {{pointName}} when you sign up!
            </p>
            <p style="color: #888; font-size: 14px; margin: 0;">Plus earn more points with every purchase!</p>
          </div>
          <div style="text-align: center; margin: 40px 0;">
            <a href="{{storeLink}}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 15px 30px; border-radius: 5px; font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">
              Join {{storeName}} Now
            </a>
          </div>
          <div style="border-top: 1px solid #eee; padding-top: 30px; margin-top: 40px;">
            <h4 style="color: #333; margin: 0 0 15px 0;">Why Join {{storeName}}?</h4>
            <ul style="color: #666; padding-left: 20px; margin: 0;">
              <li style="margin-bottom: 10px;">Earn points with every purchase</li>
              <li style="margin-bottom: 10px;">Redeem points for exclusive discounts</li>
              <li style="margin-bottom: 10px;">Get access to member-only deals</li>
              <li style="margin-bottom: 10px;">Refer friends and earn more rewards</li>
            </ul>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding: 30px; background: #f8f9fa; text-align: center; border-top: 1px solid #eee;">
          <p style="color: #888; font-size: 14px; margin: 0 0 10px 0;">
            This invitation was sent by {{referrerName}} from {{storeName}}
          </p>
          <p style="color: #888; font-size: 12px; margin: 0;">
            If you don't want to receive these emails, you can ignore this message.
          </p>
        </td>
      </tr>
    </table>`;

    const template = Handlebars.compile(referralInvitationTemplate);
    const emailHtml = template({
      storeName,
      referrerName,
      storeLink,
      signupPoints,
      pointName,
    });

    await sendEmail(
      referredEmail,
      process.env.EMAIL_FROM || "support@favloyalty.com",
      `You're invited to join ${storeName}!`,
      emailHtml,
      storeName,
    );

    return true;
  } catch (error) {
    console.error("Error sending referral invitation email:", error);
    return false;
  }
}

/**
 * Send tier upgrade notification email to customer.
 * Only sends if:
 * 1. Tier system is enabled (pointModel.tierStatus === true)
 * 2. Tier upgrade notification is enabled (emailSetting.upgradedTrial.enable or all.enable)
 *
 * @param {Object} customer - Customer document
 * @param {Object} store - Store document
 * @param {Object} pointModel - Point model with tier configuration
 * @param {string} newTierName - Name of the new tier
 * @param {string} channelId - Channel MongoDB ObjectId
 * @returns {Promise<boolean>} - true if email was sent successfully
 */
async function sendTierUpgradeEmail(
  customer,
  store,
  pointModel,
  newTierName,
  channelId,
  channelSiteUrl,
) {
  try {
    // CRITICAL: Only send if tier system is enabled
    if (!pointModel || !pointModel.tierStatus) {
      console.log(
        `[TierUpgradeEmail] Tier system not enabled for store ${store._id}, skipping email`,
      );
      return false;
    }

    const collectSettings = await CollectSettings.findOne({
      store_id: store._id,
      channel_id: channelId,
    });

    if (!collectSettings) {
      console.warn(
        "[TierUpgradeEmail] CollectSettings not found for tier upgrade email",
      );
      return false;
    }

    // Check if tier upgrade notification is enabled
    const emailEnabled =
      collectSettings.emailSetting &&
      (collectSettings.emailSetting.all?.enable === true ||
        collectSettings.emailSetting.upgradedTrial?.enable === true);

    if (!emailEnabled) {
      console.log(
        `[TierUpgradeEmail] Tier upgrade email not enabled for store ${store._id}`,
      );
      return false;
    }

    // Get email template from database
    const tierUpgradeTemplate = await EmailTemplate.findByChannelAndType(
      channelId,
      "upgradedTrial",
    );

    if (!tierUpgradeTemplate) {
      console.warn(
        "[TierUpgradeEmail] Tier upgrade email template not found for channel",
      );
      return false;
    }

    // Create banner image HTML
    const bannerHtml = createBannerImageHtml(tierUpgradeTemplate.imageUrl);

    const customerName =
      customer.firstName && customer.lastName
        ? `${customer.firstName} ${customer.lastName}`.trim()
        : customer.firstName || customer.email;

    // Render email using HTML template files
    const tierUpgradeEmailHtml = renderEmailTemplate("upgradedTrial", {
      customer_name: customerName,
      shop_link: channelSiteUrl || store.store_url || store.store_domain || "",
      tier_name: newTierName,
      point_name: (pointModel && pointModel.pointName) || "Points",
      banner_image: bannerHtml,
      store_name: store.store_name || "Store",
    });

    await sendEmail(
      customer.email,
      process.env.EMAIL_FROM || "support@favloyalty.com",
      tierUpgradeTemplate.heading || "Congratulations! You've been upgraded!",
      tierUpgradeEmailHtml,
      store.store_name || "FavLoyalty",
    );

    console.log(
      `✅ [TierUpgradeEmail] Tier upgrade email sent to ${customer.email} for tier "${newTierName}"`,
    );
    return true;
  } catch (error) {
    console.error(
      "[TierUpgradeEmail] Error sending tier upgrade email:",
      error,
    );
    return false;
  }
}

/**
 * Send rejoining (welcome back) email to customer (only if emailSetting.rejoining.enable is true).
 */
async function sendRejoiningEmail(
  customer,
  store,
  pointModel,
  rejoiningPoints,
  channelId,
  channelSiteUrl,
) {
  try {
    const collectSettings = await CollectSettings.findOne({
      store_id: store._id,
      channel_id: channelId,
    });

    if (!collectSettings) {
      console.warn(
        "[RejoiningEmail] CollectSettings not found for rejoining email",
      );
      return false;
    }

    // Check if email is enabled
    if (
      !(
        collectSettings.emailSetting?.all?.enable ||
        collectSettings.emailSetting?.rejoining?.enable
      )
    ) {
      return false;
    }

    // Get email template from database (for heading and image URL)
    const rejoiningEmailTemplate = await EmailTemplate.findByChannelAndType(
      channelId,
      "rejoining",
    );

    if (!rejoiningEmailTemplate) {
      console.warn("[RejoiningEmail] Rejoining email template not found");
      return false;
    }

    // Create banner image HTML
    const bannerHtml = createBannerImageHtml(rejoiningEmailTemplate.imageUrl);

    const customerName = customer.firstName
      ? `${customer.firstName} ${customer.lastName || ""}`.trim()
      : customer.email;

    // Render email using HTML template files
    const rejoiningTemplate = renderEmailTemplate("rejoining", {
      customer_name: customerName,
      shop_link: channelSiteUrl || store.store_url || store.store_domain || "",
      rejoining_points: rejoiningPoints,
      point_name: pointModel.pointName || "Points",
      banner_image: bannerHtml,
      store_name: store.store_name || "Store",
    });

    await sendEmail(
      customer.email,
      process.env.EMAIL_FROM || "support@favloyalty.com",
      rejoiningEmailTemplate.heading || "Welcome Back!",
      rejoiningTemplate,
      store.store_name || "FavLoyalty",
    );

    console.log(
      `✅ [RejoiningEmail] Rejoining email sent to ${customer.email}`,
    );
    return true;
  } catch (error) {
    console.error("[RejoiningEmail] Error sending rejoining email:", error);
    return false;
  }
}

module.exports = {
  getExpiryDate,
  sendBirthdayEmail,
  sendProfileCompletionEmail,
  sendNewsletterSubscriptionEmail,
  sendSignUpEmail,
  sendFestivalEmail,
  sendPointsExpirationEmail,
  sendCouponExpirationWarningEmail,
  sendMonthlyPointsEmail,
  sendPurchaseEmail,
  sendReferAndEarnEmail,
  sendReferralInvitationEmail,
  sendTierUpgradeEmail,
  sendRejoiningEmail,
};
