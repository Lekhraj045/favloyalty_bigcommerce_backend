const mongoose = require("mongoose");
const ObjectID = mongoose.Types.ObjectId;
const Store = require("./Store");
const Channel = require("./Channel");

const redeemSchema = new mongoose.Schema({
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
  redeemType: {
    type: String,
    enum: [
      "purchase",
      "freeShipping",
      "freeProduct",
      "storeCredit",
      "orderPoint",
    ],
  },
  coupon: {
    active: Boolean,
    price_rule_id: String,
    target_type: String,
    name: String,
    lowerCaseName: String,
    value: Number, //point wise
    discountAmount: Number, // in $
    expire: {
      type: String,
      required: false, // Make expire optional
      default: null,
    },
    hasExpiry: {
      type: Boolean,
      default: false, // Track whether this coupon has expiry enabled
    },
    restriction: {
      status: Boolean,
      maxReduption: {
        status: Boolean,
        value: Number,
      },
      selectedCustomber: {
        status: Boolean,
        tier: [
          {
            status: Boolean,
            name: String,
            tierId: mongoose.Schema.ObjectId,
            tierIndex: Number,
          },
        ],
        tag: [
          {
            status: Boolean,
            name: String,
            tagId: mongoose.Schema.ObjectId,
          },
        ],
      },
      selectedItems: {
        status: Boolean, // Separate status for products
        items: [
          {
            types: String,
            value: String,
            imgUrl: String,
            pointRequired: String,
            itemUrl: String,
            ids: String,
            price: String,
            variantId: String,
            productId: String,
          },
        ],
      },
      selectedCollections: {
        status: Boolean, // Separate status for collections
        collections: [
          {
            value: String,
            imgUrl: String,
            collectionUrl: String,
            ids: String,
            pointRequired: String,
          },
        ],
      },
      minimumPurchaseAmount: {
        status: {
          type: Boolean,
          default: false,
        },
        value: Number,
      },
      createdAt: {
        type: Date,
        default: new Date(),
      },
      updatedAt: Date,
    },
    createdAt: {
      type: Date,
      default: new Date(),
    },
    updatedAt: Date,
  },
  OrderFromPoint: {
    status: Boolean,
    pointValue: Number,
    amount: Number,
    currencyCode: String,
    createdAt: {
      type: Date,
    },
    updatedAt: Date,
  },
  createdAt: {
    type: Date,
    default: new Date(),
  },
  updatedAt: Date,
});

// Indexes
redeemSchema.index({ store_id: 1, channel_id: 1 });
redeemSchema.index({ store_id: 1 });
redeemSchema.index({ channel_id: 1 });

redeemSchema.get("strict");

