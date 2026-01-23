const Store = require("../models/Store");
const { requireAuth } = require("../helpers/bigcommerce");

/**
 * Get store plan information
 */
const getStorePlan = async (req, res) => {
  try {
    const store = req.store; // From requireAuth middleware

    res.json({
      success: true,
      data: {
        plan: store.plan || "free",
        trialDaysRemaining: store.trialDaysRemaining,
        paypalSubscriptionId: store.paypalSubscriptionId,
      },
    });
  } catch (error) {
    console.error("❌ Error getting store plan:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to get store plan",
      error: error.message,
    });
  }
};

module.exports = {
  getStorePlan,
};
