/**
 * Migration Script: Create Free Subscriptions for Existing Stores
 * 
 * This script creates free subscriptions for all existing active stores
 * that don't already have an active subscription.
 * 
 * Run with: node scripts/createFreeSubscriptionsForStores.js
 */

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

const createFreeSubscriptionsForStores = async () => {
  try {
    // Import models
    const Store = require("../models/Store");
    const Plan = require("../models/Plan");
    const Subscription = require("../models/Subscription");

    // Find the free plan
    const freePlan = await Plan.findByName("free");
    if (!freePlan) {
      console.error("❌ Free plan not found! Please seed plans first.");
      console.log("   Run: node scripts/seedPlansFromJson.js");
      process.exit(1);
    }

    console.log(`📋 Free plan found: ${freePlan.name} (order limit: ${freePlan.orderLimit})`);

    // Find all active stores
    const stores = await Store.find({ is_active: true });
    console.log(`📊 Found ${stores.length} active stores to check`);

    let createdCount = 0;
    let skippedCount = 0;
    let alreadyHasPaidCount = 0;

    for (const store of stores) {
      // Check if store already has an active subscription
      const existingSubscription = await Subscription.findActiveByStore(store._id);

      if (existingSubscription) {
        // Check if it's a paid subscription
        const isPaidSubscription = existingSubscription.plan_id?.name === "pro" || 
                                   existingSubscription.plan_id?.name === "enterprise" ||
                                   store.plan === "paid";
        
        if (isPaidSubscription) {
          console.log(`💳 Store ${store.store_hash} already has a paid subscription - skipping`);
          alreadyHasPaidCount++;
        } else {
          console.log(`⏭️  Store ${store.store_hash} already has a free subscription - skipping`);
          skippedCount++;
        }
        continue;
      }

      // Create free subscription for this store
      const freeSubscription = new Subscription({
        store_id: store._id,
        plan_id: freePlan._id,
        status: "active",
        orderCount: 0, // Start fresh (could also count existing orders)
        selectedOrderLimit: freePlan.orderLimit, // 300 for free plan
        limitReached: false,
        limitReachedAt: null,
        basePrice: 0,
        currentPrice: 0,
      });

      await freeSubscription.save();
      createdCount++;
      console.log(`✅ Created free subscription for store: ${store.store_hash} (ID: ${store._id})`);
    }

    console.log("\n========================================");
    console.log("📊 Migration Summary:");
    console.log(`   ✅ Created free subscriptions: ${createdCount}`);
    console.log(`   💳 Already have paid subscription: ${alreadyHasPaidCount}`);
    console.log(`   ⏭️  Already have free subscription: ${skippedCount}`);
    console.log(`   📦 Total stores checked: ${stores.length}`);
    console.log("========================================");

    process.exit(0);
  } catch (error) {
    console.error("❌ Error creating free subscriptions:", error.message);
    console.error(error);
    process.exit(1);
  }
};

// Run the migration
(async () => {
  await connectDB();
  await createFreeSubscriptionsForStores();
  await mongoose.connection.close();
})();
