require("dotenv").config({ path: "../.env" });
const mongoose = require("../config/database");
const Channel = require("../models/Channel");

async function addCompletionFieldsToChannels() {
  try {
    console.log("⏳ Waiting for MongoDB connection...");
    await mongoose.connection.asPromise(); // Ensure connection is established
    console.log("✅ MongoDB Database connected successfully");

    // Find all channels that don't have the new completion fields
    const channels = await Channel.find({
      $or: [
        { pointsTierSystemCompleted: { $exists: false } },
        { waysToEarnCompleted: { $exists: false } },
        { waysToRedeemCompleted: { $exists: false } },
        { customiseWidgetCompleted: { $exists: false } },
      ],
    });

    console.log(`📊 Found ${channels.length} channel(s) that need to be updated`);

    if (channels.length === 0) {
      console.log("✅ All channels already have the completion fields. No updates needed.");
      return;
    }

    // Update all channels to add the new fields with default value false
    const updateResult = await Channel.updateMany(
      {
        $or: [
          { pointsTierSystemCompleted: { $exists: false } },
          { waysToEarnCompleted: { $exists: false } },
          { waysToRedeemCompleted: { $exists: false } },
          { customiseWidgetCompleted: { $exists: false } },
        ],
      },
      {
        $set: {
          pointsTierSystemCompleted: false,
          waysToEarnCompleted: false,
          waysToRedeemCompleted: false,
          customiseWidgetCompleted: false,
        },
      }
    );

    console.log(`✅ Successfully updated ${updateResult.modifiedCount} channel(s)`);
    console.log(`📋 Matched: ${updateResult.matchedCount} channel(s)`);
  } catch (error) {
    console.error("❌ Error adding completion fields to channels:", error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log("🔌 MongoDB connection closed.");
  }
}

addCompletionFieldsToChannels();
