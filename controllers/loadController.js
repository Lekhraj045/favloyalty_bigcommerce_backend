const {
  FRONTEND_BASE_URL,
  resolveStoreFromSignedPayload,
} = require("../helpers/bigcommerce");

const handleLoad = async (req, res) => {
  console.log("📥 Load callback received");
  console.log("Query params:", req.query);

  const { signed_payload_jwt } = req.query;

  try {
    const { storeHash } = await resolveStoreFromSignedPayload(signed_payload_jwt);

    const redirectUrl = new URL("/load", FRONTEND_BASE_URL);
    redirectUrl.searchParams.set("signed_payload_jwt", signed_payload_jwt);

    console.log("✅ Store verified for load:", storeHash);
    console.log("🔁 Redirecting to frontend:", redirectUrl.toString());

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta http-equiv="refresh" content="0;url=${redirectUrl.toString()}" />
          <title>Redirecting...</title>
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
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Launching FavLoyalty</h1>
            <p>We verified your BigCommerce session. Opening the app…</p>
            <p class="muted">Store: ${storeHash}</p>
          </div>
          <script>
            window.top.location.href = "${redirectUrl.toString()}";
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("❌ Load Error:", error.message);
    res.status(error.statusCode || 401).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Unable to launch app</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>Unable to launch the app</h1>
          <p>${error.message}</p>
          <p style="color: #999; font-size: 14px;">If the problem persists, reinstall the app.</p>
        </body>
      </html>
    `);
  }
};

module.exports = {
  handleLoad,
};

