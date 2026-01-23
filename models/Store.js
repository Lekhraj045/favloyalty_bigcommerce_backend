const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema(
  {
    store_hash: {
      type: String,
      required: true,
      unique: true,
    },
    access_token: {
      type: String,
      required: true,
    },
    scope: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      default: null,
    },
    store_name: {
      type: String,
      default: null,
    },
    store_domain: {
      type: String,
      default: null,
    },
    store_url: {
      type: String,
      default: null,
    },
    platform_version: {
      type: String,
      default: null,
    },
    currency: {
      type: String,
      default: null,
    },
    timezone: {
      type: String,
      default: null,
    },
    language: {
      type: String,
      default: null,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    installed_at: {
      type: Date,
      default: Date.now,
    },
    uninstalled_at: {
      type: Date,
      default: null,
    },
    plan: {
      type: String,
      enum: ["free", "paid"],
      default: "free",
    },
    trialDaysRemaining: {
      type: Number,
      default: null, // null = never tried paid plan, 14-1 = active trial, 0 = trial used/cancelled
    },
    paypalSubscriptionId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

storeSchema.index({ store_hash: 1 });
storeSchema.index({ is_active: 1 });
storeSchema.index({ plan: 1 });

// Static methods
storeSchema.statics.create = async function (storeData) {
  const { storeHash, accessToken, scope, user, email } = storeData;

  console.log("🔄 Attempting to create/update store:", {
    storeHash,
    email: email || user?.email,
  });

  try {
    // Find existing store
    const existingStore = await this.findOne({ store_hash: storeHash });

    if (existingStore) {
      // Update existing store
      console.log("🔄 Store exists, updating...");
      existingStore.access_token = accessToken;
      existingStore.scope = scope;
      existingStore.email = email || user?.email || null;
      existingStore.is_active = true;
      existingStore.uninstalled_at = null;
      await existingStore.save();

      console.log("✅ Store updated");
      return existingStore._id.toString();
    } else {
      // Create new store
      console.log("➕ Store doesn't exist, creating...");
      const newStore = new this({
        store_hash: storeHash,
        access_token: accessToken,
        scope: scope,
        email: email || user?.email || null,
        is_active: true,
        installed_at: new Date(),
        plan: "free",
        trialDaysRemaining: null,
        paypalSubscriptionId: null,
      });

      await newStore.save();
      console.log("✅ Store created with ID:", newStore._id);
      return newStore._id.toString();
    }
  } catch (error) {
    console.error("❌ Error saving store:", error.message);
    throw error;
  }
};

storeSchema.statics.getStoreIdByHash = async function (storeHash) {
  try {
    const store = await this.findOne({ store_hash: storeHash });
    return store ? store._id.toString() : null;
  } catch (error) {
    console.error("❌ Error getting store ID:", error.message);
    throw error;
  }
};

storeSchema.statics.findByHash = async function (storeHash) {
  try {
    const store = await this.findOne({
      store_hash: storeHash,
      is_active: true,
    });
    return store;
  } catch (error) {
    console.error("❌ Error finding store:", error.message);
    throw error;
  }
};

storeSchema.statics.findAll = async function () {
  try {
    return await this.find({ is_active: true }).sort({ installed_at: -1 });
  } catch (error) {
    console.error("❌ Error getting all stores:", error.message);
    throw error;
  }
};

storeSchema.statics.delete = async function (storeHash) {
  try {
    const store = await this.findOne({ store_hash: storeHash });
    if (store) {
      store.is_active = false;
      store.uninstalled_at = new Date();
      await store.save();
      console.log("✅ Store marked as uninstalled:", storeHash);
    }
    return store;
  } catch (error) {
    console.error("❌ Error deleting store:", error.message);
    throw error;
  }
};

storeSchema.statics.hardDelete = async function (storeHash) {
  try {
    const result = await this.deleteOne({ store_hash: storeHash });
    console.log("✅ Store permanently deleted:", storeHash);
    return result;
  } catch (error) {
    console.error("❌ Error permanently deleting store:", error.message);
    throw error;
  }
};

storeSchema.statics.updateToken = async function (storeHash, newAccessToken) {
  try {
    const store = await this.findOne({ store_hash: storeHash });
    if (store) {
      store.access_token = newAccessToken;
      await store.save();
      console.log("✅ Access token updated for store:", storeHash);
    }
    return store;
  } catch (error) {
    console.error("❌ Error updating token:", error.message);
    throw error;
  }
};

storeSchema.statics.updateDetails = async function (storeHash, details) {
  const {
    storeName,
    storeDomain,
    storeUrl,
    platformVersion,
    currency,
    timezone,
    language,
  } = details;

  try {
    const store = await this.findOne({ store_hash: storeHash });
    if (store) {
      if (storeName) store.store_name = storeName;
      if (storeDomain) store.store_domain = storeDomain;
      if (storeUrl) store.store_url = storeUrl;
      if (platformVersion) store.platform_version = platformVersion;
      if (currency) store.currency = currency;
      if (timezone) store.timezone = timezone;
      if (language) store.language = language;
      await store.save();
      console.log("✅ Store details updated for:", storeHash);
    }
    return store;
  } catch (error) {
    console.error("❌ Error updating store details:", error.message);
    throw error;
  }
};

storeSchema.statics.findWithChannels = async function (storeHash) {
  try {
    const store = await this.findOne({
      store_hash: storeHash,
      is_active: true,
    });

    if (!store) {
      return null;
    }

    const Channel = mongoose.model("Channel");
    const channels = await Channel.find({ store_id: store._id }).sort({
      created_at: -1,
    });

    return {
      ...store.toObject(),
      channels: channels,
    };
  } catch (error) {
    console.error("❌ Error finding store with channels:", error.message);
    throw error;
  }
};

const Store = mongoose.model("Store", storeSchema);

module.exports = Store;
