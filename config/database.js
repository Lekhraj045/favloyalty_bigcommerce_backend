const mongoose = require("mongoose");

// Build MongoDB connection string
const getConnectionString = () => {
  const {
    DB_HOST = "localhost",
    DB_PORT = 27017,
    DB_USER,
    DB_PASSWORD,
    DB_NAME = "bigcommerce_app",
    MONGODB_URI, // Alternative: use full connection string
  } = process.env;

  // If MONGODB_URI is provided, use it directly
  if (MONGODB_URI) {
    console.log("🔗 Using MONGODB_URI from environment");
    return MONGODB_URI;
  }

  // Validate DB_NAME is provided
  const dbName = DB_NAME || "bigcommerce_app";
  if (!DB_NAME) {
    console.warn("⚠️ DB_NAME not provided, using default: bigcommerce_app");
  }

  // Build connection string from individual components
  let connectionString = "mongodb://";

  if (DB_USER && DB_PASSWORD) {
    connectionString += `${DB_USER}:${DB_PASSWORD}@`;
  }

  connectionString += `${DB_HOST}:${DB_PORT}/${dbName}`;

  // Add options
  const options = [];
  if (process.env.DB_AUTH_SOURCE) {
    options.push(`authSource=${process.env.DB_AUTH_SOURCE}`);
  }

  if (options.length > 0) {
    connectionString += `?${options.join("&")}`;
  }

  // Log connection string (hide credentials)
  const logString = connectionString.replace(/\/\/.*@/, "//***:***@");
  console.log(`🔗 MongoDB Connection String: ${logString}`);
  console.log(`📊 Target Database Name: ${dbName}`);

  return connectionString;
};

// Connect to MongoDB
const connectDB = async () => {
  try {
    const connectionString = getConnectionString();
    const options = {
      // Modern Mongoose options
    };

    await mongoose.connect(connectionString, options);

    // Get the actual database name from the connection
    const dbName = mongoose.connection.db.databaseName;
    const connectionState = mongoose.connection.readyState;
    const stateNames = {
      0: "disconnected",
      1: "connected",
      2: "connecting",
      3: "disconnecting",
    };

    console.log("✅ MongoDB Database connected successfully");
    console.log(`📊 Database Name: ${dbName}`);
    console.log(
      `📊 Connection State: ${stateNames[connectionState] || connectionState}`
    );
    console.log(`📊 Host: ${mongoose.connection.host}`);
    console.log(`📊 Port: ${mongoose.connection.port}`);

    // Note: Database will be created automatically on first write
    console.log(
      "ℹ️  Note: Database will be created automatically when first document is saved"
    );

    // Handle connection events
    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB connection error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️ MongoDB disconnected");
    });

    mongoose.connection.on("reconnected", () => {
      console.log("✅ MongoDB reconnected");
    });
  } catch (error) {
    console.error("❌ MongoDB Database connection failed:", error.message);
    console.error("❌ Full error:", error);
    process.exit(1);
  }
};

// Call connect on module load
connectDB();

module.exports = mongoose;
