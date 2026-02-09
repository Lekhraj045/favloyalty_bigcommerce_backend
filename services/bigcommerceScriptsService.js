/**
 * BigCommerce Scripts API service
 * Create/delete FavLoyalty widget scripts when setup is complete or reverted.
 * @see https://developer.bigcommerce.com/docs/rest-management/scripts
 *
 * Required OAuth scope: "Content" (Manage store content). For visibility "all_pages",
 * "Checkout content" is also required. Ensure your BigCommerce app has these scopes.
 */

const axios = require("axios");
const Channel = require("../models/Channel");
const WidgetCustomization = require("../models/WidgetCustomization");

const WIDGET_LOADER_SRC =
  process.env.WIDGET_LOADER_SCRIPT_URL ||
  "https://favloyaltybigcommercewidget.share.zrok.io/widget-loader.js";

const WIDGET_BUTTON_TO_POSITION = {
  "Top-Left": "top-left",
  "Top-Right": "top-right",
  "Bottom-Left": "bottom-left",
  "Bottom-Right": "bottom-right",
};

/**
 * Create a FavLoyalty widget script for a channel via BigCommerce Scripts API.
 * @param {object} store - Store model instance ({ store_hash, access_token, _id })
 * @param {object} channel - Channel model instance ({ channel_id, _id })
 * @returns {Promise<string|null>} Script uuid or null on failure
 */
