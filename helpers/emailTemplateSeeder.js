const EmailTemplate = require("../models/EmailTemplate");
const mongoose = require("mongoose");

// Mapping template types directly to image paths in uploads/email-templates/email-images folder
const TEMPLATE_TYPE_TO_IMAGE_MAP = {
  birthday: "/images/birthday.png",
  couponExpire: "/images/coupon-expire.png",
  festival: "/images/festival-celebration-rewards.png",
  monthlyPoints: "/images/monthly-points.png",
  newsletter: "/images/loyalty-program.png",
  pointsExpire: "/images/points_expired.png",
  referAndEarn: "/images/refer_earn.png",
  rejoining: "/images/welcome-to-our-loyalty-program.png",
  signUp: "/images/welcome-to-our-loyalty-program.png",
  purchase: "/images/points-on-order-fulfillment.png",
  profileCompletion: "/images/profile-completion-reward.png",
  upgradedTrial: "/images/tier_upgraded.png",
};

// Legacy mapping for Cloudinary URLs (fallback) - now maps to uploads/email-templates/email-images
const IMAGE_URL_MAP = {
  "birthday_image.png": "/images/birthday.png",
  "coupon-expire_qfraje.png": "/images/coupon-expire.png",
  "image-5_v20daf.png": "/images/festival-celebration-rewards.png",
  "monthlypoints_lcthkw.png": "/images/monthly-points.png",
  "newletter_yabfyf.png": "/images/loyalty-program.png",
  "points_expired_lj7qf0.png": "/images/points_expired.png",
  "profile-completion-reward_ttop4b.png":
    "/images/profile-completion-reward.png",
  "points-on-order-fulfillment_pmzdpe.png":
    "/images/points-on-order-fulfillment.png",
  "refer_earn_modb5d.png": "/images/refer_earn.png",
  "rejoinReminder_gmmhua.png": "/images/welcome-to-our-loyalty-program.png",
  "welcome-to-our-loyalty-program_qxblux.png":
    "/images/welcome-to-our-loyalty-program.png",
  "tier_upgraded_trcdbe.png": "/images/tier_upgraded.png",
};

// Extract filename from Cloudinary URL
const extractFilename = (cloudinaryUrl) => {
  if (!cloudinaryUrl) return "";
  const match = cloudinaryUrl.match(/\/([^\/]+)$/);
  return match ? match[1] : "";
};

// Convert template type or Cloudinary URL to public folder path
const convertImageUrl = (templateType, cloudinaryUrl) => {
  // First, try to map by templateType (preferred method)
  if (templateType && TEMPLATE_TYPE_TO_IMAGE_MAP[templateType]) {
    return TEMPLATE_TYPE_TO_IMAGE_MAP[templateType];
  }

  // Fallback to Cloudinary URL mapping
  if (!cloudinaryUrl) return "";

  // If already a public path, return as is
  if (
    cloudinaryUrl.startsWith("/uploads/email-templates/email-images/") ||
    cloudinaryUrl.startsWith("/uploads/email-images/") ||
    cloudinaryUrl.startsWith("/images/")
  ) {
    return cloudinaryUrl;
  }

  const filename = extractFilename(cloudinaryUrl);
  console.log(
    `🔄 Converting Cloudinary URL. Extracted filename: ${filename} from ${cloudinaryUrl}`,
  );
  return (
    IMAGE_URL_MAP[filename] ||
    "/uploads/email-templates/email-images/default-email-banner.png"
  );
};

