const EmailTemplate = require("../models/EmailTemplate");
const Channel = require("../models/Channel");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const {
  seedEmailTemplatesForChannel,
  seedEmailTemplatesForChannels,
} = require("../helpers/emailTemplateSeeder");
const {
  getRelativeImagePath,
  getAbsoluteImageUrl,
} = require("../helpers/imageUrlHelper");

// Configure multer for banner image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "../uploads/banner-images");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "banner-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const uploadBanner = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const validTypes = ["image/gif", "image/jpeg", "image/jpg", "image/png"];
    if (validTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Supported formats: GIF, JPEG, PNG"), false);
    }
  },
}).single("bannerImage");

// Get email templates for a channel
const getEmailTemplates = async (req, res, next) => {
  try {
    const { channelId } = req.query;

    if (!channelId) {
      return res.status(400).json({
        success: false,
        message: "Channel ID is required",
      });
    }

    const channelObjectId = new mongoose.Types.ObjectId(channelId);

    // Verify channel exists
    const channel = await Channel.findById(channelObjectId);
    if (!channel) {
      return res.status(404).json({
        success: false,
        message: "Channel not found",
      });
    }

    // Get templates for this channel
    let templates = await EmailTemplate.findByChannelId(channelObjectId);

    // If no templates exist, seed them automatically
    if (!templates || templates.length === 0) {
      console.log(
        `🌱 No templates found for channel ${channelId}, seeding default templates...`,
      );
      try {
        await seedEmailTemplatesForChannel(channelObjectId);
        // Fetch templates again after seeding
        templates = await EmailTemplate.findByChannelId(channelObjectId);
      } catch (seedError) {
        console.error("❌ Error auto-seeding templates:", seedError.message);
        // Continue even if seeding fails
      }
    }

    // Convert relative image URLs to absolute URLs for frontend display
    const templatesWithAbsoluteUrls = (templates || []).map((template) => {
      const templateObj = template.toObject ? template.toObject() : template;
      if (templateObj.imageUrl) {
        templateObj.imageUrl = getAbsoluteImageUrl(templateObj.imageUrl);
      }
      return templateObj;
    });

    res.json({
      success: true,
      data: templatesWithAbsoluteUrls,
      count: templatesWithAbsoluteUrls?.length || 0,
    });
  } catch (error) {
    console.error("Error getting email templates:", error);
    next(error);
  }
};

// Get a specific email template by channel and type
const getEmailTemplateByType = async (req, res, next) => {
  try {
    const { channelId, templateType } = req.query;

    if (!channelId || !templateType) {
      return res.status(400).json({
        success: false,
        message: "Channel ID and Template Type are required",
      });
    }

    const channelObjectId = new mongoose.Types.ObjectId(channelId);

    // Verify channel exists
    const channel = await Channel.findById(channelObjectId);
    if (!channel) {
      return res.status(404).json({
        success: false,
        message: "Channel not found",
      });
    }

    // Get template
    let template = await EmailTemplate.findByChannelAndType(
      channelObjectId,
      templateType,
    );

    // If template doesn't exist, seed templates and try again
    if (!template) {
      console.log(
        `🌱 Template ${templateType} not found for channel ${channelId}, seeding default templates...`,
      );
      try {
        await seedEmailTemplatesForChannel(channelObjectId);
        // Fetch template again after seeding
        template = await EmailTemplate.findByChannelAndType(
          channelObjectId,
          templateType,
        );
      } catch (seedError) {
        console.error("❌ Error auto-seeding templates:", seedError.message);
      }
    }

    if (!template) {
      return res.status(404).json({
        success: false,
        message: `Email template of type '${templateType}' not found for this channel`,
      });
    }

    // Convert relative image URL to absolute URL for frontend display
    const templateObj = template.toObject ? template.toObject() : template;
    if (templateObj.imageUrl) {
      templateObj.imageUrl = getAbsoluteImageUrl(templateObj.imageUrl);
    }

    res.json({
      success: true,
      data: templateObj,
    });
  } catch (error) {
    console.error("Error getting email template:", error);
    next(error);
  }
};