async function createScriptForChannel(store, channel) {
  const bcChannelId = channel.channel_id; // BigCommerce numeric channel ID
  const url = `https://api.bigcommerce.com/stores/${store.store_hash}/v3/content/scripts`;

  const baseSrc = WIDGET_LOADER_SRC.replace(/\?.*$/, "");
  const params = new URLSearchParams();
  params.set("store_hash", store.store_hash);
  if (process.env.CLIENT_ID) params.set("app_client_id", process.env.CLIENT_ID);
  if (channel._id) params.set("channel_id", channel._id.toString());
  if (process.env.APP_URL)
    params.set("api_url", process.env.APP_URL.replace(/\/$/, ""));

  // Include placement from "Placement of widget on your website" so launcher position works without waiting for channel-settings fetch
  try {
    const customization = await WidgetCustomization.findByStoreAndChannel(
      store._id,
      channel._id
    );
    const widgetButton = customization?.widgetButton || "Bottom-Right";
    const position = WIDGET_BUTTON_TO_POSITION[widgetButton] || "bottom-right";
    params.set("position", position);
  } catch (e) {
    params.set("position", "bottom-right");
  }

  const scriptSrc = params.toString()
    ? baseSrc + "?" + params.toString()
    : baseSrc;

  const body = {
    name: "FavLoyalty Widget",
    description: "FavLoyalty storefront widget loader",
    src: scriptSrc,
    auto_uninstall: true,
    load_method: "default",
    location: "footer",
    visibility: "all_pages",
    kind: "src",
    consent_category: "essential",
    channel_id: bcChannelId,
    enabled: true,
  };

  try {
    const res = await axios.post(url, body, {
      headers: {
        "X-Auth-Token": store.access_token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    const uuid = res.data?.data?.uuid ?? null;
    if (uuid) {
      console.log(
        `✅ FavLoyalty script created for channel ${channel._id} (BC ${bcChannelId}), uuid=${uuid}`,
      );
    }
    return uuid;
  } catch (err) {
    console.error(
      `❌ BigCommerce create script failed for channel ${channel._id}:`,
      err.response?.data ?? err.message,
    );
    return null;
  }
}

/**
 * Get a script's src URL from BigCommerce (to check if it has required query params).
 * @param {object} store - Store model instance ({ store_hash, access_token })
 * @param {string} uuid - Script uuid
 * @returns {Promise<string|null>} Script src URL or null
 */
async function getScriptSrc(store, uuid) {
  if (!uuid || typeof uuid !== "string") return null;
  const url = `https://api.bigcommerce.com/stores/${store.store_hash}/v3/content/scripts/${uuid}`;
  try {
    const res = await axios.get(url, {
      headers: {
        "X-Auth-Token": store.access_token,
        Accept: "application/json",
      },
    });
    return res.data?.data?.src ?? null;
  } catch (err) {
    return null;
  }
}

/**
 * Delete a FavLoyalty widget script from BigCommerce.
 * @param {object} store - Store model instance ({ store_hash, access_token })
 * @param {object} channel - Channel model instance ({ script_id, _id })
 * @returns {Promise<boolean>} true if deleted (or 404/401), false on other errors
 * 
 * NOTE: Returns true for 401 errors because during app uninstall, BigCommerce
 * revokes the access token but also auto-removes all scripts for the app.
 */
async function deleteScriptForChannel(store, channel) {
  const uuid = channel.script_id;
  if (!uuid || typeof uuid !== "string") {
    return true;
  }

  const url = `https://api.bigcommerce.com/stores/${store.store_hash}/v3/content/scripts/${uuid}`;

  try {
    await axios.delete(url, {
      headers: {
        "X-Auth-Token": store.access_token,
        Accept: "application/json",
      },
    });
    console.log(
      `✅ FavLoyalty script deleted for channel ${channel._id}, uuid=${uuid}`,
    );
    return true;
  } catch (err) {
    const status = err.response?.status;
    
    // 404: Script already removed
    if (status === 404) {
      console.log(
        `ℹ️ Script ${uuid} already removed for channel ${channel._id}`,
      );
      return true;
    }
    
    // 401: Token revoked (expected during uninstall) - BigCommerce auto-removes scripts
    if (status === 401) {
      console.log(
        `ℹ️ Token revoked - BigCommerce will auto-remove script ${uuid} for channel ${channel._id}`,
      );
      return true;
    }
    
    console.error(
      `❌ BigCommerce delete script failed for channel ${channel._id}:`,
      err.response?.data ?? err.message,
    );
    return false;
  }
}

/**
 * Sync BigCommerce script with channel state:
 * - If setupprogress === 4 && widget_visibility === true: create script (if none), save uuid.
 * - Otherwise: delete script (if any), set script_id to null.
 * @param {object} store - Store model instance
 * @param {object} updatedChannel - Channel doc after update (plain or mongoose doc)
 */
async function syncChannelScript(store, updatedChannel) {
  const progress = updatedChannel.setupprogress ?? 0;
  const visible =
    typeof updatedChannel.widget_visibility === "boolean"
      ? updatedChannel.widget_visibility
      : false;
  const eligible = progress === 4 && visible;
  const channelId =
    typeof updatedChannel._id === "string"
      ? updatedChannel._id
      : updatedChannel._id?.toString();

  try {
    if (eligible) {
      if (!updatedChannel.script_id) {
        const uuid = await createScriptForChannel(store, updatedChannel);
        if (uuid) {
          await Channel.findByIdAndUpdate(channelId, {
            $set: { script_id: uuid },
          });
        }
      } else {
        // Existing script: ensure it has store_hash (and other params) so the loader gets config
        const currentSrc = await getScriptSrc(store, updatedChannel.script_id);
        if (currentSrc && currentSrc.indexOf("store_hash=") === -1) {
          const deleted = await deleteScriptForChannel(store, updatedChannel);
          if (deleted) {
            const newUuid = await createScriptForChannel(store, updatedChannel);
            if (newUuid) {
              await Channel.findByIdAndUpdate(channelId, {
                $set: { script_id: newUuid },
              });
              console.log(
                `✅ FavLoyalty script re-created for channel ${channelId} with config params`,
              );
            }
          }
        }
      }
    } else {
      if (updatedChannel.script_id) {
        const deleted = await deleteScriptForChannel(store, updatedChannel);
        if (deleted) {
          await Channel.findByIdAndUpdate(channelId, {
            $set: { script_id: null },
          });
        }
      }
    }
  } catch (e) {
    console.error(
      `❌ syncChannelScript failed for channel ${channelId}:`,
      e.message,
    );
  }
}

/**
 * Re-create the widget script for a channel so the script URL gets the latest
 * placement (and other params) from WidgetCustomization. Call when widget customization is saved.
 * @param {object} store - Store model instance
 * @param {object} channel - Channel model instance (with script_id if script exists)
 * @returns {Promise<void>}
 */
async function recreateScriptForChannel(store, channel) {
  try {
    if (channel.script_id) {
      await deleteScriptForChannel(store, channel);
      await Channel.findByIdAndUpdate(channel._id, { $set: { script_id: null } });
    }
    const uuid = await createScriptForChannel(store, channel);
    if (uuid) {
      await Channel.findByIdAndUpdate(channel._id, { $set: { script_id: uuid } });
    }
  } catch (e) {
    console.error(
      `❌ recreateScriptForChannel failed for channel ${channel._id}:`,
      e.message,
    );
  }
}

module.exports = {
  createScriptForChannel,
  deleteScriptForChannel,
  getScriptSrc,
  syncChannelScript,
  recreateScriptForChannel,
};
