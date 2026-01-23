const axios = require("axios");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const mongoose = require("mongoose");

// Get products from BigCommerce API
const getProducts = async (req, res, next) => {
  try {
    const { storeId, channelId, keyword, limit = 50, page = 1 } = req.query;

    if (!storeId) {
      return res.status(400).json({
        success: false,
        message: "Store ID is required",
      });
    }

    // Validate storeId format
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Store ID format",
      });
    }

    // Get store details
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found",
      });
    }

    // Build BigCommerce API URL
    let apiUrl = `https://api.bigcommerce.com/stores/${store.store_hash}/v3/catalog/products`;
    
    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.append("limit", limit.toString());
    queryParams.append("page", page.toString());
    queryParams.append("include", "primary_image,channels");
    
    // Filter by channel if channelId is provided
    if (channelId) {
      // Get channel details to get BigCommerce channel_id
      const channel = await Channel.findOne({
        store_id: store._id,
        _id: channelId,
      });
      
      if (channel && channel.channel_id) {
        queryParams.append("channel_id", channel.channel_id.toString());
      }
    }
    
    // Add keyword search if provided
    if (keyword && keyword.trim()) {
      queryParams.append("keyword", keyword.trim());
    }

    // Make request to BigCommerce API
    const response = await axios.get(`${apiUrl}?${queryParams.toString()}`, {
      headers: {
        "X-Auth-Token": store.access_token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    // Format products for frontend
    const products = (response.data.data || []).map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku || "",
      price: product.price || "0.00",
      description: product.description || "",
      imageUrl: product.primary_image?.url_standard || product.images?.[0]?.url_standard || "",
      url: product.custom_url?.url || "",
      isVisible: product.is_visible || false,
      type: product.type || "physical",
    }));

    res.json({
      success: true,
      data: products,
      meta: response.data.meta || {},
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    
    if (error.response) {
      return res.status(error.response.status || 500).json({
        success: false,
        message: error.response.data?.title || "Failed to fetch products",
        error: error.response.data,
      });
    }
    
    next(error);
  }
};

module.exports = {
  getProducts,
};

