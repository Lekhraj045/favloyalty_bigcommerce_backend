const mongoose = require("mongoose");

// Point Settings Schema
const pointSettingsSchema = new mongoose.Schema(
  {
    customLogoUpload: {
      type: Boolean,
      default: false,
    },
    pointsExpiry: {
      type: Boolean,
      default: false,
    },
    availableLogos: {
      type: Number,
      default: 0,
    },
    tierSystem: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

// Design Settings Schema
const designSettingsSchema = new mongoose.Schema(
  {
    patterns: {
      type: Boolean,
      default: false,
    },
    bubbleLogos: {
      type: Number,
      default: 0,
    },
    announcements: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

// Features Schema
const featuresSchema = new mongoose.Schema(
  {
    pointSettings: {
      type: pointSettingsSchema,
      default: () => ({}),
    },
    earnMethods: {
      type: [String],
      default: [],
    },
    redeemMethods: {
      type: [String],
      default: [],
    },
    designSettings: {
      type: designSettingsSchema,
      default: () => ({}),
    },
  },
  { _id: false }
);

const planSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      enum: ["free", "pro", "enterprise"],
      index: true,
    },
    features: {
      type: featuresSchema,
      default: () => ({}),
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    orderLimit: {
      type: Number,
      required: true,
      default: 0,
    },
    overageBatchSize: {
      type: Number,
      default: 0,
    },
    overageCharge: {
      type: Number,
      default: 0,
    },
    price: {
      type: Number,
      required: true,
      default: 0,
    },
    pricePerOrder: {
      type: Number,
      default: 0,
    },
    trialDays: {
      type: Number,
      default: 0,
    },
    yearlyDiscountPercentage: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Static method to seed default plans
planSchema.statics.seedDefaultPlans = async function () {
  const defaultPlans = [
    {
      name: "free",
      features: {
        pointSettings: {
          customLogoUpload: false,
          pointsExpiry: false,
          availableLogos: 3,
          tierSystem: false,
        },
        earnMethods: ["signup", "purchase"],
        redeemMethods: ["fixed"],
        designSettings: {
          patterns: false,
          bubbleLogos: 1,
          announcements: 1,
        },
      },
      isActive: true,
      orderLimit: 300,
      overageBatchSize: 0,
      overageCharge: 0,
      price: 0,
      pricePerOrder: 0,
      trialDays: 0,
      yearlyDiscountPercentage: 0,
    },
    {
      name: "pro",
      features: {
        pointSettings: {
          customLogoUpload: true,
          pointsExpiry: true,
          availableLogos: 10,
          tierSystem: true,
        },
        earnMethods: [
          "signup",
          "purchase",
          "refer",
          "newsletter",
          "profile",
          "birthday",
          "events",
          "rejoin",
        ],
        redeemMethods: ["fixed", "percentage", "shipping", "product"],
        designSettings: {
          patterns: true,
          bubbleLogos: 10,
          announcements: 10,
        },
      },
      isActive: true,
      orderLimit: 750,
      overageBatchSize: 100,
      overageCharge: 5,
      price: 20,
      pricePerOrder: 0.02,
      trialDays: 14,
      yearlyDiscountPercentage: 20,
    },
    {
      name: "enterprise",
      features: {
        pointSettings: {
          customLogoUpload: true,
          pointsExpiry: true,
          availableLogos: 999,
          tierSystem: true,
        },
        earnMethods: [
          "signup",
          "purchase",
          "refer",
          "newsletter",
          "profile",
          "birthday",
          "events",
          "rejoin",
        ],
        redeemMethods: ["fixed", "percentage", "shipping", "product"],
        designSettings: {
          patterns: true,
          bubbleLogos: 999,
          announcements: 999,
        },
      },
      isActive: true,
      orderLimit: 999999,
      overageBatchSize: 0,
      overageCharge: 0,
      price: 0,
      pricePerOrder: 0,
      trialDays: 0,
      yearlyDiscountPercentage: 0,
    },
  ];

  try {
    for (const planData of defaultPlans) {
      await this.findOneAndUpdate({ name: planData.name }, planData, {
        upsert: true,
        new: true,
        runValidators: true,
      });
    }
    console.log("✅ Default plans seeded successfully");
    return true;
  } catch (error) {
    console.error("❌ Error seeding default plans:", error.message);
    throw error;
  }
};

// Static method to find plan by name
planSchema.statics.findByName = async function (planName) {
  try {
    const plan = await this.findOne({ name: planName, isActive: true });
    return plan;
  } catch (error) {
    console.error("❌ Error finding plan:", error.message);
    throw error;
  }
};

// Static method to get all active plans
planSchema.statics.findAllActive = async function () {
  try {
    return await this.find({ isActive: true }).sort({ price: 1 });
  } catch (error) {
    console.error("❌ Error getting active plans:", error.message);
    throw error;
  }
};

// Static method to update plan
planSchema.statics.updatePlan = async function (planId, updateData) {
  try {
    const plan = await this.findByIdAndUpdate(
      planId,
      { $set: updateData },
      { new: true, runValidators: true }
    );
    if (!plan) {
      throw new Error("Plan not found");
    }
    return plan;
  } catch (error) {
    console.error("❌ Error updating plan:", error.message);
    throw error;
  }
};

const Plan = mongoose.model("Plan", planSchema);

module.exports = Plan;
