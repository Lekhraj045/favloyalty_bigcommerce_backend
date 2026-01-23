const nodemailer = require("nodemailer");
const Handlebars = require("handlebars");

// Create a transporter object using SMTP transport
const createTransporter = () => {
  const smtpHost = process.env.EMAIL_SMTP_HOST || "email-smtp.us-east-1.amazonaws.com";
  const smtpPort = parseInt(process.env.EMAIL_SMTP_PORT || "465", 10);
  const smtpSecure = process.env.EMAIL_SMTP_SECURE !== "false"; // Default to true
  const smtpUser = process.env.EMAIL_SMTP_USER;
  const smtpPassword = process.env.EMAIL_SMTP_PASSWORD;

  // Log configuration (without exposing password)
  console.log("📧 SMTP Configuration Check:", {
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    user: smtpUser ? `${smtpUser.substring(0, 8)}...` : "❌ NOT SET",
    password: smtpPassword ? `✅ SET (${smtpPassword.length} chars)` : "❌ NOT SET",
  });

  // Check for missing or empty credentials
  if (!smtpUser || smtpUser.trim() === "" || !smtpPassword || smtpPassword.trim() === "") {
    const errorMsg = "❌ Email SMTP credentials not configured or empty. Please set EMAIL_SMTP_USER and EMAIL_SMTP_PASSWORD in .env file.";
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPassword,
    },
  });

  console.log("✅ SMTP Transporter created successfully");
  return transporter;
};

// Create transporter lazily to ensure env vars are loaded
let transporter = null;
const getTransporter = () => {
  if (!transporter) {
    transporter = createTransporter();
  }
  return transporter;
};

/**
 * Send email using nodemailer
 * @param {string} to - Recipient email address
 * @param {string} from - Sender email address
 * @param {string} subject - Email subject
 * @param {string} html - HTML email body
 * @param {string} senderName - Optional sender name
 * @returns {Promise<Object>} Email info
 */
const sendEmail = async (to, from, subject, html, senderName = null) => {
  console.log(`📧 Attempting to send email to: ${to}`);
  console.log(`📧 From: ${from}, Subject: ${subject}`);
  
  const mailOptions = {
    from: senderName ? `${senderName} <${from}>` : from,
    to: to,
    subject: subject,
    html: html,
    text: html.replace(/<[^>]*>/g, ""), // Strip HTML for text version
  };

  try {
    const emailTransporter = getTransporter();
    console.log("📧 Sending email via SMTP...");
    const info = await emailTransporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully: ${info.messageId} to ${to}`);
    return info;
  } catch (error) {
    console.error(`❌ Error sending email to ${to}:`, error);
    console.error(`❌ Error details:`, {
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
    });
    throw new Error(`Email sending failed: ${error.message}`);
  }
};

/**
 * Compile and render Handlebars template
 * @param {string} template - Handlebars template string
 * @param {Object} data - Data to inject into template
 * @returns {string} Rendered HTML
 */
const renderTemplate = (template, data) => {
  try {
    const compiledTemplate = Handlebars.compile(template);
    return compiledTemplate(data);
  } catch (error) {
    console.error("❌ Error rendering template:", error);
    throw new Error(`Template rendering failed: ${error.message}`);
  }
};

/**
 * Replace template variables in email content
 * @param {string} content - Content with template variables
 * @param {Object} variables - Variables to replace
 * @returns {string} Content with variables replaced
 */
const replaceTemplateVariables = (content, variables) => {
  if (!content) return "";
  
  let result = content;
  Object.keys(variables).forEach((key) => {
    const regex = new RegExp(`{{${key}}}`, "g");
    result = result.replace(regex, variables[key] || "");
  });
  return result;
};

module.exports = {
  sendEmail,
  renderTemplate,
  replaceTemplateVariables,
  get transporter() {
    return getTransporter();
  },
};
