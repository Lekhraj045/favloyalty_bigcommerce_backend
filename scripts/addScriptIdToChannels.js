require("dotenv").config({ path: "../.env" });
const mongoose = require("../config/database");
const Channel = require("../models/Channel");

async function addScriptIdToChannels() {
  try {
    console.log("⏳ Waiting for MongoDB connection...");
    await mongoose.connection.asPromise();
    console.log("✅ MongoDB Database connected successfully");

    // Find all channels that don't have script_id field
    const channels = await Channel.find({
      script_id: { $exists: false },
    });

    console.log(`📊 Found ${channels.length} channel(s) missing script_id`);

    if (channels.length === 0) {
      console.log("✅ All channels already have script_id. No updates needed.");
      return;
    }

    // Default to null (empty) for existing channels
    const updateResult = await Channel.updateMany(
      { script_id: { $exists: false } },
      { $set: { script_id: null } },
    );

    console.log(
      `✅ Successfully updated ${updateResult.modifiedCount} channel(s)`,
    );
    console.log(`📋 Matched: ${updateResult.matchedCount} channel(s)`);
  } catch (error) {
    console.error("❌ Error adding script_id to channels:", error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log("🔌 MongoDB connection closed.");
  }
}

addScriptIdToChannels();
