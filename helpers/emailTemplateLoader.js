const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");
const { getAbsoluteImageUrl } = require("./imageUrlHelper");

// Template type to file name mapping
const TEMPLATE_FILE_MAP = {
  birthday: { main: "Birthday.html", body: "BirthdayBody.html" },
  festival: { main: "Festival.html", body: "FestivalBody.html" },
  signUp: { main: "Sign_Up.html", body: "SignUpBody.html" },
  purchase: { main: "Purchase.html", body: "PurchaseBody.html" },
  pointsExpire: { main: "Points_Expire.html", body: "PointsExpireBody.html" },
  couponExpire: { main: "Coupon_Expire.html", body: "Coupon_expire_body.html" },
  monthlyPoints: { main: "Monthly_Points.html", body: "MonthlyPointsBody.html" },
  newsletter: { main: "Newsletter.html", body: "NewsLetterBody.html" },
  referAndEarn: { main: "Refer&Earn.html", body: "Refer&EarnBody.html" },
  rejoining: { main: "Rejoining_Reminder.html", body: "RejoiningReminderBody.html" },
  profileCompletion: { main: "Profile_Complete.html", body: "ProfileCompleteBody.html" },
  upgradedTrial: { main: "Upgrade_Tier.html", body: "UpgradeTierBody.html" },
  planBuyReminder: { main: "PlanBuy_Reminder.html", body: "PlanBuyReminderBody.html" },
  trialExpired: { main: "Trial_Expired.html", body: "TrialExpiredBody.html" },
};

// Cache for loaded templates
const templateCache = {};

/**
 * Load HTML template file from email-templates folder
 * @param {string} filename - Name of the template file
 * @returns {string} - Template content as string
 */
function loadTemplateFile(filename) {
  const templatePath = path.join(__dirname, "../email-templates", filename);
  
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file not found: ${filename} at ${templatePath}`);
  }
  
  return fs.readFileSync(templatePath, "utf8");
}

/**
 * Get compiled Handlebars template (with caching)
 * @param {string} templateType - Type of email template (e.g., 'birthday', 'festival')
 * @param {string} templatePart - 'main' or 'body'
 * @returns {HandlebarsTemplateDelegate} - Compiled template
 */
function getCompiledTemplate(templateType, templatePart = "main") {
  const cacheKey = `${templateType}_${templatePart}`;
  
  // Return cached template if available
  if (templateCache[cacheKey]) {
    return templateCache[cacheKey];
  }
  
  // Get file mapping
  const fileMapping = TEMPLATE_FILE_MAP[templateType];
  if (!fileMapping) {
    throw new Error(`No template mapping found for type: ${templateType}`);
  }
  
  // Load template file
  const filename = templatePart === "main" ? fileMapping.main : fileMapping.body;
  const templateContent = loadTemplateFile(filename);
  
  // Compile template
  const compiledTemplate = Handlebars.compile(templateContent);
  
  // Cache it
  templateCache[cacheKey] = compiledTemplate;
  
  return compiledTemplate;
}

/**
 * Render email template with data
 * @param {string} templateType - Type of email template
 * @param {Object} data - Data to inject into template
 * @param {Object} options - Additional options
 * @returns {string} - Rendered HTML email
 */
function renderEmailTemplate(templateType, data, options = {}) {
  try {
    // Get main template
    const mainTemplate = getCompiledTemplate(templateType, "main");
    
    // Get body template if it exists
    let bodyContent = "";
    try {
      const bodyTemplate = getCompiledTemplate(templateType, "body");
      bodyContent = bodyTemplate(data);
    } catch (error) {
      console.warn(`⚠️  Body template not found for ${templateType}, using empty body`);
    }
    
    // Prepare template data
    const templateData = {
      ...data,
      body_children: bodyContent,
      banner_image: data.banner_image || "",
      store_name: data.store_name || "Store",
    };
    
    // Render main template with body content
    const renderedEmail = mainTemplate(templateData);
    
    return renderedEmail;
  } catch (error) {
    console.error(`❌ Error rendering email template ${templateType}:`, error);
    throw error;
  }
}

/**
 * Create banner image HTML from image URL
 * @param {string} imageUrl - Image URL (relative or absolute)
 * @returns {string} - HTML img tag
 */
function createBannerImageHtml(imageUrl) {
  if (!imageUrl || imageUrl.trim() === "") {
    return "";
  }
  
  const absoluteImageUrl = getAbsoluteImageUrl(imageUrl);
  if (!absoluteImageUrl) {
    return "";
  }
  
  return `<img src="${absoluteImageUrl}" alt="Email Banner" style="display: block; max-width: 100%; height: auto; width: 65%; max-width: 390px; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; clear: both; border: none;" width="390" />`;
}

module.exports = {
  loadTemplateFile,
  getCompiledTemplate,
  renderEmailTemplate,
  createBannerImageHtml,
  TEMPLATE_FILE_MAP,
};
