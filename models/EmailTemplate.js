const mongoose = require("mongoose");

const emailTemplateSchema = new mongoose.Schema({
  channel_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "Channel",
    index: true,
  },
  templateType: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  heading: {
    type: String,
    default: "",
  },
  imageUrl: {
    type: String,
    default: "",
  },
  body: {
    type: String,
    default: "",
  },
  emailTemplate: {
    type: String,
    default: "",
  },
  options: [
    {
      type: String,
    },
  ],
  metaData: {
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
});

// Index for efficient queries
emailTemplateSchema.index({ channel_id: 1, templateType: 1 });

// Update the updatedAt timestamp before saving
emailTemplateSchema.pre("save", function (next) {
  if (this.isModified() && !this.isNew) {
    this.metaData.updatedAt = new Date();
  }
  next();
});

// Static method to find templates by channel
emailTemplateSchema.statics.findByChannelId = async function (channelId) {
  const channelObjectId =
    typeof channelId === "string"
      ? new mongoose.Types.ObjectId(channelId)
      : channelId;

  return await this.find({ channel_id: channelObjectId });
};

// Static method to find template by channel and type
emailTemplateSchema.statics.findByChannelAndType = async function (
  channelId,
  templateType
) {
  const channelObjectId =
    typeof channelId === "string"
      ? new mongoose.Types.ObjectId(channelId)
      : channelId;

  return await this.findOne({
    channel_id: channelObjectId,
    templateType: templateType,
  });
};

// Static method to create or update template
emailTemplateSchema.statics.createOrUpdate = async function (
  channelId,
  templateData
) {
  const channelObjectId =
    typeof channelId === "string"
      ? new mongoose.Types.ObjectId(channelId)
      : channelId;

  const { templateType, name, heading, imageUrl, body, emailTemplate, options } =
    templateData;

  return await this.findOneAndUpdate(
    {
      channel_id: channelObjectId,
      templateType: templateType,
    },
    {
      $set: {
        name: name,
        heading: heading || "",
        imageUrl: imageUrl || "",
        body: body || "",
        emailTemplate: emailTemplate || "",
        options: options || [],
        "metaData.updatedAt": new Date(),
      },
      $setOnInsert: {
        "metaData.createdAt": new Date(),
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
    }
  );
};

const EmailTemplate = mongoose.model("EmailTemplate", emailTemplateSchema);

module.exports = EmailTemplate;
