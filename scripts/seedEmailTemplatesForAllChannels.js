/**
 * Migration script to seed email templates for all existing channels
 * Run this script to populate email templates for existing users
 * 
 * Usage: node scripts/seedEmailTemplatesForAllChannels.js
 */

require("dotenv").config();
const mongoose = require("../config/database");
const Channel = require("../models/Channel");
const {
  seedEmailTemplatesForChannel,
} = require("../helpers/emailTemplateSeeder");

const seedTemplatesForAllChannels = async () => {
  try {
    console.log("🚀 Starting email template seeding for all existing channels...");

    // Wait for database connection
    await new Promise((resolve) => {
      if (mongoose.connection.readyState === 1) {
        resolve();
      } else {
        mongoose.connection.once("connected", resolve);
      }
    });

    // Get all channels
    const channels = await Channel.find({});
    console.log(`📋 Found ${channels.length} channels to process`);

    if (channels.length === 0) {
      console.log("ℹ️ No channels found. Nothing to seed.");
      process.exit(0);
    }

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    // Seed templates for each channel
    for (const channel of channels) {
      try {
        const existingTemplates = await require("../models/EmailTemplate").findByChannelId(
          channel._id
        );

        if (existingTemplates && existingTemplates.length > 0) {
          console.log(
            `⏭️  Skipping channel ${channel._id} (${channel.channel_name || channel.channel_id}) - templates already exist`
          );
          skipCount++;
          continue;
        }

        console.log(
          `🌱 Seeding templates for channel ${channel._id} (${channel.channel_name || channel.channel_id})...`
        );
        await seedEmailTemplatesForChannel(channel._id);
        successCount++;
        console.log(`✅ Successfully seeded templates for channel ${channel._id}`);
      } catch (error) {
        console.error(
          `❌ Error seeding templates for channel ${channel._id}:`,
          error.message
        );
        errorCount++;
      }
    }

    console.log("\n📊 Seeding Summary:");
    console.log(`   ✅ Successfully seeded: ${successCount}`);
    console.log(`   ⏭️  Skipped (already exist): ${skipCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📦 Total channels: ${channels.length}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  }
};

// Run the migration
seedTemplatesForAllChannels();
