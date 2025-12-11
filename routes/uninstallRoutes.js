const express = require("express");
const { handleUninstall } = require("../controllers/uninstallController");

const router = express.Router();

router.get("/", handleUninstall);

module.exports = router;

