const CollectSettings = require("../models/CollectSettings");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const EmailTemplate = require("../models/EmailTemplate");
const mongoose = require("mongoose");
const {
  seedEmailTemplatesForChannel,
} = require("../helpers/emailTemplateSeeder");
const queueManager = require("../queues/queueManager");
const { processEventPoints } = require("../queues/eventQueue");

// Save or update collect settings
const saveCollectSettings = async (req, res, next) => {
  try {
    const { storeId, channelId } = req.body;
    let {basic, event, referAndEarn, socialMedia, goal, rejoin, emailSetting} = req.body;

    // Validate required fields
    if (!storeId || !channelId) {
      return res.status(400).json({
        success: false,
        message: "Store ID and Channel ID are required",
      });
    }

    // Verify store and channel exist
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    const channel = await Channel.findById(channelId);
    if (!channel) {
      return res.status(404).json({
        success: false,
        message: "Channel not found",
      });
    }

    // Prepare settings data
    // only add those fields to the update object that are present in the request body
    const settingsData = {
      store_id: storeId,
      channel_id: channelId,
      ...(basic && { basic }),
      ...(event && { event }),
      ...(referAndEarn && { referAndEarn }),
      ...(socialMedia && { socialMedia }),
      ...(goal && { goal }),
      ...(rejoin && { rejoin }),
      ...(emailSetting && { emailSetting }),
    };

    // Use createOrUpdate method from the model
    const savedSettings = await CollectSettings.createOrUpdate(
      storeId,
      channelId,
      settingsData,
    );

    // Process events if they were updated
    let eventProcessingResult = null;
    if (event && savedSettings.event?.events) {
      try {
        // Ensure event.active is set to true if there are events
        if (savedSettings.event.events.length > 0 && !savedSettings.event.active) {
          savedSettings.event.active = true;
          await savedSettings.save();
        }

        const today = new Date();
        const todayDateOnly = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
        );

        let hasTodayEvents = false;
        const todayEvents = [];

        // Check each event
        for (const eventItem of savedSettings.event.events) {
          if (!eventItem.eventDate) continue;
          
          const eventDate = new Date(eventItem.eventDate);
          const eventDateOnly = new Date(
            eventDate.getFullYear(),
            eventDate.getMonth(),
            eventDate.getDate(),
          );

          // If event is for today, process it immediately
          if (
            todayDateOnly.getTime() === eventDateOnly.getTime() &&
            eventItem.status === "scheduled"
          ) {
            hasTodayEvents = true;
            todayEvents.push(eventItem);
            console.log(
              `🚀 Event "${eventItem.name}" is for today - will process immediately`,
            );
          }
          // If event is for future date, schedule it
          else if (
            eventDateOnly > todayDateOnly &&
            eventItem.status === "scheduled"
          ) {
            console.log(
              `📅 Scheduling future event "${eventItem.name}" for ${eventDateOnly.toDateString()}`,
            );
            await queueManager.addEventJob(
              {
                targetDate: eventDateOnly.toISOString(),
                triggeredBy: "scheduled",
              },
              { delay: eventDate },
            );
          }
        }

        // Process today's events immediately and wait for completion
        if (hasTodayEvents) {
          console.log(
            `⚡ Processing ${todayEvents.length} event(s) for today immediately...`,
          );
          try {
            // Process events for today's date
            eventProcessingResult = await processEventPoints(null, {
              targetDate: todayDateOnly.toISOString(),
              triggeredBy: "immediate-save",
            });
            console.log(
              "✅ Event processing completed:",
              eventProcessingResult,
            );
          } catch (processingError) {
            console.error(
              "❌ Error processing today's events:",
              processingError,
            );
            eventProcessingResult = {
              error: true,
              message: processingError.message,
            };
            // Don't fail the request, but include error in response
          }
        }
      } catch (eventError) {
        console.error("⚠️  Error handling event jobs:", eventError);
        eventProcessingResult = {
          error: true,
          message: eventError.message,
        };
        // Don't fail the request if event processing fails
      }
    }

    // Reload settings to get updated event statuses after processing
    const updatedSettings = await CollectSettings.findById(savedSettings._id);

    res.json({
      success: true,
      message: "Collect settings saved successfully",
      data: updatedSettings || savedSettings,
      eventProcessing: eventProcessingResult
        ? {
            processed: true,
            result: eventProcessingResult,
          }
        : null,
    });
  } catch (error) {
    console.error("Error saving collect settings:", error);
    next(error);
  }
};

// Get collect settings
const getCollectSettings = async (req, res, next) => {
  try {
    const { storeId, channelId } = req.query;

    if (!storeId || !channelId) {
      return res.status(400).json({success: false, message: "Store ID and Channel ID are required"});
    }

    const storeObjectId = new mongoose.Types.ObjectId(storeId);
    const channelObjectId = new mongoose.Types.ObjectId(channelId);

    // Check if email templates exist for this channel, if not, seed them
    try {
      const existingTemplates =
        await EmailTemplate.findByChannelId(channelObjectId);
      if (!existingTemplates || existingTemplates.length === 0) {
        console.log(
          `🌱 No email templates found for channel ${channelId}, auto-seeding...`,
        );
        await seedEmailTemplatesForChannel(channelObjectId);
      }
    } catch (seedError) {
      console.error(
        "⚠️ Error auto-seeding email templates:",
        seedError.message,
      );
      // Continue even if seeding fails
    }

    const settings = await CollectSettings.findByStoreAndChannel(
      storeObjectId,
      channelObjectId,
    );

    if (!settings) {
      return res.status(200).json(null);
    }

    res.json(settings);
  } catch (error) {
    console.error("Error getting collect settings:", error);
    next(error);
  }
};

module.exports = {
  saveCollectSettings,
  getCollectSettings,
};
