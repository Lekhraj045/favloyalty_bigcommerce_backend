const Store = require("../models/Store");
const Channel = require("../models/Channel");
const EmailTemplate = require("../models/EmailTemplate");
const {
  seedEmailTemplatesForChannel,
} = require("../helpers/emailTemplateSeeder");

const listStores = async (req, res) => {
  try {
    const stores = await Store.findAll();

    res.json({
      totalStores: stores.length,
      stores: stores.map((store) => ({
        storeHash: store.store_hash,
        userEmail: store.user_email,
        installedAt: store.installed_at,
        updatedAt: store.updated_at,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Migration endpoint: Seed email templates for all existing channels
const seedTemplatesForAllChannels = async (req, res) => {
  try {
    const force = req.body?.force || req.query?.force === 'true' || false;
    console.log(`🚀 Starting email template seeding for all existing channels... (force: ${force})`);

    // Get all channels
    const channels = await Channel.find({});
    console.log(`📋 Found ${channels.length} channels to process`);

    if (channels.length === 0) {
      return res.json({
        success: true,
        message: "No channels found. Nothing to seed.",
        totalChannels: 0,
      });
    }

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    const errors = [];

    // Seed templates for each channel
    for (const channel of channels) {
      try {
        const existingTemplates = await EmailTemplate.findByChannelId(
          channel._id
        );

        if (existingTemplates && existingTemplates.length > 0 && !force) {
          console.log(
            `⏭️  Skipping channel ${channel._id} (${channel.channel_name || channel.channel_id}) - templates already exist`
          );
          skipCount++;
          continue;
        }

        if (force && existingTemplates && existingTemplates.length > 0) {
          console.log(
            `🔄 Force updating templates for channel ${channel._id} (${channel.channel_name || channel.channel_id})...`
          );
        } else {
          console.log(
            `🌱 Seeding templates for channel ${channel._id} (${channel.channel_name || channel.channel_id})...`
          );
        }
        
        await seedEmailTemplatesForChannel(channel._id, force);
        successCount++;
        console.log(`✅ Successfully ${force ? 'updated' : 'seeded'} templates for channel ${channel._id}`);
      } catch (error) {
        console.error(
          `❌ Error seeding templates for channel ${channel._id}:`,
          error.message
        );
        errorCount++;
        errors.push({
          channelId: channel._id.toString(),
          channelName: channel.channel_name || channel.channel_id,
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      message: "Email template seeding completed",
      summary: {
        totalChannels: channels.length,
        successfullySeeded: successCount,
        skipped: skipCount,
        errors: errorCount,
      },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("❌ Fatal error in migration:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

module.exports = {
  listStores,
  seedTemplatesForAllChannels,
};
