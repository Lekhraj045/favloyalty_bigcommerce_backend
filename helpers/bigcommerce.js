const jwt = require("jsonwebtoken");
const axios = require("axios");
const mongoose = require("mongoose");
const Store = require("../models/Store");
const Channel = require("../models/Channel");

const FRONTEND_BASE_URL =
  process.env.FRONTEND_BASE_URL ||
  "https://favbigcommercefrontend.share.zrok.io";
const SESSION_TTL_SECONDS = parseInt(
  process.env.SESSION_TTL_SECONDS || "900",
  10,
);
const SESSION_SECRET =
  process.env.APP_SESSION_SECRET || process.env.CLIENT_SECRET;

if (!SESSION_SECRET) {
  throw new Error(
    "Missing APP_SESSION_SECRET or CLIENT_SECRET. Add one of them to your environment.",
  );
}

/**
 * Verify the signed payload JWT from BigCommerce
 */
const verifySignedPayload = (token) =>
  jwt.verify(token, process.env.CLIENT_SECRET, {
    algorithms: ["HS256"],
  });

/**
 * Extract store hash from JWT payload
 */
const extractStoreHash = (payload) => {
  if (payload?.context?.includes("/")) {
    return payload.context.split("/")[1];
  }
  if (payload?.sub?.includes("/")) {
    return payload.sub.split("/")[1];
  }
  return null;
};

/**
 * Build a session token for the frontend
 */
const buildSessionToken = (store) =>
  jwt.sign(
    {
      storeHash: store.store_hash,
      email: store.email,
      storeId: store._id.toString(), // Changed from store.id to store._id.toString()
    },
    SESSION_SECRET,
    { expiresIn: SESSION_TTL_SECONDS },
  );

/**
 * Fetch channel list from BigCommerce API and sync with database
 * @param {string} accessToken - BigCommerce access token
 * @param {string} storeHash - Store hash identifier
 * @param {string|null} storeId - Store ID for database sync (optional)
 * @param {boolean} filterActiveOnly - If true, only fetch active channels (default: false)
 */
