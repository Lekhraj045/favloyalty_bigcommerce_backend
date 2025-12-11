const express = require("express");
const { listStores } = require("../controllers/debugController");

const router = express.Router();

router.get("/stores", listStores);

module.exports = router;
