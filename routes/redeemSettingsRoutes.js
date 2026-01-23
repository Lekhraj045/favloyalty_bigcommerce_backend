const express = require("express");
const {
  getRedeemSettings,
  createRedeemCoupon,
  updateRedeemCoupon,
  toggleCouponStatus,
  deleteRedeemCoupon,
} = require("../controllers/redeemSettingsController");

const router = express.Router();

router.get("/", getRedeemSettings);
router.post("/", createRedeemCoupon);
router.put("/", updateRedeemCoupon);
router.patch("/toggle-status", toggleCouponStatus);
router.delete("/", deleteRedeemCoupon);

module.exports = router;

