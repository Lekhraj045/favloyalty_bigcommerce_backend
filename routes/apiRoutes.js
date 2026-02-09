const express = require("express");
const { login } = require("../controllers/authController");
const { requireAuth } = require("../helpers/bigcommerce");
const pointsRoutes = require("./pointsRoutes");
const collectSettingsRoutes = require("./collectSettingsRoutes");
const redeemSettingsRoutes = require("./redeemSettingsRoutes");
const widgetCustomizationRoutes = require("./widgetCustomizationRoutes");
const emailTemplateRoutes = require("./emailTemplateRoutes");
const paymentRoutes = require("./payment");
const {
  getChannels,
  updateSetupProgress,
  getSetupProgress,
  updatePageCompletionStatus,
  resetChannelSettings,
} = require("../controllers/channelController");
const { getProducts } = require("../controllers/productsController");
const {
  checkWidgetVisibility,
  getCustomerData,
  getStorefrontToken,
  getWidgetChannelSettings,
  getWidgetRedeemSettings,
  getWidgetTransactions,
  createReferral,
  getMyReferrals,
  updateWidgetVisibility,
  verifyCurrentCustomer,
  saveCustomerBirthday,
  saveCustomerProfile,
  subscribeCustomerNewsletter,
} = require("../controllers/widgetController");
const { createRedeemCoupon } = require("../controllers/widgetRedeemController");
const { getMyCoupons } = require("../controllers/widgetMyCouponsController");
const {
  getStorePlan,
  downgradeToFree,
} = require("../controllers/storeController");
const Plan = require("../models/Plan");
const {
  fetchAndStoreCustomers,
  getCustomers,
  getCustomerById,
  getCustomerReferrals,
  updateCustomerTier,
  recalculateCustomerTiers,
} = require("../controllers/customerController");
const {
  getTransactions,
  getTransactionById,
  createTransaction,
  getCustomerTransactions,
  bulkImportPoints,
  getPointsAwardedStats,
  getPointsRedeemedStats,
} = require("../controllers/transactionController");

const router = express.Router();

router.post("/login", login);
router.use("/points", pointsRoutes);
router.use("/collect-settings", collectSettingsRoutes);
router.use("/redeem-settings", redeemSettingsRoutes);
router.use("/widget-customization", widgetCustomizationRoutes);
router.use("/email-templates", emailTemplateRoutes);
router.use("/payment", paymentRoutes);
router.get("/channels", requireAuth, getChannels);
router.patch("/channels/setup-progress", requireAuth, updateSetupProgress);
router.get("/channels/setup-progress", requireAuth, getSetupProgress);
router.patch(
  "/channels/page-completion",
  requireAuth,
  updatePageCompletionStatus
);
router.post("/channels/reset-settings", requireAuth, resetChannelSettings);
router.get("/products", getProducts);
router.get("/widget/customer/:customerId", getCustomerData);
router.get("/widget/storefront-token", getStorefrontToken);
router.get("/widget/channel-settings", getWidgetChannelSettings);
router.get("/widget/redeem-settings", getWidgetRedeemSettings);
router.post("/widget/current-customer", verifyCurrentCustomer);
router.post("/widget/redeem", createRedeemCoupon);
router.get("/widget/my-coupons", getMyCoupons);
router.post("/widget/customer/birthday", saveCustomerBirthday);
router.post("/widget/customer/profile", saveCustomerProfile);
router.post(
  "/widget/customer/newsletter-subscribe",
  subscribeCustomerNewsletter
);
router.post("/widget/transactions", getWidgetTransactions);
router.post("/widget/refer", createReferral);
router.post("/widget/referrals", getMyReferrals);
router.get("/widget/visibility", checkWidgetVisibility);
router.patch("/widget/visibility", requireAuth, updateWidgetVisibility);
router.get("/store/plan", requireAuth, getStorePlan);
router.post("/store/downgrade-to-free", requireAuth, downgradeToFree);
router.get("/plans", async (req, res) => {
  try {
    const plans = await Plan.findAllActive();
    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
router.get("/plans/:name", async (req, res) => {
  try {
    const plan = await Plan.findByName(req.params.name);
    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }
    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
router.post("/customers/fetch", requireAuth, fetchAndStoreCustomers);
router.get("/customers", requireAuth, getCustomers);
router.get("/customers/:customerId", requireAuth, getCustomerById);
router.get(
  "/customers/:customerId/referrals",
  requireAuth,
  getCustomerReferrals
);
router.patch("/customers/:customerId/tier", requireAuth, updateCustomerTier);
router.post(
  "/customers/recalculate-tiers",
  requireAuth,
  recalculateCustomerTiers
);
router.get("/transactions", requireAuth, getTransactions);
router.get(
  "/transactions/points-awarded-stats",
  requireAuth,
  getPointsAwardedStats
);
router.get(
  "/transactions/points-redeemed-stats",
  requireAuth,
  getPointsRedeemedStats
);
router.post("/transactions", requireAuth, createTransaction);
router.post("/transactions/bulk-import", requireAuth, bulkImportPoints);
router.get(
  "/transactions/customer/:customerId",
  requireAuth,
  getCustomerTransactions
);
router.get("/transactions/:transactionId", requireAuth, getTransactionById);

module.exports = router;
