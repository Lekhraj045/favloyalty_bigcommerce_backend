const axios = require("axios");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const {
  resolveStoreFromSignedPayload,
  buildLoginResponse,
  fetchChannelList,
  buildSessionToken,
  SESSION_TTL_SECONDS,
} = require("../helpers/bigcommerce");

const login = async (req, res, next) => {
  try {
    const signedPayload =
      req.body.signedPayload || req.body.signed_payload_jwt || req.body.jwt;

    const result = await resolveStoreFromSignedPayload(signedPayload);

    // Fetch channel list after verification and sync with database
    const channelList = await fetchChannelList(
      result.store.access_token,
      result.storeHash,
      result.store._id.toString()
    );

    const response = buildLoginResponse(result, channelList);

    res.json(response);
  } catch (error) {
    next(error);
  }
};

const handleAuthCallback = async (req, res) => {
  console.log("📥 Auth callback received");
  console.log("Query params:", req.query);

  const { code, scope, context } = req.query;

  if (!code || !scope || !context) {
    console.error("❌ Missing required parameters");
    return res
      .status(400)
      .send("Missing required parameters: code, scope, or context");
  }

  try {
    console.log("🔄 Exchanging code for access token...");

    const tokenResponse = await axios.post(
      "https://login.bigcommerce.com/oauth2/token",
      {
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        code: code,
        scope: scope,
        grant_type: "authorization_code",
        redirect_uri: process.env.AUTH_CALLBACK,
        context: context,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const { access_token, user, context: storeContext } = tokenResponse.data;
    const storeHash = storeContext.split("/")[1];

    console.log("✅ Access token received for store:", storeHash);

    // Save store data and get the store ID
    console.log("💾 Saving store data to database...");
    const storeId = await Store.create({
      storeHash: storeHash,
      accessToken: access_token,
      scope: scope,
      email: user?.email || null,
    });

    console.log("✅ Store data saved successfully:", {
      storeId,
      storeHash,
      email: user?.email,
    });

    // Validate storeId before proceeding
    if (!storeId) {
      // Changed from storeId === 0 check
      console.error("❌ Store ID is invalid:", storeId);
      throw new Error(
        "Failed to retrieve valid store ID after saving store data"
      );
    }

    // Fetch channel list from BigCommerce and sync with database
    // During installation, only fetch active channels
    console.log("🔄 Fetching channel list from BigCommerce API...");
    const channelList = await fetchChannelList(
      access_token,
      storeHash,
      storeId,
      true // filterActiveOnly = true for installation flow
    );

    console.log(
      `📋 Fetched ${channelList?.length || 0} channels from BigCommerce API`
    );

    // Channels are now automatically synced in fetchChannelList
    // Get saved channels count for response
    let savedChannels = [];
    try {
      const existingChannels = await Channel.findByStoreId(storeId);
      savedChannels = existingChannels || [];
      console.log(
        `💾 Database now contains ${savedChannels.length} channels for store: ${storeHash}`
      );
    } catch (channelError) {
      console.error("❌ Error retrieving saved channels:", {
        message: channelError.message,
      });
    }

    // Build response data
    const resData = {
      user_id: user?.id,
      shop: storeHash,
      store_email: user?.email,
      api_token: access_token,
      domain: tokenResponse.data?.domain || null,
      manage_services: tokenResponse.data?.manage_services || [],
      channel_list: channelList || [],
      channel_count: channelList?.length || 0,
      saved_channel_count: savedChannels.length,
    };

    console.log("✅ Auth callback completed successfully");

    res.status(200).json({
      status_code: 200,
      status: true,
      data: resData,
      message: "App installed successfully!",
    });
  } catch (error) {
    console.error("❌ OAuth Error:", {
      message: error.message,
      response: error.response?.data,
      stack: error.stack,
    });

    res.status(500).json({
      status_code: 500,
      status: false,
      message: "Authentication failed",
      error: error.message,
      details: error.response?.data || null,
    });
  }
};

// Uninstall handler (optional - for when app is uninstalled)
const handleUninstall = async (req, res) => {
  try {
    const signedPayload =
      req.body.signed_payload_jwt || req.body.signed_payload;

    if (!signedPayload) {
      return res.status(400).json({
        status: false,
        message: "Missing signed payload",
      });
    }

    const result = await resolveStoreFromSignedPayload(signedPayload);

    // Mark store as uninstalled (soft delete)
    await Store.delete(result.storeHash);

    console.log("✅ Store uninstalled:", result.storeHash);

    res.status(200).json({
      status: true,
      message: "App uninstalled successfully",
    });
  } catch (error) {
    console.error("❌ Uninstall Error:", error.message);
    res.status(500).json({
      status: false,
      message: "Uninstall failed",
      error: error.message,
    });
  }
};

// Load handler (when app is loaded in BigCommerce admin)
const handleLoad = async (req, res) => {
  try {
    const signedPayload =
      req.body.signed_payload_jwt || req.body.signed_payload;

    if (!signedPayload) {
      return res.status(400).json({
        status: false,
        message: "Missing signed payload",
      });
    }

    const result = await resolveStoreFromSignedPayload(signedPayload);

    // Fetch and sync channels on load (sync happens automatically in fetchChannelList)
    const channelList = await fetchChannelList(
      result.store.access_token,
      result.storeHash,
      result.store._id.toString()
    );

    const response = buildLoginResponse(result, channelList);

    res.json({
      status: true,
      data: response,
    });
  } catch (error) {
    console.error("❌ Load Error:", error.message);
    res.status(500).json({
      status: false,
      message: "Load failed",
      error: error.message,
    });
  }
};

// Refresh session token endpoint
const refreshToken = async (req, res, next) => {
  try {
    const { storeHash } = req.body;

    if (!storeHash) {
      return res.status(400).json({
        status: false,
        message: "Missing store hash",
      });
    }

    // Find store by hash
    const store = await Store.findByHash(storeHash);

    if (!store) {
      return res.status(404).json({
        status: false,
        message: "Store not found",
      });
    }

    // Verify store is active
    if (!store.is_active) {
      return res.status(403).json({
        status: false,
        message: "Store is not active",
      });
    }

    // Generate new session token
    const sessionToken = buildSessionToken(store);
    const sessionExpiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;

    console.log("✅ Session token refreshed for store:", storeHash);

    res.json({
      status: true,
      sessionToken,
      sessionExpiresAt,
    });
  } catch (error) {
    console.error("❌ Refresh Token Error:", error.message);
    next(error);
  }
};

module.exports = {
  login,
  handleAuthCallback,
  handleUninstall,
  handleLoad,
  refreshToken,
};
