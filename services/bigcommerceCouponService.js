/**
 * BigCommerce V2 Coupons API – create coupon for loyalty redemption.
 * @see https://developer.bigcommerce.com/docs/rest-content/marketing/coupons
 */

const axios = require("axios");

/**
 * Create a coupon on BigCommerce (V2 Content API).
 * @param {Object} params
 * @param {string} params.storeHash - Store hash
 * @param {string} params.accessToken - Store access token
 * @param {string} params.name - Coupon name (e.g. "Loyalty: 50% off")
 * @param {string} params.code - Unique coupon code
 * @param {string} params.type - BC type: percentage_discount | per_total_discount | free_shipping
 * @param {string|number} params.amount - Discount amount (percentage or fixed)
 * @param {Object} [params.applies_to] - { entity: "products"|"categories", ids: number[] }
 * @param {string} [params.expires] - RFC 2822 date string
 * @param {string|number} [params.min_purchase] - Minimum order value
 * @param {number} [params.max_uses] - Max total uses (default 1)
 * @param {number} [params.max_uses_per_customer] - Max uses per customer (default 1)
 * @returns {Promise<{ id: number, code: string, ... }>} Created coupon from BC
 */
async function createCoupon({
  storeHash,
  accessToken,
  name,
  code,
  type,
  amount,
  applies_to,
  expires,
  min_purchase,
  max_uses = 1,
  max_uses_per_customer = 1,
}) {
  const url = `https://api.bigcommerce.com/stores/${storeHash}/v2/coupons`;
  const body = {
    name,
    code,
    type,
    amount: String(amount),
    enabled: true,
    max_uses: Number(max_uses) || 1,
    max_uses_per_customer: Number(max_uses_per_customer) || 1,
  };
  if (
    applies_to &&
    applies_to.entity &&
    Array.isArray(applies_to.ids) &&
    applies_to.ids.length > 0
  ) {
    body.applies_to = {
      entity: applies_to.entity,
      // BigCommerce V2 expects scalar numeric IDs, not objects
      ids: applies_to.ids.map((id) => Number(id)),
    };
  } else {
    // Default: all categories (store‑wide)
    body.applies_to = { entity: "categories", ids: [0] };
  }
  if (expires) body.expires = expires;
  if (min_purchase != null && min_purchase !== "")
    body.min_purchase = String(min_purchase);

  const response = await axios.post(url, body, {
    headers: {
      "X-Auth-Token": accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  return response.data;
}

/**
 * Get a single coupon by ID (to check num_uses for "used" status).
 * @param {string} storeHash
 * @param {string} accessToken
 * @param {number} couponId - BC coupon id
 * @returns {Promise<{ id: number, num_uses: number, max_uses: number, ... }>}
 */
async function getCoupon(storeHash, accessToken, couponId) {
  const url = `https://api.bigcommerce.com/stores/${storeHash}/v2/coupons/${couponId}`;
  const response = await axios.get(url, {
    headers: {
      "X-Auth-Token": accessToken,
      Accept: "application/json",
    },
  });
  return response.data;
}

module.exports = {
  createCoupon,
  getCoupon,
};
