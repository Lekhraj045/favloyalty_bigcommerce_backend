const cors = require("cors");

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  "https://favbigcommercefrontend.share.zrok.io,https://favloyaltybigcommercewidget.share.zrok.io,https://favbigcommerce.share.zrok.io,http://localhost:3000,http://localhost:3001"
)
  .split(",")
  .map((origin) => origin.trim().toLowerCase())
  .filter(Boolean);

// BigCommerce storefront origins (case-insensitive): https://anything.mybigcommerce.com
const bcStoreOriginRegex = /^https:\/\/[a-zA-Z0-9.-]+\.mybigcommerce\.com$/i;
// Widget/backend zrok and localhost
const widgetOriginRegex =
  /^https?:\/\/([a-zA-Z0-9.-]+\.)?(share\.zrok\.io|localhost)(:\d+)?$/i;

function isAllowedOrigin(origin) {
  if (!origin || typeof origin !== "string") return true;
  const o = origin.trim();
  if (allowedOrigins.indexOf(o.toLowerCase()) !== -1) return true;
  if (bcStoreOriginRegex.test(o)) return true;
  if (widgetOriginRegex.test(o)) return true;
  return false;
}

module.exports = cors({
  origin: function (origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "X-Requested-With",
    "X-CSRF-Token",
    "Request-Verification-Token",
  ],
  exposedHeaders: ["Content-Type", "Authorization"],
});
