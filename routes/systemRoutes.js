const express = require("express");
const { getRoot, getHealth } = require("../controllers/systemController");

const router = express.Router();

router.get("/", getRoot);
router.get("/health", getHealth);

module.exports = router;

