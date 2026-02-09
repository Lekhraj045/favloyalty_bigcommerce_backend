/**
 * Script to subscribe to BigCommerce webhooks
 *
 * Usage (with credentials on command line):
 *   node scripts/subscribeWebhook.js <store_hash> <access_token> [scope]
 *
 * Usage (with credentials in .env: STORE_HASH, ACCESS_TOKEN):
 *   node scripts/subscribeWebhook.js [scope]
 *
 * Examples:
 *   node scripts/subscribeWebhook.js abc123 xyz789 store/order/statusUpdated
 *   node scripts/subscribeWebhook.js abc123 xyz789 store/customer/created
 *   node scripts/subscribeWebhook.js store/customer/created
 *
 * Supported scopes:
 *   store/order/statusUpdated  - order status changes (default)
 *   store/customer/created     - new customer sign-up
 */

require("dotenv").config();
const axios = require("axios");

const WEBHOOK_BASE_URL =
  process.env.WEBHOOK_BASE_URL || process.env.BACKEND_URL;
const DEFAULT_SCOPE = "store/order/statusUpdated";
const SCOPES = {
  order: "store/order/statusUpdated",
  customer: "store/customer/created",
};

async function subscribeWebhook(storeHash, accessToken, scope = DEFAULT_SCOPE) {
  try {
    console.log("🔄 Subscribing to webhook...");
    console.log(`Store Hash: ${storeHash}`);
    console.log(`Scope: ${scope}`);
    console.log(`Destination: ${WEBHOOK_BASE_URL}/api/webhooks/receive`);

    if (!WEBHOOK_BASE_URL) {
      throw new Error("WEBHOOK_BASE_URL or BACKEND_URL not set in .env file");
    }

    const destination = `${WEBHOOK_BASE_URL}/api/webhooks/receive`;

    // Check if webhook already exists
    console.log("\n📋 Checking existing webhooks...");
    const existingWebhooksResponse = await axios.get(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/hooks`,
      {
        headers: {
          "X-Auth-Token": accessToken,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
    );

    const existingWebhook = existingWebhooksResponse.data.find(
      (hook) => hook.scope === scope,
    );

    if (existingWebhook) {
      console.log(`✅ Webhook already exists with ID: ${existingWebhook.id}`);
      console.log("🔄 Updating webhook...");

      // Update existing webhook
      const updateResponse = await axios.put(
        `https://api.bigcommerce.com/stores/${storeHash}/v2/hooks/${existingWebhook.id}`,
        {
          destination: destination,
          is_active: true,
        },
        {
          headers: {
            "X-Auth-Token": accessToken,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        },
      );

      console.log("✅ Webhook updated successfully!");
      console.log("\n📊 Webhook Details:");
      console.log(JSON.stringify(updateResponse.data, null, 2));
      return updateResponse.data;
    } else {
      console.log("➕ Creating new webhook...");

      // Create new webhook
      const createResponse = await axios.post(
        `https://api.bigcommerce.com/stores/${storeHash}/v2/hooks`,
        {
          scope: scope,
          destination: destination,
          is_active: true,
        },
        {
          headers: {
            "X-Auth-Token": accessToken,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        },
      );

      console.log("✅ Webhook created successfully!");
      console.log("\n📊 Webhook Details:");
      console.log(JSON.stringify(createResponse.data, null, 2));
      return createResponse.data;
    }
  } catch (error) {
    console.error("❌ Error subscribing to webhook:");
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", JSON.stringify(error.response.data, null, 2));
    } else {
      console.error("Message:", error.message);
    }
    process.exit(1);
  }
}

// Get command line arguments (support both 3-arg and 1-arg with .env credentials)
const args = process.argv.slice(2);
let storeHash = args[0];
let accessToken = args[1];
let scope = args[2] || DEFAULT_SCOPE;

// Option 2: single argument = scope, read store_hash and access_token from .env
if (
  args.length === 1 &&
  (args[0] === SCOPES.order || args[0] === SCOPES.customer)
) {
  scope = args[0];
  storeHash = process.env.STORE_HASH;
  accessToken = process.env.ACCESS_TOKEN;
  if (!storeHash || !accessToken) {
    console.error(
      "❌ When passing only scope, set STORE_HASH and ACCESS_TOKEN in .env",
    );
    console.error(
      "   Or use: node scripts/subscribeWebhook.js <store_hash> <access_token> " +
        scope,
    );
    process.exit(1);
  }
} else if (args.length === 1) {
  // One arg that's not a known scope → treat as store_hash, need access_token and scope
  console.error("❌ Missing arguments. Either:");
  console.error(
    "   node scripts/subscribeWebhook.js <store_hash> <access_token> [scope]",
  );
  console.error(
    "   node scripts/subscribeWebhook.js store/customer/created  (with STORE_HASH, ACCESS_TOKEN in .env)",
  );
  process.exit(1);
}

if (!storeHash || !accessToken) {
  console.error("❌ Missing required arguments: store_hash and access_token");
  console.error("\nUsage:");
  console.error(
    "  node scripts/subscribeWebhook.js <store_hash> <access_token> [scope]",
  );
  console.error("\nExamples:");
  console.error(
    "  node scripts/subscribeWebhook.js abc123 xyz789 store/order/statusUpdated",
  );
  console.error(
    "  node scripts/subscribeWebhook.js abc123 xyz789 store/customer/created",
  );
  console.error("\nOr set STORE_HASH and ACCESS_TOKEN in .env, then:");
  console.error("  node scripts/subscribeWebhook.js store/customer/created");
  process.exit(1);
}

// Run the subscription
subscribeWebhook(storeHash, accessToken, scope)
  .then(() => {
    console.log("\n✅ Done! Webhook is now active.");
    if (scope === SCOPES.customer) {
      console.log(
        "\n💡 To test: create a new customer on a channel storefront in BigCommerce.",
      );
    } else {
      console.log("\n💡 To test: update an order status in BigCommerce.");
    }
    console.log(
      "💡 Check the webhook logs in your database to see incoming webhooks.",
    );
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Failed to subscribe webhook:", error.message);
    process.exit(1);
  });
