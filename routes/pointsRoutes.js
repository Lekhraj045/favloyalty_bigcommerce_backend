const express = require("express");
const {
  savePoints,
  updatePoints,
  getPoints,
} = require("../controllers/pointsController");

const router = express.Router();

router.post("/", savePoints);
router.put("/:pointId", updatePoints);
router.get("/", getPoints);

module.exports = router;

