const mongoose = require("mongoose");
require("dotenv").config();

// Import database config to establish connection
const connectDB = async () => {
  const {
    DB_HOST = "localhost",
    DB_PORT = 27017,
    DB_USER,
    DB_PASSWORD,
    DB_NAME = "bigcommerce_app",
    MONGODB_URI,
  } = process.env;

  let connectionString;
  if (MONGODB_URI) {
    connectionString = MONGODB_URI;
  } else {
    connectionString = "mongodb://";
    if (DB_USER && DB_PASSWORD) {
      connectionString += `${DB_USER}:${DB_PASSWORD}@`;
    }
    connectionString += `${DB_HOST}:${DB_PORT}/${DB_NAME}`;
  }

  try {
    await mongoose.connect(connectionString);
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

const verifyStoreFields = async () => {
  try {
    // Import Store model
    const Store = require("../models/Store");

    // Find ALL stores
    const stores = await Store.find({});

    console.log(`\n📊 Found ${stores.length} stores:\n`);

    for (const store of stores) {
      console.log(`Store: ${store.store_hash}`);
      console.log(`  - plan: ${store.plan} (exists: ${store.plan !== undefined})`);
      console.log(
        `  - trialDaysRemaining: ${store.trialDaysRemaining} (exists: ${store.trialDaysRemaining !== undefined})`
      );
      console.log(
        `  - paypalSubscriptionId: ${store.paypalSubscriptionId} (exists: ${store.paypalSubscriptionId !== undefined})`
      );
      console.log(`  - All fields:`, Object.keys(store.toObject()));
      console.log("");
    }

    // Force update all stores to ensure fields exist
    console.log("\n🔄 Force updating all stores to ensure fields are set...\n");

    const result = await Store.updateMany(
      {},
      {
        $set: {
          plan: "free",
          trialDaysRemaining: null,
          paypalSubscriptionId: null,
        },
      },
      { upsert: false }
    );

    console.log(`✅ Updated ${result.modifiedCount} stores`);
    console.log(`✅ Matched ${result.matchedCount} stores`);

    // Verify again
    console.log("\n📊 Verification after update:\n");
    const updatedStores = await Store.find({});
    for (const store of updatedStores) {
      console.log(`Store: ${store.store_hash}`);
      console.log(`  - plan: ${store.plan}`);
      console.log(`  - trialDaysRemaining: ${store.trialDaysRemaining}`);
      console.log(`  - paypalSubscriptionId: ${store.paypalSubscriptionId}`);
      console.log("");
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Error verifying stores:", error.message);
    console.error(error);
    process.exit(1);
  }
};

// Run the verification
(async () => {
  await connectDB();
  await verifyStoreFields();
  await mongoose.connection.close();
})();