// Default email templates data
const getDefaultEmailTemplates = () => {
  return [
    {
      templateType: "signUp",
      name: "Welcome to Our Loyalty Program",
      heading: "Welcome to Our Loyalty Program",
      imageUrl: "/uploads/email-templates/email-images/signup-notifaction.svg",
      body: `<div class="u-row-container" style="padding: 0px; background-color: transparent">
  <div class="u-row" style="margin: 0 auto; min-width: 320px; max-width: 600px; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word; background-color: transparent;">
    <div style="border-collapse: collapse; display: table; width: 100%; height: 100%; background-color: transparent;">
      <div class="u-col u-col-100" style="max-width: 320px; min-width: 600px; display: table-cell; vertical-align: top;">
        <div style="background-color: #ffffff; height: 100%; width: 100% !important; border-radius: 0px;">
          <div style="box-sizing: border-box; height: 100%; padding: 0px; border-top: 0px solid transparent; border-left: 0px solid transparent; border-right: 0px solid transparent; border-bottom: 0px solid transparent; border-radius: 0px;">
            <table id="u_content_heading_1" style="font-family: arial, helvetica, sans-serif" role="presentation" cellpadding="0" cellspacing="0" width="100%" border="0">
              <tbody>
                <tr>
                  <td class="v-container-padding-padding" style="overflow-wrap: break-word; word-break: break-word; padding: 60px 10px 10px; font-family: arial, helvetica, sans-serif;" align="left">
                    <h1 class="v-line-height v-font-size" style="margin: 0px; line-height: 130%; text-align: center; word-wrap: break-word; font-family: 'Montserrat', sans-serif; font-size: 24px; font-weight: 400;">
                      <div><strong>Welcome {{customer_name}}!</strong><br /><strong>You're now part of our loyalty program.</strong></div>
                    </h1>
                  </td>
                </tr>
              </tbody>
            </table>
            <table id="u_content_text_1" style="font-family: arial, helvetica, sans-serif" role="presentation" cellpadding="0" cellspacing="0" width="100%" border="0">
              <tbody>
                <tr>
                  <td class="v-container-padding-padding" style="overflow-wrap: break-word; word-break: break-word; padding: 10px 80px; font-family: arial, helvetica, sans-serif;" align="left">
                    <div class="v-line-height v-font-size" style="font-size: 14px; line-height: 170%; text-align: center; word-wrap: break-word;">
                      <p style="font-size: 14px; line-height: 170%">We're thrilled to have you join our loyalty program! As a welcome gift, we've added {{signup_points}} {{point_name}} to your account. Start earning more rewards with every purchase!</p>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <table id="u_content_button_1" style="font-family: arial, helvetica, sans-serif" role="presentation" cellpadding="0" cellspacing="0" width="100%" border="0">
              <tbody>
                <tr>
                  <td class="v-container-padding-padding" style="overflow-wrap: break-word; word-break: break-word; padding: 10px 10px 40px; font-family: arial, helvetica, sans-serif;" align="left">
                    <div align="center">
                      <a href="{{shop_link}}" target="_blank" class="v-button v-size-width v-font-size" style="box-sizing: border-box; display: inline-block; text-decoration: none; -webkit-text-size-adjust: none; text-align: center; color: #ffffff; background-color: #ef3f42; border-radius: 4px; width: 30%; max-width: 100%; overflow-wrap: break-word; word-break: break-word; word-wrap: break-word; mso-border-alt: none; font-size: 14px;">
                        <span class="v-line-height v-padding" style="display: block; padding: 10px 20px; line-height: 120%;"><span style="font-size: 14px; line-height: 16.8px">Shop Now</span></span>
                      </a>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>`,
      emailTemplate: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional //EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome</title>
</head>
<body style="margin: 0; padding: 0; background-color: #e7e7e7;">
  <table id="u_body" style="border-collapse: collapse; table-layout: fixed; border-spacing: 0; margin: 0 auto; background-color: #e7e7e7; width: 100%;" cellpadding="0" cellspacing="0">
    <tbody>
      <tr style="vertical-align: top">
        <td style="word-break: break-word; border-collapse: collapse !important; vertical-align: top;">
          {{{banner_image}}}
          {{{body_children}}}
        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>`,
      options: [
        "{{customer_name}}",
        "{{signup_points}}",
        "{{point_name}}",
        "{{shop_link}}",
      ],
    },
    {
      templateType: "purchase",
      name: "Points On Order Fulfillment Notification",
      heading: "Points On Order Fulfillment Notification",
      imageUrl: "/uploads/email-templates/email-images/purchase-notifation.svg",
      body: `<div class="u-row-container" style="padding: 0px; background-color: transparent">
  <div class="u-row" style="margin: 0 auto; min-width: 320px; max-width: 600px; overflow-wrap: break-word; word-wrap: break-word; word-break: break-word; background-color: transparent;">
    <div style="border-collapse: collapse; display: table; width: 100%; height: 100%; background-color: transparent;">
      <div class="u-col u-col-100" style="max-width: 320px; min-width: 600px; display: table-cell; vertical-align: top;">
        <div style="background-color: #ffffff; height: 100%; width: 100% !important;">
          <div style="box-sizing: border-box; height: 100%; padding: 0px;">
            <table id="u_content_heading_1" style="font-family: arial, helvetica, sans-serif" role="presentation" cellpadding="0" cellspacing="0" width="100%" border="0">
              <tbody>
                <tr>
                  <td class="v-container-padding-padding" style="overflow-wrap: break-word; word-break: break-word; padding: 60px 10px 10px; font-family: arial, helvetica, sans-serif;" align="left">
                    <h1 class="v-line-height v-font-size" style="margin: 0px; line-height: 130%; text-align: center; word-wrap: break-word; font-family: 'Montserrat', sans-serif; font-size: 24px; font-weight: 400;">
                      <div><strong>Congratulations, {{customer_name}}!</strong><br /><strong>Your Earned Rewards Await!</strong></div>
                    </h1>
                  </td>
                </tr>
              </tbody>
            </table>
            <table id="u_content_text_1" style="font-family: arial, helvetica, sans-serif" role="presentation" cellpadding="0" cellspacing="0" width="100%" border="0">
              <tbody>
                <tr>
                  <td class="v-container-padding-padding" style="overflow-wrap: break-word; word-break: break-word; padding: 10px 80px; font-family: arial, helvetica, sans-serif;" align="left">
                    <div class="v-line-height v-font-size" style="font-size: 14px; line-height: 170%; text-align: center; word-wrap: break-word;">
                      <p style="font-size: 14px; line-height: 170%">We're excited to congratulate you on your recent order! As a valued member of our loyalty program, you've earned {{purchase_points}} {{point_name}} with your purchase. Please note that your {{purchase_points}} {{point_name}} will be credited shortly, but they will be processed after the return window for your order has closed.</p>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <table id="u_content_button_1" style="font-family: arial, helvetica, sans-serif" role="presentation" cellpadding="0" cellspacing="0" width="100%" border="0">
              <tbody>
                <tr>
                  <td class="v-container-padding-padding" style="overflow-wrap: break-word; word-break: break-word; padding: 10px 10px 40px; font-family: arial, helvetica, sans-serif;" align="left">
                    <div align="center">
                      <a href="{{shop_link}}" target="_blank" class="v-button v-size-width v-font-size" style="box-sizing: border-box; display: inline-block; text-decoration: none; text-align: center; color: #ffffff; background-color: #ef3f42; border-radius: 4px; width: 30%; max-width: 100%; font-size: 14px; padding: 10px 20px;">
                        <span>Shop More</span>
                      </a>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>`,
      emailTemplate: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional //EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Purchase Rewards</title>
</head>
<body style="margin: 0; padding: 0; background-color: #e7e7e7;">
  <table id="u_body" style="border-collapse: collapse; table-layout: fixed; border-spacing: 0; margin: 0 auto; background-color: #e7e7e7; width: 100%;" cellpadding="0" cellspacing="0">
    <tbody>
      <tr style="vertical-align: top">
        <td style="word-break: break-word; border-collapse: collapse !important; vertical-align: top;">
          {{{banner_image}}}
          {{{body_children}}}
        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>`,
      options: [
        "{{customer_name}}",
        "{{purchase_points}}",
        "{{point_name}}",
        "{{shop_link}}",
      ],
    },
    // Add other templates similarly - for brevity, I'll create a function to load from JSON
  ];
};

