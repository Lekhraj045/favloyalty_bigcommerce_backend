const express = require("express");
const { handleLoad } = require("../controllers/loadController");

const router = express.Router();

router.get("/", handleLoad);

module.exports = router;

