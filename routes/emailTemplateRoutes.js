const express = require("express");
const {
  getEmailTemplates,
  getEmailTemplateByType,
  seedTemplatesForChannel,
  seedTemplatesForStore,
  updateEmailTemplate,
} = require("../controllers/emailTemplateController");

const router = express.Router();

// Get all email templates for a channel
router.get("/", getEmailTemplates);

// Get a specific email template by type
router.get("/by-type", getEmailTemplateByType);

// Seed templates for a specific channel
router.post("/seed/channel", seedTemplatesForChannel);

// Seed templates for all channels in a store
router.post("/seed/store", seedTemplatesForStore);

// Update email template
router.put("/", updateEmailTemplate);

module.exports = router;