/**
 * Seed default email templates for a channel
 * @param {string|ObjectId} channelId - The channel ID
 * @param {boolean} force - If true, seed templates even if they already exist
 * @returns {Promise<void>}
 */
const seedEmailTemplatesForChannel = async (channelId, force = false) => {
  try {
    const channelObjectId =
      typeof channelId === "string"
        ? new mongoose.Types.ObjectId(channelId)
        : channelId;

    console.log(`🌱 Seeding email templates for channel: ${channelObjectId}`);

    // Check if templates already exist for this channel
    const existingTemplates = await EmailTemplate.findByChannelId(channelObjectId);

    if (existingTemplates && existingTemplates.length > 0 && !force) {
      console.log(`ℹ️ Email templates already exist for channel ${channelObjectId}. Skipping seed.`);
      return;
    }

    if (force && existingTemplates && existingTemplates.length > 0) {
      console.log(`🔄 Force seeding: Templates exist but will be updated for channel ${channelObjectId}`);
    }

    // Load default templates from JSON file
    const fs = require("fs");
    const path = require("path");

    // Try multiple possible paths for the JSON file
    const possiblePaths = [
      path.join(__dirname, "../defaultEmailTemplates.json"), // Backend directory
      path.join(__dirname, "../../defaultEmailTemplates.json"), // Project root
      path.join(process.cwd(), "defaultEmailTemplates.json"), // Current working directory
      "c:\\Users\\DeskMoz\\Desktop\\test.emailtemplates.json", // Desktop path (absolute)
    ];

    let defaultTemplates = [];
    let jsonLoaded = false;

    for (const jsonFilePath of possiblePaths) {
      try {
        if (fs.existsSync(jsonFilePath)) {
          const jsonData = fs.readFileSync(jsonFilePath, "utf8");
          const parsedData = JSON.parse(jsonData);

          // Handle both array and object formats
          if (Array.isArray(parsedData)) {
            defaultTemplates = parsedData;
          } else if (
            parsedData.templates &&
            Array.isArray(parsedData.templates)
          ) {
            defaultTemplates = parsedData.templates;
          } else {
            defaultTemplates = [parsedData];
          }

          jsonLoaded = true;
          console.log(`✅ Loaded ${defaultTemplates.length} templates from: ${jsonFilePath}`);
          break;
        }
      } catch (error) {
        console.warn(`⚠️ Could not load JSON from ${jsonFilePath}:`, error.message);
        continue;
      }
    }

    if (!jsonLoaded) {
      console.warn("⚠️ Could not load JSON file from any path, using hardcoded templates");
      defaultTemplates = getDefaultEmailTemplates();
    }

    // Create templates for this channel
    const createdTemplates = [];

    for (const template of defaultTemplates) {
      try {
        // Convert template type to public folder path (preferred) or fallback to Cloudinary URL
        const imageUrl = convertImageUrl(
          template.templateType,
          template.imageUrl,
        );

        // Debug logging for imageUrl conversion
        if (!imageUrl || imageUrl === "") {
          console.warn(`⚠️ Empty imageUrl for template ${template.templateType}. Original: ${template.imageUrl}`);
        } else {
          console.log(`✅ Template ${template.templateType}: ${imageUrl}`);
        }

        const templateData = {
          channel_id: channelObjectId,
          templateType: template.templateType,
          name: template.name,
          heading: template.heading || template.name,
          imageUrl: imageUrl,
          body: template.body || "",
          emailTemplate: template.emailTemplate || "",
          options: template.options || [],
        };

        const created = await EmailTemplate.createOrUpdate(
          channelObjectId,
          templateData,
        );

        createdTemplates.push(created.templateType);
      } catch (error) {
        console.error(`❌ Error creating template ${template.templateType}:`, error.message);
      }
    }

    console.log(`✅ Successfully seeded ${createdTemplates.length} email templates for channel ${channelObjectId}:`, createdTemplates.join(", "));
  } catch (error) {
    console.error("❌ Error seeding email templates:", error.message);
    throw error;
  }
};

/**
 * Seed email templates for multiple channels
 * @param {Array<string|ObjectId>} channelIds - Array of channel IDs
 * @returns {Promise<void>}
 */
const seedEmailTemplatesForChannels = async (channelIds) => {
  if (!channelIds || channelIds.length === 0) {
    return;
  }

  for (const channelId of channelIds) {
    try {
      await seedEmailTemplatesForChannel(channelId);
    } catch (error) {
      console.error(`❌ Error seeding templates for channel ${channelId}:`, error.message);
      // Continue with other channels even if one fails
    }
  }
};

module.exports = {
  seedEmailTemplatesForChannel,
  seedEmailTemplatesForChannels,
  convertImageUrl,
};
