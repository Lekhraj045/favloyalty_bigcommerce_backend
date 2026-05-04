const axios = require("axios");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const {
  resolveStoreFromSignedPayload,
  buildLoginResponse,
  fetchChannelList,
  buildSessionToken,
  SESSION_TTL_SECONDS,
  FRONTEND_BASE_URL,
  fetchStoreInfo,
} = require("../helpers/bigcommerce");
const {
  createOrUpdateWebhook,
} = require("../services/bigcommerceWebhookService");
const { sendEmail } = require("../services/emailService");
const { sendInstallNotificationEmail } = require("../helpers/emailHelpers");

/** Scopes we subscribe to on install so BigCommerce sends webhooks to our /api/webhooks/receive */
const WEBHOOK_SCOPES = ["store/order/statusUpdated", "store/customer/created"];

/**
 * Subscribe to BigCommerce webhooks for this store (called on install).
 * Non-blocking: logs errors but does not fail install.
 */
const subscribeWebhooksOnInstall = async (storeHash, accessToken) => {
  const baseUrl = process.env.BACKEND_URL || process.env.WEBHOOK_BASE_URL;
  if (!baseUrl) {
    console.warn(
      "⚠️ WEBHOOK_BASE_URL (or BACKEND_URL) not set — skipping webhook subscription",
    );
    return;
  }
  const destination = `${baseUrl}/api/webhooks/receive`;
  for (const scope of WEBHOOK_SCOPES) {
    try {
      await createOrUpdateWebhook(storeHash, accessToken, scope, destination);
      console.log(`✅ Webhook subscribed on install: ${scope}`);
    } catch (err) {
      console.error(
        `❌ Failed to subscribe webhook ${scope} on install:`,
        err.message,
      );
    }
  }
};

const login = async (req, res, next) => {
  try {
    const signedPayload =
      req.body.signedPayload || req.body.signed_payload_jwt || req.body.jwt;

    const result = await resolveStoreFromSignedPayload(signedPayload);

    const storeInfo = await fetchStoreInfo(
      result.store.access_token,
      result.storeHash,
    );
    console.log("Store info fetched on login:", storeInfo);

    // Persist store info (including currency) so DB and frontend stay in sync
    if (storeInfo) {
      const updatedStore = await Store.updateOne(
        { _id: result.store._id },
        { currency: storeInfo.currency },
      );
    }

    // Fetch channel list after verification and sync with database
    const channelList = await fetchChannelList(
      result.store.access_token,
      result.storeHash,
      result.store._id.toString(),
    );

    const response = buildLoginResponse(result, channelList);

    res.json(response);
  } catch (error) {
    next(error);
  }
};

const handleAuthCallback = async (req, res) => {
  console.log("📥 Auth callback received with params:", req.query);

  const { code, scope, context } = req.query;

  if (!code || !scope || !context) {
    console.error("❌ Missing required parameters");
    return res.status(400).send("Missing required parameters: code, scope, or context");
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
      {headers: {"Content-Type": "application/json"}},
    );
    
    const { access_token, user, context: storeContext } = tokenResponse.data;
    const storeHash = storeContext.split("/")[1];

    const { data } = await axios.get(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/store`,
      {
        headers: {
          "X-Auth-Token": access_token,
          Accept: "application/json",
        },
      },
    );

    console.log("✅ Access token received for store:", storeHash);

    //1. Save store data and get the store ID
    console.log("💾 Saving store data to database...");
    const storeDetails = {
      storeHash: storeHash,
      accessToken: access_token,
      scope: scope,
      email: user?.email || null,
      storeName: data?.name || null,
      storeDomain: data?.domain || null,
      storeUrl: data?.url || null,
    };
    const storeId = await Store.create(storeDetails);

    console.log("✅ Store data saved successfully:", storeDetails);

    // Validate storeId before proceeding
    if (!storeId) {
      console.error("❌ Store ID is invalid:", storeId);
      throw new Error("Failed to retrieve valid store ID after saving store data");
    }

    //2. Fetch active channel list from BigCommerce and sync with database
    console.log("🔄 Fetching channel list from BigCommerce API...");
    const channelList = await fetchChannelList(access_token,storeHash,storeId,true); // filterActiveOnly = true for installation flow
    console.log(`✅ Fetched ${channelList?.length || 0} channels from BigCommerce API`);

    //3. Subscribe to webhooks (order status, customer created) on install
    await subscribeWebhooksOnInstall(storeHash, access_token);

    //4. Send install notification email TO support@favloyalty.com
    await sendInstallNotificationEmail({
      ...storeDetails,
      userEmail: user.email,
    });

    console.log("✅ Auth callback completed successfully");

    const store = await Store.findByHash(storeHash);
    if (!store) {throw new Error("Store not found after creation")}

    //5. Generate session token for immediate authentication
    const sessionToken = buildSessionToken(store);
    const sessionExpiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;

    //6. Redirect to frontend install page which will handle authentication and redirect to setup
    const redirectUrl = new URL("install", FRONTEND_BASE_URL);
    redirectUrl.searchParams.set("storeHash", storeHash);
    redirectUrl.searchParams.set("storeId", storeId.toString());
    redirectUrl.searchParams.set("sessionToken", sessionToken);
    redirectUrl.searchParams.set("sessionExpiresAt", sessionExpiresAt.toString());

    if (user?.email) {
      redirectUrl.searchParams.set("email", user.email);
    }

    console.log("🔁 Redirecting to setup page:", redirectUrl.toString());

    //7. Return HTML page that redirects the parent window (BigCommerce shows this in an iframe)
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta http-equiv="refresh" content="0;url=${redirectUrl.toString()}" />
          <title>Installation Complete</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 60px; }
            .card {
              display: inline-block;
              padding: 32px;
              border-radius: 12px;
              background: #fff;
              box-shadow: 0 10px 30px rgba(0,0,0,0.08);
            }
            .muted { color: #888; font-size: 14px; }
            .success { color: #10b981; font-size: 18px; font-weight: bold; margin-bottom: 16px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="success">✓ Installation Successful!</div>
            <h1>Welcome to FavLoyalty</h1>
            <p>Redirecting you to the setup page...</p>
            <p class="muted">Store: ${storeHash}</p>
          </div>
          <script>
            window.top.location.href = "${redirectUrl.toString()}";
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("❌ OAuth Error:", {message: error.message,response: error.response?.data,stack: error.stack})

    res.status(500).json({
      status_code: 500,
      status: false,
      message: "Authentication failed",
      error: error.message,
      details: error.response?.data || null,
    });
  }
};

// Refresh session token endpoint
const refreshToken = async (req, res, next) => {
  try {
    const { storeHash } = req.body;

    if (!storeHash) {
      return res.status(400).json({status: false,message: "Missing store hash"});
    }

    // Find store by hash
    const store = await Store.findByHash(storeHash);

    if (!store || !store.is_active) {
      return res.status(404).json({status: false, message: "Store not found or not active"});
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
  refreshToken,
};
