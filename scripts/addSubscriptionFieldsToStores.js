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

const addSubscriptionFieldsToStores = async () => {
  try {
    // Import Store model
    const Store = require("../models/Store");

    // Find ALL stores
    const stores = await Store.find({});

    console.log(`📊 Found ${stores.length} stores to check/update`);

    let updatedCount = 0;

    for (const store of stores) {
      const updateData = {};
      const fieldsToAdd = [];

      // Check and set plan if missing or invalid
      if (!store.plan || (store.plan !== "free" && store.plan !== "paid")) {
        updateData.plan = "free";
        fieldsToAdd.push("plan");
      }

      // Check and set trialDaysRemaining if missing (default to null for new stores)
      if (store.trialDaysRemaining === undefined) {
        updateData.trialDaysRemaining = null;
        fieldsToAdd.push("trialDaysRemaining");
      }

      // Check and set paypalSubscriptionId if missing
      if (store.paypalSubscriptionId === undefined) {
        updateData.paypalSubscriptionId = null;
        fieldsToAdd.push("paypalSubscriptionId");
      }

      if (Object.keys(updateData).length > 0) {
        await Store.updateOne({ _id: store._id }, { $set: updateData });
        updatedCount++;
        console.log(
          `✅ Updated store: ${store.store_hash} - Added/Updated fields: ${fieldsToAdd.join(", ")}`
        );
        console.log(`   Values:`, updateData);
      } else {
        console.log(
          `ℹ️  Store ${store.store_hash} already has all subscription fields`
        );
      }
    }

    console.log(`\n✅ Migration completed: ${updatedCount} stores updated`);
    process.exit(0);
  } catch (error) {
    console.error("❌ Error migrating stores:", error.message);
    console.error(error);
    process.exit(1);
  }
};

// Run the migration
(async () => {
  await connectDB();
  await addSubscriptionFieldsToStores();
  await mongoose.connection.close();
})();
