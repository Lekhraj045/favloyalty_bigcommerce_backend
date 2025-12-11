const express = require("express");
const { login } = require("../controllers/authController");
const pointsRoutes = require("./pointsRoutes");

const router = express.Router();

router.post("/login", login);
router.use("/points", pointsRoutes);

module.exports = router;

