const express = require("express");
const { login } = require("../controllers/authController");
const { requireAuth } = require("../helpers/bigcommerce");
const pointsRoutes = require("./pointsRoutes");
const collectSettingsRoutes = require("./collectSettingsRoutes");
const redeemSettingsRoutes = require("./redeemSettingsRoutes");
const widgetCustomizationRoutes = require("./widgetCustomizationRoutes");
const emailTemplateRoutes = require("./emailTemplateRoutes");
const {
  getChannels,
  updateSetupProgress,
  getSetupProgress,
  updatePageCompletionStatus,
} = require("../controllers/channelController");
const { getProducts } = require("../controllers/productsController");
const {
  checkWidgetVisibility,
  getCustomerData,
} = require("../controllers/widgetController");
const { getStorePlan } = require("../controllers/storeController");
const {
  fetchAndStoreCustomers,
  getCustomers,
  getCustomerById,
  recalculateCustomerTiers,
} = require("../controllers/customerController");
const {
  getTransactions,
  getTransactionById,
  createTransaction,
  getCustomerTransactions,
  bulkImportPoints,
  getPointsAwardedStats,
} = require("../controllers/transactionController");

const router = express.Router();

router.post("/login", login);
router.use("/points", pointsRoutes);
router.use("/collect-settings", collectSettingsRoutes);
router.use("/redeem-settings", redeemSettingsRoutes);
router.use("/widget-customization", widgetCustomizationRoutes);
router.use("/email-templates", emailTemplateRoutes);
router.get("/channels", requireAuth, getChannels);
router.patch("/channels/setup-progress", requireAuth, updateSetupProgress);
router.get("/channels/setup-progress", requireAuth, getSetupProgress);
router.patch(
  "/channels/page-completion",
  requireAuth,
  updatePageCompletionStatus
);
router.get("/products", getProducts);
router.get("/widget/customer/:customerId", getCustomerData);
router.get("/widget/visibility", checkWidgetVisibility);
router.get("/store/plan", requireAuth, getStorePlan);
router.post("/customers/fetch", requireAuth, fetchAndStoreCustomers);
router.get("/customers", requireAuth, getCustomers);
router.get("/customers/:customerId", requireAuth, getCustomerById);
router.post("/customers/recalculate-tiers", requireAuth, recalculateCustomerTiers);
router.get("/transactions", requireAuth, getTransactions);
router.get("/transactions/points-awarded-stats", requireAuth, getPointsAwardedStats);
router.get("/transactions/customer/:customerId", requireAuth, getCustomerTransactions);
router.post("/transactions/bulk-import", requireAuth, bulkImportPoints);
router.post("/transactions", requireAuth, createTransaction);
router.get("/transactions/:transactionId", requireAuth, getTransactionById);

module.exports = router;
