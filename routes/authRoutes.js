const express = require("express");
const {
  handleAuthCallback,
  refreshToken,
} = require("../controllers/authController");

const router = express.Router();

router.get("/callback", handleAuthCallback);
router.post("/refresh-token", refreshToken);

module.exports = router;
