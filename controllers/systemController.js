const db = require("../config/database");

const getRoot = (req, res) => {
  res.json({
    message: "BigCommerce App Server is running!",
    environment: process.env.NODE_ENV,
    port: process.env.PORT || 3000,
  });
};

const getHealth = async (req, res) => {
  try {
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
};

module.exports = {
  getRoot,
  getHealth,
};

