const express = require("express");
const { handleAuthCallback } = require("../controllers/authController");

const router = express.Router();

router.get("/callback", handleAuthCallback);

module.exports = router;

