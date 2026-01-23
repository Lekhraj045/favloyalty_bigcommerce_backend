const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Import database config to establish connection
const connectDB = async () => {
  const {
    DB_HOST = "localhost",
    DB_PORT = 27017,
    DB_USER,
    DB_PASSWORD,
    DB_NAME = "bigcommerce_app",
    MONGODB_URI,
  } = process.env;

  let connectionString;
  if (MONGODB_URI) {
    connectionString = MONGODB_URI;
  } else {
    connectionString = "mongodb://";
    if (DB_USER && DB_PASSWORD) {
      connectionString += `${DB_USER}:${DB_PASSWORD}@`;
    }
    connectionString += `${DB_HOST}:${DB_PORT}/${DB_NAME}`;
  }

  try {
    await mongoose.connect(connectionString);
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

const seedPlansFromJson = async () => {
  try {
    // Read the JSON file - use command line argument or default path
    const jsonPath =
      process.argv[2] || "C:\\Users\\DeskMoz\\Desktop\\test.plans.json";

    if (!fs.existsSync(jsonPath)) {
      throw new Error(
        `Could not find test.plans.json file at: ${jsonPath}\nUsage: node seedPlansFromJson.js [path-to-plans.json]`
      );
    }

    console.log(`📂 Reading plans from: ${jsonPath}`);
    const jsonData = fs.readFileSync(jsonPath, "utf8");
    const plansData = JSON.parse(jsonData);

    // Import Plan model
    const Plan = require("../models/Plan");

    console.log(`📥 Found ${plansData.length} plans in JSON file`);

    // Seed each plan
    for (const planData of plansData) {
      // Remove MongoDB-specific fields that shouldn't be in the update
      const { _id, __v, ...planUpdate } = planData;

      // Use findOneAndUpdate with upsert to create or update
      const plan = await Plan.findOneAndUpdate(
        { name: planUpdate.name },
        planUpdate,
        {
          upsert: true,
          new: true,
          runValidators: true,
        }
      );

      console.log(`✅ Plan "${plan.name}" seeded successfully`);
    }

    console.log("✅ All plans seeded successfully from JSON file");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding plans from JSON:", error.message);
    console.error(error);
    process.exit(1);
  }
};

// Run the script
(async () => {
  await connectDB();
  await seedPlansFromJson();
  await mongoose.connection.close();
})();
