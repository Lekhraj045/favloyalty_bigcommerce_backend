require("dotenv").config();
const express = require("express");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const Store = require("./models/Store");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root route
app.get("/", (req, res) => {
  res.json({
    message: "BigCommerce App Server is running!",
    environment: process.env.NODE_ENV,
    port: PORT,
  });
});

// Health check
app.get("/health", async (req, res) => {
  try {
    // Test database connection
    const db = require("./config/database");
    await db.execute("SELECT 1");

    res.json({
      status: "OK",
      database: "Connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      status: "ERROR",
      database: "Disconnected",
      error: error.message,
    });
  }
});

// Auth Callback - OAuth installation
app.get("/auth/callback", async (req, res) => {
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

    // Exchange code for access token
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

    // Save to MySQL database instead of in-memory Map
    await Store.create({
      storeHash: storeHash,
      accessToken: access_token,
      scope: scope,
      user: user,
    });

    console.log("💾 Store data saved to MySQL:", {
      storeHash,
      userEmail: user.email,
      scope: scope,
    });

    // Return success HTML
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>App Installed Successfully</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 10px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.1);
              text-align: center;
              max-width: 500px;
            }
            h1 { color: #333; margin-bottom: 20px; }
            p { color: #666; line-height: 1.6; }
            .success-icon {
              font-size: 60px;
              margin-bottom: 20px;
            }
            .info {
              background: #f5f5f5;
              padding: 15px;
              border-radius: 5px;
              margin-top: 20px;
              text-align: left;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✅</div>
            <h1>App Installed Successfully!</h1>
            <p>Your BigCommerce app has been installed and authenticated.</p>
            <div class="info">
              <strong>Store Hash:</strong> ${storeHash}<br>
              <strong>User:</strong> ${user.email}<br>
              <strong>Installed:</strong> ${new Date().toLocaleString()}
            </div>
            <p style="margin-top: 20px; font-size: 14px; color: #999;">
              You can now close this window and return to your BigCommerce admin panel.
            </p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("❌ OAuth Error:", error.response?.data || error.message);

    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Failed</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: #f5f5f5;
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 10px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.1);
              text-align: center;
              max-width: 500px;
            }
            h1 { color: #e74c3c; }
            p { color: #666; }
            .error-icon { font-size: 60px; margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="error-icon">❌</div>
            <h1>Authentication Failed</h1>
            <p>There was an error during the OAuth process.</p>
            <p style="font-size: 14px; color: #999;">
              Error: ${error.message}
            </p>
          </div>
        </body>
      </html>
    `);
  }
});

// Load Callback - App loading
app.get("/load", async (req, res) => {
  console.log("📥 Load callback received");
  console.log("Query params:", req.query);

  const { signed_payload_jwt } = req.query;

  if (!signed_payload_jwt) {
    console.error("❌ Missing signed_payload_jwt");
    return res.status(400).send("Missing signed payload");
  }

  try {
    // Verify and decode the JWT
    const payload = jwt.verify(signed_payload_jwt, process.env.CLIENT_SECRET, {
      algorithms: ["HS256"],
    });

    console.log("✅ JWT verified:", payload);

    const storeHash = payload.sub.split("/")[1];

    // Get store from MySQL database
    const store = await Store.findByHash(storeHash);

    if (!store) {
      console.error("❌ Store not found:", storeHash);
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
          <head><title>Store Not Found</title></head>
          <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1>Store Not Found</h1>
            <p>Please reinstall the app.</p>
          </body>
        </html>
      `);
    }

    console.log("✅ Store found:", storeHash);

    // Render your app's main interface
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>My BigCommerce App</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 1200px;
              margin: 0 auto;
              padding: 20px;
              background: #f5f5f5;
            }
            .header {
              background: white;
              padding: 30px;
              border-radius: 10px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              margin-bottom: 20px;
            }
            h1 { color: #333; margin: 0 0 10px 0; }
            .info { color: #666; }
            .card {
              background: white;
              padding: 20px;
              border-radius: 10px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              margin-bottom: 20px;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>🎉 Welcome to My BigCommerce App!</h1>
            <p class="info">Your app is successfully loaded and running.</p>
          </div>
          
          <div class="card">
            <h2>Store Information</h2>
            <p><strong>Store Hash:</strong> ${storeHash}</p>
            <p><strong>User Email:</strong> ${store.user_email}</p>
            <p><strong>User ID:</strong> ${store.user_id}</p>
            <p><strong>Installed At:</strong> ${new Date(
              store.installed_at
            ).toLocaleString()}</p>
            <p><strong>Last Updated:</strong> ${new Date(
              store.updated_at
            ).toLocaleString()}</p>
          </div>

          <div class="card">
            <h2>Quick Actions</h2>
            <p>This is where your app's main functionality would go.</p>
            <button onclick="alert('Feature coming soon!')">Test Feature</button>
          </div>

          <script>
            console.log('App loaded successfully');
            console.log('Store Hash:', '${storeHash}');
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("❌ JWT Verification Error:", error.message);
    res.status(401).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Invalid Signature</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>Invalid Signature</h1>
          <p>The signed payload could not be verified.</p>
          <p style="color: #999; font-size: 14px;">${error.message}</p>
        </body>
      </html>
    `);
  }
});

// Uninstall Callback
app.get("/uninstall", async (req, res) => {
  console.log("📥 Uninstall callback received");
  console.log("Query params:", req.query);

  const { signed_payload_jwt } = req.query;

  if (!signed_payload_jwt) {
    console.error("❌ Missing signed_payload_jwt");
    return res.status(400).send("Missing signed payload");
  }

  try {
    const payload = jwt.verify(signed_payload_jwt, process.env.CLIENT_SECRET, {
      algorithms: ["HS256"],
    });

    const storeHash = payload.sub.split("/")[1];

    // Delete from MySQL database
    await Store.delete(storeHash);

    console.log("✅ App uninstalled for store:", storeHash);

    res.status(200).send("App uninstalled successfully");
  } catch (error) {
    console.error("❌ Uninstall Error:", error.message);
    res.status(500).send("Uninstall failed");
  }
});

// Debug endpoint to see all stores
app.get("/debug/stores", async (req, res) => {
  try {
    const stores = await Store.findAll();

    res.json({
      totalStores: stores.length,
      stores: stores.map((store) => ({
        storeHash: store.store_hash,
        userEmail: store.user_email,
        installedAt: store.installed_at,
        updatedAt: store.updated_at,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server is running on http://localhost:${PORT}`);
  console.log(`✅ Environment: ${process.env.NODE_ENV}`);
  console.log(`✅ Auth Callback: ${process.env.AUTH_CALLBACK}`);
});
