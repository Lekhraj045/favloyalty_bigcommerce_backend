const mongoose = require("mongoose");

const defaultAddressSchema = new mongoose.Schema(
  {
    address1: {
      type: String,
      default: null,
    },
    address2: {
      type: String,
      default: null,
    },
    city: {
      type: String,
      default: null,
    },
    company: {
      type: String,
      default: null,
    },
    country: {
      type: String,
      default: null,
    },
    zip: {
      type: String,
      default: null,
    },
    province: {
      type: String,
      default: null,
    },
    default: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false, timestamps: false }
);

const currentTierSchema = new mongoose.Schema(
  {
    tierIndex: {
      type: Number,
      default: 0,
    },
    multiplier: {
      type: Number,
      default: 1,
    },
    minPointsRequired: {
      type: Number,
      default: 0,
    },
    maxPoints: {
      type: Number,
      default: null,
    },
  },
  { _id: false, timestamps: false }
);

const profileSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: null,
    },
    contactNo: {
      type: String,
      default: null,
    },
    ageGroup: {
      type: String,
      default: null,
    },
    weddingAnniversary: {
      type: Date,
      default: null,
    },
    gender: {
      type: String,
      default: null,
    },
  },
  { _id: false, timestamps: false }
);

const customerSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
    },
    shop: {
      type: String,
      default: null,
    },
    store_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
    },
    channel_id: {
      type: Number,
      required: true,
    },
    bcCustomerId: {
      type: Number,
      required: true,
      comment: "BigCommerce customer ID",
    },
    acceptsMarketing: {
      type: Boolean,
      default: false,
    },
    canChangeDob: {
      type: Boolean,
      default: true,
    },
    canChangeProfile: {
      type: Boolean,
      default: true,
    },
    dob: {
      type: Date,
      default: null,
      comment: "Date of birth; used for birthday points (Ways to Earn)",
    },
    currentTier: {
      type: currentTierSchema,
      default: () => ({
        tierIndex: 0,
        multiplier: 1,
        minPointsRequired: 0,
        maxPoints: null,
      }),
    },
    default_address: {
      type: defaultAddressSchema,
      default: null,
    },
    firstName: {
      type: String,
      default: null,
    },
    lastName: {
      type: String,
      default: null,
    },
    joiningDate: {
      type: Date,
      default: Date.now,
    },
    lastVisit: {
      type: Date,
      default: null,
    },
    nextTier: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    ordersCount: {
      type: Number,
      default: 0,
    },
    points: {
      type: Number,
      default: 0,
    },
    pointsEarned: {
      type: Number,
      default: 0,
    },
    pointsRedeemed: {
      type: Number,
      default: 0,
    },
    profile: {
      type: profileSchema,
      default: () => ({
        name: null,
        contactNo: null,
        ageGroup: null,
        weddingAnniversary: null,
        gender: null,
      }),
    },
    referral_points: {
      type: Number,
      default: 0,
    },
    refferalCount: {
      type: Number,
      default: 0,
    },
    refreshToken: {
      type: String,
      default: null,
    },
    tags: {
      type: [String],
      default: [],
    },
    totalSpent: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
customerSchema.index({ store_id: 1, channel_id: 1 });
customerSchema.index({ store_id: 1, email: 1 });
customerSchema.index({ email: 1 });
customerSchema.index(
  { store_id: 1, channel_id: 1, email: 1 },
  { unique: true }
);
customerSchema.index({ store_id: 1, bcCustomerId: 1 }); // For quick lookups by BigCommerce customer ID

// Static methods
customerSchema.statics.create = async function (customerData) {
  const {
    email,
    shop,
    store_id,
    channel_id,
    bcCustomerId,
    acceptsMarketing,
    canChangeDob,
    canChangeProfile,
    dob,
    currentTier,
    default_address,
    firstName,
    lastName,
    joiningDate,
    lastVisit,
    nextTier,
    ordersCount,
    points,
    pointsEarned,
    pointsRedeemed,
    profile,
    referral_points,
    refferalCount,
    refreshToken,
    tags,
    totalSpent,
  } = customerData;

  try {
    const customer = new this({
      email,
      shop: shop || null,
      store_id,
      channel_id,
      bcCustomerId: bcCustomerId || null,
      acceptsMarketing: acceptsMarketing || false,
      canChangeDob: canChangeDob !== undefined ? canChangeDob : true,
      canChangeProfile:
        canChangeProfile !== undefined ? canChangeProfile : true,
      dob: dob ?? null,
      currentTier: currentTier || {
        tierIndex: 0,
        multiplier: 1,
        minPointsRequired: 0,
        maxPoints: null,
      },
      default_address: default_address || null,
      firstName: firstName || null,
      lastName: lastName || null,
      joiningDate: joiningDate || new Date(),
      lastVisit: lastVisit || null,
      nextTier: nextTier || null,
      ordersCount: ordersCount || 0,
      points: points || 0,
      pointsEarned: pointsEarned || 0,
      pointsRedeemed: pointsRedeemed || 0,
      profile: profile || {
        name: null,
        contactNo: null,
        ageGroup: null,
        weddingAnniversary: null,
        gender: null,
      },
      referral_points: referral_points || 0,
      refferalCount: refferalCount || 0,
      refreshToken: refreshToken || null,
      tags: tags || [],
      totalSpent: totalSpent || 0,
    });

    await customer.save();
    return customer;
  } catch (error) {
    console.error("❌ Error creating customer:", error.message);
    throw error;
  }
};