redeemSchema.statics.addCoupon = async function (data) {
  try {
    const redeems = new this();
    redeems.store_id = new ObjectID(data.store_id);
    redeems.channel_id = new ObjectID(data.channel_id);
    redeems.redeemType = data.redeemType;

    // Handle orderPoint specific fields
    if (data.redeemType === "orderPoint") {
      redeems.OrderFromPoint = {
        status: true,
        pointValue: data.pointValue || 0,
        amount: data.amount || 0,
        currencyCode: data.currencyCode || "USD",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    // Map selected items (products) - Always preserve the items
    const selectedItems = data?.selectedItems?.map((item) => ({
      value: item.value,
      types: item.type,
      imgUrl: item.src,
      pointRequired: item.pointRequired,
      itemUrl: item.productUrl,
      ids: item.ids,
      price: item.price,
      variantId: item.variantId,
      productId: item.productId,
    }));

    // Map selected collections - Always preserve the collections
    const selectedCollections = data?.selectedCollections?.map(
      (collection) => ({
        value: collection.value,
        imgUrl: collection.src,
        collectionUrl: collection.collectionUrl,
        ids: collection.ids,
        pointRequired: collection.pointRequired,
      })
    );

    // Map tags with improved handling
    const tags = data.seletedCust.tag.map((tag) => ({
      status: tag.name !== "All" ? tag.status : false,
      name: tag.name,
      tagId: new ObjectID(tag.tagId),
    }));

    // Map tiers with tierIndex
    const tiers = data.seletedCust.tier.map((tier) => ({
      status: tier.status,
      name: tier.name,
      tierId: new ObjectID(tier.tierId),
      tierIndex: tier.tierIndex,
    }));

    // Handle expire field - check if expire is provided and valid
    // Fix: Ensure hasExpiry is always a boolean, never a string
    const hasExpiry = Boolean(
      data.expire &&
        data.expire !== "" &&
        data.expire !== null &&
        data.expire !== undefined
    );
    const expireValue = hasExpiry ? data.expire : null;

    redeems.coupon = {
      active: true,
      target_type: data.target_type,
      value: data.pointValue,
      expire: expireValue, // Will be null if not provided
      hasExpiry: hasExpiry, // Track if expiry is enabled
      discountAmount: data.discountAmount,
      restriction: {
        status: !data.onlineStoreDashBoardDisable,
        selectedItems: {
          // Products restriction status - only enable if products are selected AND restriction is enabled
          status:
            !data.seletedProductDisable &&
            data.currentRestrictionType === "product",
          items: selectedItems ? selectedItems : [],
        },
        selectedCollections: {
          // Collections restriction status - only enable if collections are selected AND restriction is enabled
          status:
            !data.seletedProductDisable &&
            data.currentRestrictionType === "collection",
          collections: selectedCollections ? selectedCollections : [],
        },
        maxReduption: {
          status: !data.redemptionLimitDisable,
          value: data.redemptionLimit || 0,
        },
        selectedCustomber: {
          status: !data.seletedCustDisable,
          tag: tags,
          tier: tiers,
        },
        minimumPurchaseAmount: {
          status: data.hasOwnProperty("minimumnPurchaseAmount")
            ? !data.minimumnPurchaseAmountDisable
            : false,
          value: data.minimumnPurchaseAmount || 0,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const savedRedeem = await redeems.save();
    return savedRedeem;
  } catch (error) {
    throw error;
  }
};

redeemSchema.statics.updateCoupon = async function (data) {
  try {
    // Get existing coupon to preserve items that aren't being updated
    const existingCoupon = await this.findById(new ObjectID(data.couponId));
    if (!existingCoupon) {
      throw new Error("Coupon not found");
    }

    // Map selected items (products) - Always preserve
    const selectedItems = data?.selectedItems?.map((item) => ({
      value: item.value,
      types: item.type,
      imgUrl: item.src,
      pointRequired: item.pointRequired,
      itemUrl: item.productUrl,
      ids: item.ids,
      price: item.price,
      variantId: item.variantId,
      productId: item.productId,
    }));

    // Map selected collections - Always preserve
    const selectedCollections = data?.selectedCollections?.map(
      (collection) => ({
        value: collection.value,
        imgUrl: collection.src,
        collectionUrl: collection.collectionUrl,
        ids: collection.ids,
        pointRequired: collection.pointRequired,
      })
    );

    const tags = data.seletedCust.tag.map((tag) => ({
      status: tag.name !== "All" ? tag.status : false,
      name: tag.name,
      tagId: new ObjectID(tag.tagId),
    }));

    const tiers = data.seletedCust.tier.map((tier) => ({
      status: tier.status,
      name: tier.name,
      tierId: new ObjectID(tier.tierId),
      tierIndex: tier.tierIndex,
    }));

    // Handle expire field - check if expire is provided and valid
    // Fix: Ensure hasExpiry is always a boolean, never a string
    const hasExpiry = Boolean(
      data.expire &&
        data.expire !== "" &&
        data.expire !== null &&
        data.expire !== undefined
    );
    const expireValue = hasExpiry ? data.expire : null;

    let redeemUpdate = {
      updatedAt: new Date(),
      "coupon.updatedAt": new Date(),
      "coupon.restriction.updatedAt": new Date(),
      store_id: data.store_id ? new ObjectID(data.store_id) : undefined,
      channel_id: data.channel_id ? new ObjectID(data.channel_id) : undefined,
      redeemType: data.redeemType,
      "coupon.target_type": data.target_type,
      "coupon.value": data.pointValue,
      "coupon.expire": expireValue, // Will be null if not provided
      "coupon.hasExpiry": hasExpiry, // Explicitly convert to boolean
      "coupon.discountAmount": data.discountAmount,

      // Separate status logic for products and collections
      "coupon.restriction.selectedItems.status":
        !data.seletedProductDisable &&
        data.currentRestrictionType === "product",

      "coupon.restriction.selectedCollections.status":
        !data.seletedProductDisable &&
        data.currentRestrictionType === "collection",

      "coupon.restriction.maxReduption.status": !data.redemptionLimitDisable,
      "coupon.restriction.maxReduption.value": data.redemptionLimit || 0,
      "coupon.restriction.selectedCustomber.status": !data.seletedCustDisable,
      "coupon.restriction.selectedCustomber.tag": tags,
      "coupon.restriction.selectedCustomber.tier": tiers,

      // Always update the arrays with current data
      "coupon.restriction.selectedItems.items": selectedItems
        ? selectedItems
        : [],
      "coupon.restriction.selectedCollections.collections": selectedCollections
        ? selectedCollections
        : [],
    };

    // Remove undefined fields
    if (redeemUpdate.store_id === undefined) delete redeemUpdate.store_id;
    if (redeemUpdate.channel_id === undefined) delete redeemUpdate.channel_id;

    if (data.hasOwnProperty("minimumnPurchaseAmount")) {
      redeemUpdate["coupon.restriction.minimumPurchaseAmount.value"] =
        data.minimumnPurchaseAmount || 0;
      redeemUpdate["coupon.restriction.minimumPurchaseAmount.status"] =
        !data.minimumnPurchaseAmountDisable;
    }

    await this.findOneAndUpdate(
      { _id: new ObjectID(data.couponId) },
      redeemUpdate
    );
  } catch (error) {
    console.error("Error in updateCoupon:", error);
    throw error;
  }
};

// Static method to find by store and channel
redeemSchema.statics.findByStoreAndChannel = async function (
  storeId,
  channelId
) {
  const storeObjectId =
    typeof storeId === "string" ? new ObjectID(storeId) : storeId;
  const channelObjectId =
    typeof channelId === "string" ? new ObjectID(channelId) : channelId;

  return await this.find({
    store_id: storeObjectId,
    channel_id: channelObjectId,
  });
};

// Static method to find by store ID
redeemSchema.statics.findByStoreId = async function (storeId) {
  const storeObjectId =
    typeof storeId === "string" ? new ObjectID(storeId) : storeId;

  return await this.find({ store_id: storeObjectId });
};

// Static method to find by channel ID
redeemSchema.statics.findByChannelId = async function (channelId) {
  const channelObjectId =
    typeof channelId === "string" ? new ObjectID(channelId) : channelId;

  return await this.find({ channel_id: channelObjectId });
};

// Post-save hook - Note: Original code updated merchant setup progress
// If you need similar functionality, you can implement it here
// For example, updating Store or Channel settings based on redeem settings
redeemSchema.post("save", async function (doc, next) {
  console.log("Redeem setting saved for store:", doc.store_id, "channel:", doc.channel_id);

  // TODO: Add any post-save logic here if needed
  // Example: Update store/channel progress tracking, send notifications, etc.

  next();
});

module.exports = mongoose.model("redeem-setting", redeemSchema);

