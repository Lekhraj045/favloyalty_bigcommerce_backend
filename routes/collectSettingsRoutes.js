const express = require("express");
const {
  saveCollectSettings,
  getCollectSettings,
} = require("../controllers/collectSettingsController");

const router = express.Router();

router.post("/", saveCollectSettings);
router.get("/", getCollectSettings);

module.exports = router;