customerSchema.statics.findByEmail = async function (
  email,
  storeId,
  channelId
) {
  try {
    const query = { email };
    if (storeId) {
      query.store_id =
        typeof storeId === "string"
          ? new mongoose.Types.ObjectId(storeId)
          : storeId;
    }
    if (channelId !== undefined) {
      query.channel_id = channelId;
    }
    return await this.findOne(query);
  } catch (error) {
    console.error("❌ Error finding customer by email:", error.message);
    throw error;
  }
};

customerSchema.statics.findByStoreAndChannel = async function (
  storeId,
  channelId
) {
  try {
    const storeObjectId =
      typeof storeId === "string"
        ? new mongoose.Types.ObjectId(storeId)
        : storeId;

    return await this.find({
      store_id: storeObjectId,
      channel_id: channelId,
    }).sort({ createdAt: -1 });
  } catch (error) {
    console.error(
      "❌ Error finding customers by store and channel:",
      error.message
    );
    throw error;
  }
};

customerSchema.statics.findByStoreId = async function (storeId) {
  try {
    const storeObjectId =
      typeof storeId === "string"
        ? new mongoose.Types.ObjectId(storeId)
        : storeId;

    return await this.find({ store_id: storeObjectId }).sort({ createdAt: -1 });
  } catch (error) {
    console.error("❌ Error finding customers by store:", error.message);
    throw error;
  }
};

customerSchema.statics.updateCustomer = async function (
  customerId,
  updateData
) {
  try {
    const customerObjectId =
      typeof customerId === "string"
        ? new mongoose.Types.ObjectId(customerId)
        : customerId;

    const customer = await this.findByIdAndUpdate(
      customerObjectId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!customer) {
      throw new Error("Customer not found");
    }

    return customer;
  } catch (error) {
    console.error("❌ Error updating customer:", error.message);
    throw error;
  }
};

customerSchema.statics.updatePoints = async function (
  customerId,
  pointsChange,
  transactionType = null
) {
  try {
    const customerObjectId =
      typeof customerId === "string"
        ? new mongoose.Types.ObjectId(customerId)
        : customerId;

    const customer = await this.findById(customerObjectId);
    if (!customer) {
      throw new Error("Customer not found");
    }

    // Update total points
    customer.points = (customer.points || 0) + pointsChange;

    // Update earned/redeemed based on transaction type
    if (
      transactionType === "earn" ||
      transactionType === "signup" ||
      transactionType === "referral"
    ) {
      customer.pointsEarned =
        (customer.pointsEarned || 0) + Math.abs(pointsChange);
      if (transactionType === "referral" && pointsChange > 0) {
        customer.referral_points = (customer.referral_points || 0) + pointsChange;
        customer.refferalCount = (customer.refferalCount || 0) + 1;
      }
    } else if (transactionType === "redeem") {
      customer.pointsRedeemed =
        (customer.pointsRedeemed || 0) + Math.abs(pointsChange);
    } else if (transactionType === "adjustment") {
      // For adjustments, update earned/redeemed based on sign
      if (pointsChange > 0) {
        customer.pointsEarned = (customer.pointsEarned || 0) + pointsChange;
      } else {
        customer.pointsRedeemed =
          (customer.pointsRedeemed || 0) + Math.abs(pointsChange);
      }
    }

    await customer.save();
    return customer;
  } catch (error) {
    console.error("❌ Error updating customer points:", error.message);
    throw error;
  }
};

/**
 * Add a transaction and update customer points
 */
customerSchema.statics.addTransaction = async function (
  customerId,
  transactionData
) {
  try {
    const Transaction = require("./Transaction");
    const customerObjectId =
      typeof customerId === "string"
        ? new mongoose.Types.ObjectId(customerId)
        : customerId;

    const customer = await this.findById(customerObjectId);
    if (!customer) {
      throw new Error("Customer not found");
    }

    // Ensure bcCustomerId is included in transaction data
    const transactionDataWithCustomer = {
      ...transactionData,
      customerId: customerObjectId,
      bcCustomerId: customer.bcCustomerId,
    };

    // Create transaction
    const transaction = await Transaction.createTransaction(
      transactionDataWithCustomer
    );

    // Update customer points if transaction is completed
    if (transaction.status === "completed") {
      await this.updatePoints(
        customerObjectId,
        transaction.points,
        transaction.type
      );
    }

    return transaction;
  } catch (error) {
    console.error("❌ Error adding transaction to customer:", error.message);
    throw error;
  }
};

customerSchema.statics.updateLastVisit = async function (customerId) {
  try {
    const customerObjectId =
      typeof customerId === "string"
        ? new mongoose.Types.ObjectId(customerId)
        : customerId;

    const customer = await this.findByIdAndUpdate(
      customerObjectId,
      { $set: { lastVisit: new Date() } },
      { new: true }
    );

    return customer;
  } catch (error) {
    console.error("❌ Error updating customer last visit:", error.message);
    throw error;
  }
};

customerSchema.statics.deleteCustomer = async function (customerId) {
  try {
    const customerObjectId =
      typeof customerId === "string"
        ? new mongoose.Types.ObjectId(customerId)
        : customerId;

    const result = await this.findByIdAndDelete(customerObjectId);
    return result;
  } catch (error) {
    console.error("❌ Error deleting customer:", error.message);
    throw error;
  }
};

const Customer = mongoose.model("Customer", customerSchema);

module.exports = Customer;
