require("dotenv").config();
const express = require("express");
const path = require("path");
const corsMiddleware = require("./middleware/cors");
const errorHandler = require("./middleware/errorHandler");
const registerRoutes = require("./routes");
const mongoose = require("./config/database"); // Changed from db to mongoose

// Import models to ensure they are registered with Mongoose
require("./models/Store");
require("./models/Channel");
require("./models/Point"); // This ensures the Point model is registered
require("./models/Plan"); // This ensures the Plan model is registered
require("./models/Customer"); // This ensures the Customer model is registered
require("./models/Transaction"); // This ensures the Transaction model is registered

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(corsMiddleware);
// Increase body parser limit to handle Base64 images in announcements (50MB limit)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Serve static files for uploaded logos
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    // Test MongoDB connection
    const connectionState = mongoose.connection.readyState;
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting

    if (connectionState !== 1) {
      throw new Error("MongoDB connection not ready");
    }

    // Simple ping to verify connection
    await mongoose.connection.db.admin().ping();

    res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      database: "connected",
      databaseType: "MongoDB",
      uptime: process.uptime(),
    });
  } catch (error) {
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      database: "disconnected",
      databaseType: "MongoDB",
      error: error.message,
    });
  }
});

// Register all routes
registerRoutes(app);

// Error handler (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log("=".repeat(50));
  console.log("🚀 BigCommerce App Server Started");
  console.log("=".repeat(50));
  console.log(`✅ Server URL: http://localhost:${PORT}`);
  console.log(`✅ Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`✅ Auth Callback: ${process.env.AUTH_CALLBACK}`);
  console.log(`✅ Frontend URL: ${process.env.FRONTEND_BASE_URL}`);
  console.log(`✅ Database: MongoDB - ${process.env.DB_NAME || "N/A"}`);
  console.log("=".repeat(50));
});

// Initialize background jobs after database connection
const initializeJobs = async () => {
  try {
    const queueManager = require("./queues/queueManager");
    await queueManager.initialize();
    console.log("✅ Background jobs initialized");
  } catch (error) {
    console.error("❌ Error initializing background jobs:", error);
    // Don't exit - let the app continue without jobs
  }
};

// Initialize jobs after database connection is ready
mongoose.connection.once("open", async () => {
  console.log("🔄 Database connected, initializing background jobs...");
  await initializeJobs();
});

// Graceful shutdown
const gracefulShutdown = async () => {
  try {
    const queueManager = require("./queues/queueManager");
    await queueManager.shutdown();
  } catch (error) {
    console.error("❌ Error shutting down queue manager:", error);
  }
  await mongoose.connection.close();
  process.exit(0);
};

process.on("SIGTERM", async () => {
  console.log("⚠️  SIGTERM received, shutting down gracefully...");
  await gracefulShutdown();
});

process.on("SIGINT", async () => {
  console.log("\n⚠️  SIGINT received, shutting down gracefully...");
  await gracefulShutdown();
});

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});
