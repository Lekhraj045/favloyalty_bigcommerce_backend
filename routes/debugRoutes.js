const express = require("express");
const {
  listStores,
  seedTemplatesForAllChannels,
} = require("../controllers/debugController");

const router = express.Router();

router.get("/stores", listStores);
router.post("/seed-email-templates-all", seedTemplatesForAllChannels);

module.exports = router;
