const Point = require("../models/Point");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "../uploads/logos");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "logo-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    if (file.mimetype === "image/svg+xml") {
      cb(null, true);
    } else {
      cb(new Error("Only SVG files are allowed"), false);
    }
  },
});

// Middleware for handling file upload
const uploadLogo = upload.single("logoImage");

// Save points configuration
const savePoints = async (req, res, next) => {
  uploadLogo(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    try {
      const { storeId, channelId, pointName, expiry, tierStatus } = req.body;
      let { expiriesInDays, logo, customLogo, customPointName, tier } = req.body;

      // Validate required fields
      if (!storeId || !channelId || !pointName) {
        return res.status(400).json({
          success: false,
          message: "Store ID, Channel ID, and Point Name are required",
        });
      }

      // Convert string IDs to ObjectIds
      const storeObjectId = new mongoose.Types.ObjectId(storeId);
      const channelObjectId = new mongoose.Types.ObjectId(channelId);

      // Verify store and channel exist
      const store = await Store.findById(storeObjectId);
      if (!store) {
        return res.status(404).json({
          success: false,
          message: "Store not found",
        });
      }

      const channel = await Channel.findById(channelObjectId);
      if (!channel) {
        return res.status(404).json({
          success: false,
          message: "Channel not found",
        });
      }

      // Parse JSON strings if they exist
      if (typeof logo === "string") {
        try {
          logo = JSON.parse(logo);
        } catch (e) {
          logo = null;
        }
      }

      if (typeof customLogo === "string") {
        try {
          customLogo = JSON.parse(customLogo);
        } catch (e) {
          customLogo = null;
        }
      }

      if (typeof customPointName === "string") {
        try {
          customPointName = JSON.parse(customPointName);
        } catch (e) {
          customPointName = [];
        }
      }

      if (typeof tier === "string") {
        try {
          tier = JSON.parse(tier);
        } catch (e) {
          tier = [];
        }
      }

      // Handle uploaded logo file
      if (req.file) {
        const logoUrl = `/uploads/logos/${req.file.filename}`;
        customLogo = {
          src: logoUrl,
          name: req.file.filename,
        };
      }

      // Prepare point data
      const pointData = {
        store_id: storeObjectId,
        channel_id: channelObjectId,
        pointName: pointName,
        expiry: expiry === "true" || expiry === true,
        tierStatus: tierStatus === "true" || tierStatus === true,
      };

      if (pointData.expiry && expiriesInDays) {
        pointData.expiriesInDays = parseInt(expiriesInDays);
      }

      if (logo) {
        pointData.logo = logo;
      }

      if (customLogo) {
        pointData.customLogo = customLogo;
      }

      if (customPointName && Array.isArray(customPointName) && customPointName.length > 0) {
        pointData.customPointName = customPointName;
      }

      if (pointData.tierStatus && tier && Array.isArray(tier) && tier.length > 0) {
        pointData.tier = tier;
      }

      // Check if points already exist for this store and channel
      const existingPoint = await Point.findOne({
        store_id: storeObjectId,
        channel_id: channelObjectId,
      });

      let savedPoint;
      if (existingPoint) {
        // Update existing point
        Object.assign(existingPoint, pointData);
        savedPoint = await existingPoint.save();
      } else {
        // Create new point
        savedPoint = await Point.create(pointData);
      }

      res.json({
        success: true,
        message: "Points configuration saved successfully",
        data: {
          _id: savedPoint._id.toString(),
          ...savedPoint.toObject(),
        },
      });
    } catch (error) {
      console.error("Error saving points:", error);
      next(error);
    }
  });
};

// Update points configuration
const updatePoints = async (req, res, next) => {
  uploadLogo(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    try {
      const { pointId } = req.params;
      const { pointName, expiry, tierStatus } = req.body;
      let { expiriesInDays, logo, customLogo, customPointName, tier } = req.body;

      if (!pointId) {
        return res.status(400).json({
          success: false,
          message: "Point ID is required",
        });
      }

      const pointObjectId = new mongoose.Types.ObjectId(pointId);
      const point = await Point.findById(pointObjectId);

      if (!point) {
        return res.status(404).json({
          success: false,
          message: "Point configuration not found",
        });
      }

      // Parse JSON strings if they exist
      if (typeof logo === "string") {
        try {
          logo = JSON.parse(logo);
        } catch (e) {
          logo = null;
        }
      }

      if (typeof customLogo === "string") {
        try {
          customLogo = JSON.parse(customLogo);
        } catch (e) {
          customLogo = null;
        }
      }

      if (typeof customPointName === "string") {
        try {
          customPointName = JSON.parse(customPointName);
        } catch (e) {
          customPointName = [];
        }
      }

      if (typeof tier === "string") {
        try {
          tier = JSON.parse(tier);
        } catch (e) {
          tier = [];
        }
      }

      // Handle uploaded logo file
      if (req.file) {
        const logoUrl = `/uploads/logos/${req.file.filename}`;
        customLogo = {
          src: logoUrl,
          name: req.file.filename,
        };
      }

      // Update point data
      if (pointName) point.pointName = pointName;
      if (expiry !== undefined) {
        point.expiry = expiry === "true" || expiry === true;
      }
      if (tierStatus !== undefined) {
        point.tierStatus = tierStatus === "true" || tierStatus === true;
      }

      if (point.expiry && expiriesInDays) {
        point.expiriesInDays = parseInt(expiriesInDays);
      } else if (!point.expiry) {
        point.expiriesInDays = null;
      }

      if (logo) {
        point.logo = logo;
      }

      if (customLogo) {
        point.customLogo = customLogo;
      }

      if (customPointName && Array.isArray(customPointName)) {
        point.customPointName = customPointName;
      }

      if (point.tierStatus && tier && Array.isArray(tier)) {
        point.tier = tier;
      } else if (!point.tierStatus) {
        point.tier = [];
      }

      const updatedPoint = await point.save();

      res.json({
        success: true,
        message: "Points configuration updated successfully",
        data: updatedPoint,
      });
    } catch (error) {
      console.error("Error updating points:", error);
      next(error);
    }
  });
};

// Get points configuration
const getPoints = async (req, res, next) => {
  try {
    const { storeId, channelId } = req.query;

    if (!storeId || !channelId) {
      return res.status(400).json({
        success: false,
        message: "Store ID and Channel ID are required",
      });
    }

    const storeObjectId = new mongoose.Types.ObjectId(storeId);
    const channelObjectId = new mongoose.Types.ObjectId(channelId);

    const point = await Point.findOne({
      store_id: storeObjectId,
      channel_id: channelObjectId,
    });

    if (!point) {
      return res.status(404).json({
        success: false,
        message: "Points configuration not found",
      });
    }

    // Transform database response to match PointData interface expected by frontend
    const pointData = {
      _id: point._id.toString(), // Include ID for updates
      pointName: point.pointName,
      expiry: point.expiry || false,
      expiriesInDays: point.expiriesInDays || undefined,
      tierStatus: point.tierStatus || false,
      logo: point.logo || undefined,
      customLogo: point.customLogo || undefined,
      customPointName: point.customPointName && point.customPointName.length > 0 
        ? point.customPointName 
        : undefined,
      tier: point.tier && point.tier.length > 0 ? point.tier : undefined,
    };

    // Remove undefined fields (but keep _id)
    Object.keys(pointData).forEach(key => {
      if (pointData[key] === undefined && key !== '_id') {
        delete pointData[key];
      }
    });

    res.json(pointData);
  } catch (error) {
    console.error("Error getting points:", error);
    next(error);
  }
};

module.exports = {
  savePoints,
  updatePoints,
  getPoints,
};

