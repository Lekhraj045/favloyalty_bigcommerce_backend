const cors = require("cors");

const allowedOrigins = (process.env.ALLOWED_ORIGINS ||
  "https://favbigcommercefrontend.share.zrok.io")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

module.exports = cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