// Seed email templates for a specific channel
const seedTemplatesForChannel = async (req, res, next) => {
  try {
    const { channelId, force } = req.body;

    if (!channelId) {
      return res.status(400).json({
        success: false,
        message: "Channel ID is required",
      });
    }

    const channelObjectId = new mongoose.Types.ObjectId(channelId);

    // Verify channel exists
    const channel = await Channel.findById(channelObjectId);
    if (!channel) {
      return res.status(404).json({
        success: false,
        message: "Channel not found",
      });
    }

    // Seed templates (force=true will update existing templates)
    await seedEmailTemplatesForChannel(channelObjectId, force || false);

    // Fetch seeded templates
    const templates = await EmailTemplate.findByChannelId(channelObjectId);

    res.json({
      success: true,
      message: "Email templates seeded successfully",
      data: templates,
      count: templates?.length || 0,
    });
  } catch (error) {
    console.error("Error seeding email templates:", error);
    next(error);
  }
};

// Seed email templates for all channels in a store
const seedTemplatesForStore = async (req, res, next) => {
  try {
    const { storeId, force } = req.body;

    if (!storeId) {
      return res.status(400).json({
        success: false,
        message: "Store ID is required",
      });
    }

    const storeObjectId = new mongoose.Types.ObjectId(storeId);

    // Get all channels for this store
    const channels = await Channel.findByStoreId(storeObjectId);

    if (!channels || channels.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No channels found for this store",
      });
    }

    const channelIds = channels.map((ch) => ch._id);

    // Seed templates for all channels (with force option)
    for (const channelId of channelIds) {
      try {
        await seedEmailTemplatesForChannel(channelId, force || false);
      } catch (error) {
        console.error(
          `❌ Error seeding templates for channel ${channelId}:`,
          error.message,
        );
        // Continue with other channels
      }
    }

    // Fetch all seeded templates
    const allTemplates = [];
    for (const channelId of channelIds) {
      const templates = await EmailTemplate.findByChannelId(channelId);
      allTemplates.push({
        channelId: channelId.toString(),
        templates: templates || [],
        count: templates?.length || 0,
      });
    }

    res.json({
      success: true,
      message: `Email templates seeded successfully for ${channels.length} channel(s)`,
      data: allTemplates,
      totalChannels: channels.length,
    });
  } catch (error) {
    console.error("Error seeding email templates for store:", error);
    next(error);
  }
};

// Update email template
const updateEmailTemplate = async (req, res, next) => {
  uploadBanner(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    try {
      const { channelId, templateType } = req.body;
      let { name, heading, imageUrl, body, emailTemplate, options } = req.body;

      if (!channelId || !templateType) {
        return res.status(400).json({
          success: false,
          message: "Channel ID and Template Type are required",
        });
      }

      const channelObjectId = new mongoose.Types.ObjectId(channelId);

      // Verify channel exists
      const channel = await Channel.findById(channelObjectId);
      if (!channel) {
        return res.status(404).json({
          success: false,
          message: "Channel not found",
        });
      }

      // If a banner image file was uploaded, store relative path in database
      if (req.file) {
        // Store relative path in database (e.g., /uploads/banner-images/filename.jpg)
        imageUrl = `/uploads/banner-images/${req.file.filename}`;
        console.log(`💾 Storing relative image path in database: ${imageUrl}`);
      } else if (req.body.imageUrl) {
        // If imageUrl is provided in body, convert to relative path if it's absolute
        imageUrl = getRelativeImagePath(req.body.imageUrl);
        console.log(`💾 Storing relative image path in database: ${imageUrl}`);
      }

      // Parse JSON strings if they exist
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
      if (typeof emailTemplate === "string") {
        try {
          emailTemplate = JSON.parse(emailTemplate);
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
      if (typeof options === "string") {
        try {
          options = JSON.parse(options);
        } catch (e) {
          options = options ? [options] : [];
        }
      }

      const templateData = {
        templateType,
        name,
        heading,
        imageUrl,
        body,
        emailTemplate,
        options,
      };

      const updatedTemplate = await EmailTemplate.createOrUpdate(
        channelObjectId,
        templateData,
      );

      // Convert relative image URL to absolute URL for frontend response
      const responseTemplate = updatedTemplate.toObject
        ? updatedTemplate.toObject()
        : updatedTemplate;
      if (responseTemplate.imageUrl) {
        responseTemplate.imageUrl = getAbsoluteImageUrl(
          responseTemplate.imageUrl,
        );
      }

      res.json({
        success: true,
        message: "Email template updated successfully",
        data: responseTemplate,
      });
    } catch (error) {
      console.error("Error updating email template:", error);
      next(error);
    }
  });
};

module.exports = {
  getEmailTemplates,
  getEmailTemplateByType,
  seedTemplatesForChannel,
  seedTemplatesForStore,
  updateEmailTemplate,
};
