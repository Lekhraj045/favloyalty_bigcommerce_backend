const express = require("express");
const { requireAuth } = require("../helpers/bigcommerce");
const {
  subscribeWebhook,
  getAllWebhooks,
  getWebhook,
  receiveWebhook,
  getWebhookLogs,
  unsubscribeWebhook,
} = require("../controllers/webhookController");

const router = express.Router();

// Public route - BigCommerce will call this endpoint
// No authentication required as BigCommerce uses HMAC signature verification
router.post("/receive", receiveWebhook);

// Protected routes - require authentication
router.post("/subscribe", requireAuth, subscribeWebhook);
router.get("/", requireAuth, getAllWebhooks);
router.get("/logs", requireAuth, getWebhookLogs);
router.get("/:webhookId", requireAuth, getWebhook);
router.delete("/:webhookId", requireAuth, unsubscribeWebhook);

module.exports = router;
