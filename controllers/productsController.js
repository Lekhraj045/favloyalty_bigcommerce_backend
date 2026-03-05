const axios = require("axios");
const Store = require("../models/Store");
const Channel = require("../models/Channel");
const mongoose = require("mongoose");

/**
 * Get the storefront base URL for a specific channel.
 * Each BigCommerce channel (e.g. Catalyst, Stencil, headless) can have its own storefront URL.
 * Uses cached channel.site_url if available; otherwise fetches from BigCommerce
 * GET /v3/channels/{channel_id}/site API, caches it, and returns it.
 * Falls back to the store-level secure_url from GET /v2/store if no channel site is found.
 *
 * @param {Object} store - Mongoose Store document (needs store_hash, access_token)
 * @param {Object|null} channel - Mongoose Channel document (needs channel_id). Optional.
 * @returns {string} The storefront base URL without trailing slash, or empty string.
 */
const getStorefrontBase = async (store, channel = null) => {
  if (!store) return "";

  const bcHeaders = {
    "X-Auth-Token": store.access_token,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // 1. Try channel-specific site URL (preferred — each channel can have its own storefront)
  if (channel) {
    // Return cached value if already populated
    if (channel.site_url) {
      return channel.site_url.replace(/\/$/, "");
    }

    // Fetch from BigCommerce Channel Site API
    if (channel.channel_id != null) {
      try {
        const siteRes = await axios.get(
          `https://api.bigcommerce.com/stores/${store.store_hash}/v3/channels/${channel.channel_id}/site`,
          { headers: bcHeaders }
        );

        const siteUrl = siteRes.data?.data?.url || "";
        if (siteUrl) {
          // Cache on the channel record
          channel.site_url = siteUrl;
          await channel.save();
          return siteUrl.replace(/\/$/, "");
        }
      } catch (error) {
        // 404 means no site configured for this channel — fall through to store-level URL
        if (error.response?.status !== 404) {
          console.error(
            `Error fetching channel ${channel.channel_id} site URL:`,
            error.message
          );
        }
      }
    }
  }

  // 2. Fall back to store-level URL
  if (store.store_url) {
    return store.store_url.replace(/\/$/, "");
  }
  if (store.store_domain) {
    return store.store_domain.replace(/\/$/, "");
  }

  // Fetch store-level URL from BigCommerce V2 Store Information API and cache it
  try {
    const response = await axios.get(
      `https://api.bigcommerce.com/stores/${store.store_hash}/v2/store`,
      { headers: bcHeaders }
    );

    const secureUrl = response.data?.secure_url || "";
    const domain = response.data?.domain || "";

    if (secureUrl || domain) {
      store.store_url = secureUrl || null;
      store.store_domain = domain || null;
      await store.save();
    }

    return (secureUrl || domain || "").replace(/\/$/, "");
  } catch (error) {
    console.error(
      "Error fetching store info for storefront URL:",
      error.message
    );
    return "";
  }
};

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
    // Only products visible on the storefront — so coupons are only for products customers can find and buy
    queryParams.append("is_visible", "true");

    // Resolve the channel document so we can use it for both filtering and storefront URL
    let resolvedChannel = null;
    if (channelId) {
      if (
        mongoose.Types.ObjectId.isValid(channelId) &&
        String(channelId).length === 24
      ) {
        resolvedChannel = await Channel.findOne({
          store_id: store._id,
          _id: channelId,
        });
      }
      if (!resolvedChannel && /^\d+$/.test(String(channelId).trim())) {
        resolvedChannel = await Channel.findOne({
          store_id: store._id,
          channel_id: Number(channelId),
        });
      }
      // Catalog API expects channel_id:in (comma-separated list) to filter by channel
      if (resolvedChannel && resolvedChannel.channel_id != null) {
        queryParams.append(
          "channel_id:in",
          resolvedChannel.channel_id.toString()
        );
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

    // Get channel-specific storefront base URL (fetches from BC API and caches if not yet stored)
    const storefrontBase = await getStorefrontBase(store, resolvedChannel);

    // Format products for frontend; only include products visible on storefront (API param + client filter as backup)
    const rawProducts = response.data.data || [];
    const products = rawProducts
      .filter((product) => product.is_visible === true)
      .map((product) => {
        const relativePath = product.custom_url?.url || "";
        const fullUrl =
          relativePath && storefrontBase
            ? `${storefrontBase}${relativePath}`
            : relativePath;

        return {
          id: product.id,
          name: product.name,
          sku: product.sku || "",
          price: product.price || "0.00",
          description: product.description || "",
          imageUrl:
            product.primary_image?.url_standard ||
            product.images?.[0]?.url_standard ||
            "",
          url: fullUrl,
          isVisible: true,
          type: product.type || "physical",
        };
      });

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
  getStorefrontBase,
};
