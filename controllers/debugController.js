const Store = require("../models/Store");

const listStores = async (req, res) => {
  try {
    const stores = await Store.findAll();

    res.json({
      totalStores: stores.length,
      stores: stores.map((store) => ({
        storeHash: store.store_hash,
        userEmail: store.user_email,
        installedAt: store.installed_at,
        updatedAt: store.updated_at,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  listStores,
};
