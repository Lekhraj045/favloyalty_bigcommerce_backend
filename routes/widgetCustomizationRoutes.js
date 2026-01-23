const express = require("express");
const {
  getWidgetCustomization,
  createOrUpdateWidgetCustomization,
  updateWidgetCustomization,
  deleteWidgetCustomization,
} = require("../controllers/widgetCustomizationController");

const router = express.Router();

router.get("/", getWidgetCustomization);
router.post("/", createOrUpdateWidgetCustomization);
router.put("/", updateWidgetCustomization);
router.delete("/", deleteWidgetCustomization);

module.exports = router;

