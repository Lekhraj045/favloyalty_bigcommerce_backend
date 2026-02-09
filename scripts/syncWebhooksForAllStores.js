/**
 * Check webhook status for all stores in the database and subscribe them if needed.
 *
 * - Reads all active stores from the stores table
 * - For each store, fetches current webhooks from BigCommerce
 * - Reports which scopes are subscribed (store/order/statusUpdated, store/customer/created)
 * - Subscribes any missing webhooks so all stores have our webhooks
 *
 * Usage: node scripts/syncWebhooksForAllStores.js
 *
 * Requires in .env:
 *   - WEBHOOK_BASE_URL or BACKEND_URL (public HTTPS URL for /api/webhooks/receive)
 *   - MongoDB connection (DB_* or MONGODB_URI)
 */

require("dotenv").config();
const mongoose = require("../config/database");
const Store = require("../models/Store");
const {
  getWebhooks,
  createOrUpdateWebhook,
} = require("../services/bigcommerceWebhookService");

const WEBHOOK_SCOPES = [
  "store/order/statusUpdated",
  "store/customer/created",
];

async function syncWebhooksForAllStores() {
  try {
    console.log("🔄 Waiting for database connection...");
    await new Promise((resolve) => {
      if (mongoose.connection.readyState === 1) {
        resolve();
      } else {
        mongoose.connection.once("connected", resolve);
      }
    });

    const baseUrl = process.env.BACKEND_URL || process.env.WEBHOOK_BASE_URL;
    if (!baseUrl) {
      console.error(
        "❌ WEBHOOK_BASE_URL or BACKEND_URL not set in .env. Set a public HTTPS URL."
      );
      process.exit(1);
    }
    const destination = `${baseUrl}/api/webhooks/receive`;
    console.log(`📡 Webhook destination: ${destination}\n`);

    const stores = await Store.findAll();
    console.log(`📋 Found ${stores.length} active store(s) in database.\n`);

    if (stores.length === 0) {
      console.log("ℹ️ No active stores. Nothing to sync.");
      process.exit(0);
    }

    for (const store of stores) {
      const storeHash = store.store_hash;
      const email = store.email || "(no email)";
      console.log("─".repeat(50));
      console.log(`Store: ${storeHash}  |  ${email}`);

      let currentWebhooks = [];
      try {
        currentWebhooks = await getWebhooks(storeHash, store.access_token);
      } catch (err) {
        console.error(`   ❌ Failed to fetch webhooks: ${err.message}`);
        continue;
      }

      const subscribedScopes = currentWebhooks.map((h) => h.scope);
      const ourScopes = WEBHOOK_SCOPES.filter((s) => subscribedScopes.includes(s));
      const missingScopes = WEBHOOK_SCOPES.filter((s) => !subscribedScopes.includes(s));

      console.log(`   Current webhooks (BigCommerce): ${subscribedScopes.length}`);
      subscribedScopes.forEach((s) => console.log(`      - ${s}`));
      console.log(`   Our scopes subscribed: ${ourScopes.length}/${WEBHOOK_SCOPES.length}`);
      if (missingScopes.length) {
        console.log(`   Missing: ${missingScopes.join(", ")} → subscribing...`);
      } else {
        console.log(`   ✅ All our webhooks already subscribed.`);
      }

      for (const scope of WEBHOOK_SCOPES) {
        try {
          await createOrUpdateWebhook(
            storeHash,
            store.access_token,
            scope,
            destination
          );
          console.log(`   ✅ Subscribed: ${scope}`);
        } catch (err) {
          console.error(`   ❌ Failed to subscribe ${scope}: ${err.message}`);
        }
      }
      console.log("");
    }

    console.log("─".repeat(50));
    console.log("✅ Done. All stores have been checked and subscribed to webhooks.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Script error:", err.message);
    process.exit(1);
  }
}

syncWebhooksForAllStores();
