const axios = require("axios");
const Store = require("../models/Store");

/**
 * BigCommerce Webhook Service
 * Handles all webhook-related API calls to BigCommerce
 */

/**
 * Create a webhook subscription in BigCommerce
 * @param {string} storeHash - Store hash identifier
 * @param {string} accessToken - BigCommerce access token
 * @param {string} scope - Webhook scope (e.g., "store/order/statusUpdated")
 * @param {string} destination - Webhook destination URL
 * @returns {Promise<Object>} Created webhook object
 */
const createWebhook = async (storeHash, accessToken, scope, destination) => {
  try {
    console.log(`🔄 Creating webhook for scope: ${scope}`);

    const response = await axios.post(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/hooks`,
      {
        scope: scope,
        destination: destination,
        is_active: true,
      },
      {
        headers: {
          "X-Auth-Token": accessToken,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    console.log(`✅ Webhook created successfully:`, response.data.id);
    return response.data;
  } catch (error) {
    console.error("❌ Error creating webhook:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    throw error;
  }
};

/**
 * Get all webhooks for a store
 * @param {string} storeHash - Store hash identifier
 * @param {string} accessToken - BigCommerce access token
 * @param {Object} options - Optional settings
 * @param {boolean} options.silentOnAuthError - If true, return empty array on 401 instead of throwing
 * @returns {Promise<Array>} Array of webhook objects
 */
const getWebhooks = async (storeHash, accessToken, options = {}) => {
  try {
    console.log(`🔄 Fetching webhooks for store: ${storeHash}`);

    const response = await axios.get(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/hooks`,
      {
        headers: {
          "X-Auth-Token": accessToken,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    console.log(`✅ Fetched ${response.data.length} webhooks`);
    return response.data;
  } catch (error) {
    const status = error.response?.status;
    
    // 401: Token revoked - expected during uninstall
    // BigCommerce auto-removes webhooks when app is uninstalled
    if (status === 401 && options.silentOnAuthError) {
      console.log(`ℹ️ Token revoked for store ${storeHash} - BigCommerce will auto-cleanup webhooks`);
      return []; // Return empty array to indicate "nothing to process"
    }
    
    console.error("❌ Error fetching webhooks:", {
      message: error.message,
      response: error.response?.data,
      status: status,
    });
    throw error;
  }
};

/**
 * Get a specific webhook by ID
 * @param {string} storeHash - Store hash identifier
 * @param {string} accessToken - BigCommerce access token
 * @param {number} webhookId - Webhook ID
 * @returns {Promise<Object>} Webhook object
 */
const getWebhookById = async (storeHash, accessToken, webhookId) => {
  try {
    console.log(`🔄 Fetching webhook ${webhookId} for store: ${storeHash}`);

    const response = await axios.get(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/hooks/${webhookId}`,
      {
        headers: {
          "X-Auth-Token": accessToken,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    console.log(`✅ Webhook fetched successfully`);
    return response.data;
  } catch (error) {
    console.error("❌ Error fetching webhook:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    throw error;
  }
};

/**
 * Update a webhook
 * @param {string} storeHash - Store hash identifier
 * @param {string} accessToken - BigCommerce access token
 * @param {number} webhookId - Webhook ID
 * @param {Object} updateData - Data to update
 * @returns {Promise<Object>} Updated webhook object
 */
const updateWebhook = async (storeHash, accessToken, webhookId, updateData) => {
  try {
    console.log(`🔄 Updating webhook ${webhookId} for store: ${storeHash}`);

    const response = await axios.put(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/hooks/${webhookId}`,
      updateData,
      {
        headers: {
          "X-Auth-Token": accessToken,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    console.log(`✅ Webhook updated successfully`);
    return response.data;
  } catch (error) {
    console.error("❌ Error updating webhook:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    throw error;
  }
};

/**
 * Delete a webhook
 * @param {string} storeHash - Store hash identifier
 * @param {string} accessToken - BigCommerce access token
 * @param {number} webhookId - Webhook ID
 * @returns {Promise<void>}
 */
const deleteWebhook = async (storeHash, accessToken, webhookId) => {
  try {
    console.log(`🔄 Deleting webhook ${webhookId} for store: ${storeHash}`);

    await axios.delete(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/hooks/${webhookId}`,
      {
        headers: {
          "X-Auth-Token": accessToken,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    console.log(`✅ Webhook deleted successfully`);
  } catch (error) {
    console.error("❌ Error deleting webhook:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    throw error;
  }
};

/**
 * Check if a webhook exists for a given scope
 * @param {string} storeHash - Store hash identifier
 * @param {string} accessToken - BigCommerce access token
 * @param {string} scope - Webhook scope
 * @returns {Promise<Object|null>} Webhook object if found, null otherwise
 */
const findWebhookByScope = async (storeHash, accessToken, scope) => {
  try {
    const webhooks = await getWebhooks(storeHash, accessToken);
    return webhooks.find((hook) => hook.scope === scope) || null;
  } catch (error) {
    console.error("❌ Error finding webhook by scope:", error.message);
    throw error;
  }
};

/**
 * Create or update webhook for a scope
 * @param {string} storeHash - Store hash identifier
 * @param {string} accessToken - BigCommerce access token
 * @param {string} scope - Webhook scope
 * @param {string} destination - Webhook destination URL
 * @returns {Promise<Object>} Webhook object
 */
const createOrUpdateWebhook = async (
  storeHash,
  accessToken,
  scope,
  destination
) => {
  try {
    const existingWebhook = await findWebhookByScope(
      storeHash,
      accessToken,
      scope
    );

    if (existingWebhook) {
      // Update existing webhook
      return await updateWebhook(storeHash, accessToken, existingWebhook.id, {
        destination: destination,
        is_active: true,
      });
    } else {
      // Create new webhook
      return await createWebhook(storeHash, accessToken, scope, destination);
    }
  } catch (error) {
    console.error("❌ Error creating or updating webhook:", error.message);
    throw error;
  }
};

/**
 * Get a single order from BigCommerce (for webhook processing)
 * @param {string} storeHash - Store hash identifier
 * @param {string} accessToken - BigCommerce access token
 * @param {number} orderId - BigCommerce order ID
 * @returns {Promise<Object>} Order object (includes channel_id, customer_id, etc.)
 */
const getOrder = async (storeHash, accessToken, orderId) => {
  try {
    const response = await axios.get(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/orders/${orderId}`,
      {
        headers: {
          "X-Auth-Token": accessToken,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error("❌ Error fetching order:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    throw error;
  }
};

/**
 * Get coupons applied to an order (for marking loyalty redeem coupons as used).
 * @param {string} storeHash - Store hash identifier
 * @param {string} accessToken - BigCommerce access token
 * @param {number} orderId - BigCommerce order ID
 * @returns {Promise<Array<{ code: string }>>} Array of coupon objects with code
 */
const getOrderCoupons = async (storeHash, accessToken, orderId) => {
  try {
    const response = await axios.get(
      `https://api.bigcommerce.com/stores/${storeHash}/v2/orders/${orderId}/coupons`,
      {
        headers: {
          "X-Auth-Token": accessToken,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );
    const data = response.data;
    if (!Array.isArray(data)) return [];
    return data
      .map((c) => ({ code: c.code || c.coupon_code || "" }))
      .filter((c) => c.code);
  } catch (error) {
    console.warn("⚠️ getOrderCoupons failed:", orderId, error?.message);
    return [];
  }
};

/**
 * Get a single customer from BigCommerce (for webhook processing)
 * @param {string} storeHash - Store hash identifier
 * @param {string} accessToken - BigCommerce access token
 * @param {number} customerId - BigCommerce customer ID
 * @returns {Promise<Object|null>} Customer object (includes email, channel_ids, origin_channel_id, etc.) or null
 */
const getCustomer = async (storeHash, accessToken, customerId) => {
  try {
    const response = await axios.get(
      `https://api.bigcommerce.com/stores/${storeHash}/v3/customers?id:in=${customerId}`,
      {
        headers: {
          "X-Auth-Token": accessToken,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );
    if (
      response.data?.data &&
      Array.isArray(response.data.data) &&
      response.data.data.length > 0
    ) {
      return response.data.data[0];
    }
    return null;
  } catch (error) {
    console.error("❌ Error fetching customer:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    throw error;
  }
};

module.exports = {
  createWebhook,
  getWebhooks,
  getWebhookById,
  updateWebhook,
  deleteWebhook,
  findWebhookByScope,
  createOrUpdateWebhook,
  getOrder,
  getOrderCoupons,
  getCustomer,
};