const fetchChannelList = async (
  accessToken,
  storeHash,
  storeId = null,
  filterActiveOnly = false,
) => {
  try {
    console.log("🔄 Fetching channel list for store:", storeHash);

    const response = await axios.get(
      `https://api.bigcommerce.com/stores/${storeHash}/v3/channels`,
      {
        headers: {
          "X-Auth-Token": accessToken,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
    );

    let channelsFromBigCommerce = response.data.data || [];

    // Fetch channel currency assignments to get default_currency per channel (only consider default currency)
    let currencyAssignmentsMap = {};
    try {
      const currencyResponse = await axios.get(
        `https://api.bigcommerce.com/stores/${storeHash}/v3/channels/currency-assignments`,
        {
          headers: {
            "X-Auth-Token": accessToken,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        },
      );
      const assignments = currencyResponse.data?.data || [];
      for (const a of assignments) {
        if (a.channel_id != null && a.default_currency) {
          currencyAssignmentsMap[a.channel_id] = a.default_currency;
        }
      }
      console.log(
        `✅ Currency assignments fetched for ${Object.keys(currencyAssignmentsMap).length} channels`,
      );
    } catch (currencyErr) {
      console.warn(
        "⚠️ Could not fetch channel currency assignments (store may use single currency):",
        currencyErr.message,
      );
    }

    // Enrich each channel with default_currency
    channelsFromBigCommerce = channelsFromBigCommerce.map((ch) => ({
      ...ch,
      default_currency: currencyAssignmentsMap[ch.id] || null,
    }));

    // Filter for active BigCommerce-platform channels only if requested (during installation)
    if (filterActiveOnly) {
      const allChannelsCount = channelsFromBigCommerce.length;
      channelsFromBigCommerce = channelsFromBigCommerce.filter(
        (channel) =>
          channel.status === "active" && channel.platform === "bigcommerce",
      );
      console.log(
        `🔍 Filtered channels: ${allChannelsCount} total, ${channelsFromBigCommerce.length} active bigcommerce-platform`,
      );
    }

    console.log(
      `✅ Channel list fetched successfully: ${channelsFromBigCommerce.length} channels`,
    );

    // Sync with database if storeId is provided
    let databaseChannels = [];
    if (storeId) {
      try {
        // Check if channels exist in database for this store
        const existingChannels = await Channel.findByStoreId(storeId);
        const hasChannelsInDb = existingChannels && existingChannels.length > 0;
        const hasChannelsFromBC = channelsFromBigCommerce.length > 0;

        if (!hasChannelsInDb && hasChannelsFromBC) {
          // No channels in DB, but we got channels from BigCommerce - insert them
          console.log(
            `💾 No channels in database, inserting ${channelsFromBigCommerce.length} channels`,
          );
          await Channel.saveChannels(storeId, channelsFromBigCommerce);
          console.log("✅ Channels inserted successfully");
        } else if (hasChannelsInDb && !hasChannelsFromBC) {
          // Channels exist in DB, but we got 0 channels from BigCommerce - delete them
          console.log(
            `🗑️ Channels exist in database (${existingChannels.length}), but BigCommerce returned 0 channels. Deleting channels from database.`,
          );
          await Channel.deleteByStoreId(storeId);
          console.log("✅ Channels deleted successfully");
        } else if (hasChannelsInDb && hasChannelsFromBC) {
          // Channels exist in both places - sync them (update existing, add new, remove deleted)
          console.log(
            `🔄 Syncing ${channelsFromBigCommerce.length} channels with database (${existingChannels.length} existing)`,
          );
          await Channel.syncChannels(storeId, channelsFromBigCommerce);
          console.log("✅ Channels synced successfully");
        } else {
          // No channels in DB and no channels from BigCommerce - nothing to do
          console.log(
            "ℹ️ No channels in database and no channels from BigCommerce",
          );
        }

        // Fetch database channels after sync
        databaseChannels = await Channel.findByStoreId(storeId);

        // If filtering for active channels only, remove any inactive or non-bigcommerce channels from database
        if (
          filterActiveOnly &&
          databaseChannels &&
          databaseChannels.length > 0
        ) {
          const excludedChannels = databaseChannels.filter(
            (channel) =>
              channel.status !== "active" || channel.platform !== "bigcommerce",
          );

          if (excludedChannels.length > 0) {
            console.log(
              `🗑️ Removing ${excludedChannels.length} inactive/non-bigcommerce channels from database`,
            );

            const excludedChannelIds = excludedChannels.map((ch) => ch._id);
            const storeObjectId =
              typeof storeId === "string"
                ? new mongoose.Types.ObjectId(storeId)
                : storeId;

            await Channel.deleteMany({
              store_id: storeObjectId,
              _id: { $in: excludedChannelIds },
            });

            console.log(
              "✅ Inactive/non-bigcommerce channels removed successfully",
            );

            // Fetch updated channel list after removal
            databaseChannels = await Channel.findByStoreId(storeId);
          }
        }

        // Seed email templates for newly synced channels
        if (databaseChannels && databaseChannels.length > 0) {
          try {
            const {
              seedEmailTemplatesForChannels,
            } = require("./emailTemplateSeeder");
            const channelIds = databaseChannels.map((ch) => ch._id);
            console.log(
              `🌱 Seeding email templates for ${channelIds.length} channels...`,
            );
            await seedEmailTemplatesForChannels(channelIds);
          } catch (seedError) {
            console.error("❌ Error seeding email templates:", {
              message: seedError.message,
              stack: seedError.stack,
            });
            // Don't fail the entire process if seeding fails
          }
        }
      } catch (syncError) {
        console.error("❌ Error syncing channels with database:", {
          message: syncError.message,
          stack: syncError.stack,
        });
        // Try to fetch existing channels from database even if sync fails
        try {
          databaseChannels = await Channel.findByStoreId(storeId);
        } catch (fetchError) {
          console.error(
            "❌ Error fetching database channels:",
            fetchError.message,
          );
        }
      }
    } else {
      console.log(
        "⚠️ Store ID not provided, skipping database sync. Channels fetched but not saved.",
      );
    }

    // Return database channels if available, otherwise return BigCommerce channels
    // Format database channels to include MongoDB _id and BigCommerce channel_id
    // Filter to only return active BigCommerce-platform channels for UI display
    if (databaseChannels && databaseChannels.length > 0) {
      const formattedChannels = databaseChannels
        .filter(
          (channel) =>
            channel.status === "active" && channel.platform === "bigcommerce",
        )
        .map((channel) => ({
          id: channel._id.toString(),
          channel_id: channel.channel_id,
          channel_name: channel.channel_name,
          channel_type: channel.channel_type,
          platform: channel.platform,
          status: channel.status,
          setupprogress: channel.setupprogress || 0,
          pointsTierSystemCompleted: channel.pointsTierSystemCompleted || false,
          waysToEarnCompleted: channel.waysToEarnCompleted || false,
          waysToRedeemCompleted: channel.waysToRedeemCompleted || false,
          customiseWidgetCompleted: channel.customiseWidgetCompleted || false,
          widget_visibility:
            typeof channel.widget_visibility === "boolean"
              ? channel.widget_visibility
              : true,
          script_id: channel.script_id ?? null,
          default_currency: channel.default_currency ?? null,
          site_url: channel.site_url ?? null,
        }));

      console.log(
        `📋 Returning ${formattedChannels.length} active channels (filtered from ${databaseChannels.length} total)`,
      );

      return formattedChannels;
    }

    // Fallback to BigCommerce channels if database channels are not available
    // Filter to only return active BigCommerce-platform channels
    const formattedChannels = channelsFromBigCommerce
      .filter(
        (channel) =>
          channel.status === "active" && channel.platform === "bigcommerce",
      )
      .map((channel) => ({
        id: null, // No database ID available
        channel_id: channel.id,
        channel_name: channel.name,
        channel_type: channel.type,
        platform: channel.platform,
        status: channel.status,
        setupprogress: 0, // Default to 0 for new channels
        pointsTierSystemCompleted: false,
        waysToEarnCompleted: false,
        waysToRedeemCompleted: false,
        customiseWidgetCompleted: false,
        script_id: null,
        default_currency: channel.default_currency ?? null,
        site_url: channel.site_url ?? null,
      }));

    console.log(
      `📋 Returning ${formattedChannels.length} active channels (filtered from ${channelsFromBigCommerce.length} total)`,
    );

    return formattedChannels;
  } catch (error) {
    console.error(
      "❌ Error fetching channel list:",
      error.response?.data || error.message,
    );

    // Return empty array if fetch fails instead of throwing
    return [];
  }
};

/**
 * Fetch store information from BigCommerce API
 */
const fetchStoreInfo = async (accessToken, storeHash) => {
  try {
    console.log("🔄 Fetching store info for:", storeHash);

    const response = await axios.get(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/store`,
      {
        headers: {
          "X-Auth-Token": accessToken,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
    );

    console.log("✅ Store info fetched successfully");
    return response.data;
  } catch (error) {
    console.error(
      "❌ Error fetching store info:",
      error.response?.data || error.message,
    );
    return null;
  }
};

/**
 * Resolve store from signed payload
 */
const resolveStoreFromSignedPayload = async (signedPayload) => {
  if (!signedPayload) {
    const error = new Error("Missing signed payload");
    error.statusCode = 400;
    throw error;
  }

  const payload = verifySignedPayload(signedPayload);
  const storeHash = extractStoreHash(payload);

  if (!storeHash) {
    const error = new Error("Could not determine store hash from payload");
    error.statusCode = 400;
    throw error;
  }

  const store = await Store.findByHash(storeHash);

  if (!store) {
    const error = new Error("Store not found. Please reinstall the app.");
    error.statusCode = 404;
    throw error;
  }

  return { payload, store, storeHash };
};

/**
 * Build login response with session token and store data
 */
const buildLoginResponse = (
  { store, storeHash, payload },
  channelList = [],
) => {
  const sessionToken = buildSessionToken(store);
  const sessionExpiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;

  return {
    sessionToken,
    sessionExpiresAt,
    store: {
      id: store._id.toString(), // Changed from store.id to store._id.toString()
      hash: storeHash,
      email: store.email,
      userEmail: store.email, // Alias for backward compatibility
      storeName: store.store_name,
      storeDomain: store.store_domain,
      storeUrl: store.store_url,
      currency: store.currency,
      timezone: store.timezone,
      language: store.language,
      platformVersion: store.platform_version,
      installedAt: store.installed_at,
      updatedAt: store.updated_at,
      scope: store.scope,
      isActive: store.is_active,
    },
    bigCommerce: {
      user: payload.user,
      owner: payload.owner,
      context: payload.context,
      issuedAt: payload.iat,
    },
    channels: channelList,
    channelCount: channelList.length,
  };
};

/**
 * Verify session token from frontend
 */
const verifySessionToken = (token) => {
  try {
    return jwt.verify(token, SESSION_SECRET);
  } catch (error) {
    const err = new Error("Invalid or expired session token");
    err.statusCode = 401;
    throw err;
  }
};

/**
 * Middleware to verify session token from request headers
 */
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        status: false,
        message: "Missing or invalid authorization header",
      });
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix
    const decoded = verifySessionToken(token);

    // Verify store still exists and is active
    const store = await Store.findByHash(decoded.storeHash);

    if (!store) {
      return res.status(404).json({
        status: false,
        message: "Store not found",
      });
    }

    // Attach store data to request
    req.store = store;
    req.storeHash = decoded.storeHash;
    req.storeId = decoded.storeId;

    next();
  } catch (error) {
    console.error("❌ Auth Error:", error.message);
    res.status(401).json({
      status: false,
      message: "Authentication failed",
      error: error.message,
    });
  }
};

module.exports = {
  FRONTEND_BASE_URL,
  SESSION_TTL_SECONDS,
  verifySignedPayload,
  extractStoreHash,
  resolveStoreFromSignedPayload,
  buildLoginResponse,
  buildSessionToken,
  fetchChannelList,
  fetchStoreInfo,
  verifySessionToken,
  requireAuth,
};
