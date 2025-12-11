const mongoose = require("mongoose");

const customPointNameSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { _id: true, timestamps: false }
);

const logoSchema = new mongoose.Schema(
  {
    id: {
      type: Number,
      default: null,
    },
    src: {
      type: String,
      default: null,
    },
    name: {
      type: String,
      default: null,
    },
  },
  { _id: false, timestamps: false }
);

const tierMetaDataSchema = new mongoose.Schema(
  {
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false, timestamps: false }
);

const tierSchema = new mongoose.Schema(
  {
    tierName: {
      type: String,
      required: true,
    },
    pointRequired: {
      type: Number,
      required: true,
      default: 0,
    },
    multiplier: {
      type: Number,
      required: true,
      default: 1,
    },
    badgeColor: {
      type: String,
      default: null,
    },
    metaData: {
      type: tierMetaDataSchema,
      default: () => ({}),
    },
  },
  { _id: true, timestamps: false }
);

const pointSchema = new mongoose.Schema(
  {
    store_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    channel_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Channel",
      required: true,
      index: true,
    },
    pointName: {
      type: String,
      required: true,
    },
    customPointName: {
      type: [customPointNameSchema],
      default: [],
    },
    expiry: {
      type: Boolean,
      default: false,
    },
    expiriesInDays: {
      type: Number,
      default: null,
    },
    tierStatus: {
      type: Boolean,
      default: false,
    },
    logo: {
      type: logoSchema,
      default: null,
    },
    customLogo: {
      type: logoSchema,
      default: null,
    },
    tier: {
      type: [tierSchema],
      default: [],
    },
    metaData: {
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
  },
  {
    timestamps: true,
  }
);

pointSchema.index({ store_id: 1, channel_id: 1 });
pointSchema.index({ store_id: 1, pointName: 1 });

const Point = mongoose.model("Point", pointSchema);

module.exports = Point;
