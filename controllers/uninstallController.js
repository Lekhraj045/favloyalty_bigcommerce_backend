const jwt = require("jsonwebtoken");
const Store = require("../models/Store");

const handleUninstall = async (req, res) => {
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

    await Store.delete(storeHash);

    console.log("✅ App uninstalled for store:", storeHash);

    res.status(200).send("App uninstalled successfully");
  } catch (error) {
    console.error("❌ Uninstall Error:", error.message);
    res.status(500).send("Uninstall failed");
  }
};

module.exports = {
  handleUninstall,
};

