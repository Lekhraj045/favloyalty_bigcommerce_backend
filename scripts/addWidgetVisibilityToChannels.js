require("dotenv").config({ path: "../.env" });
const mongoose = require("../config/database");
const Channel = require("../models/Channel");

async function addWidgetVisibilityToChannels() {
  try {
    console.log("⏳ Waiting for MongoDB connection...");
    await mongoose.connection.asPromise();
    console.log("✅ MongoDB Database connected successfully");

    // Find all channels that don't have widget_visibility field
    const channels = await Channel.find({
      widget_visibility: { $exists: false },
    });

    console.log(
      `📊 Found ${channels.length} channel(s) missing widget_visibility`,
    );

    if (channels.length === 0) {
      console.log(
        "✅ All channels already have widget_visibility. No updates needed.",
      );
      return;
    }

    // Default to true (visible) for existing channels
    const updateResult = await Channel.updateMany(
      { widget_visibility: { $exists: false } },
      { $set: { widget_visibility: true } },
    );

    console.log(
      `✅ Successfully updated ${updateResult.modifiedCount} channel(s)`,
    );
    console.log(`📋 Matched: ${updateResult.matchedCount} channel(s)`);
  } catch (error) {
    console.error("❌ Error adding widget_visibility to channels:", error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log("🔌 MongoDB connection closed.");
  }
}

addWidgetVisibilityToChannels();
