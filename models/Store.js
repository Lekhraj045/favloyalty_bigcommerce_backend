const db = require("../config/database");

class Store {
  // Save store data after OAuth
  static async create(storeData) {
    const { storeHash, accessToken, scope, user } = storeData;

    try {
      const [result] = await db.execute(
        `INSERT INTO stores (store_hash, access_token, scope, user_id, user_email)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE 
         access_token = VALUES(access_token),
         scope = VALUES(scope),
         user_id = VALUES(user_id),
         user_email = VALUES(user_email),
         updated_at = CURRENT_TIMESTAMP`,
        [storeHash, accessToken, scope, user.id, user.email]
      );

      console.log("✅ Store data saved to database:", storeHash);
      return result;
    } catch (error) {
      console.error("❌ Error saving store:", error.message);
      throw error;
    }
  }

  // Get store by store hash
  static async findByHash(storeHash) {
    try {
      const [rows] = await db.execute(
        "SELECT * FROM stores WHERE store_hash = ?",
        [storeHash]
      );

      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      console.error("❌ Error finding store:", error.message);
      throw error;
    }
  }

  // Get all stores
  static async findAll() {
    try {
      const [rows] = await db.execute(
        "SELECT * FROM stores ORDER BY installed_at DESC"
      );
      return rows;
    } catch (error) {
      console.error("❌ Error getting all stores:", error.message);
      throw error;
    }
  }

  // Delete store (on uninstall)
  static async delete(storeHash) {
    try {
      const [result] = await db.execute(
        "DELETE FROM stores WHERE store_hash = ?",
        [storeHash]
      );

      console.log("✅ Store deleted from database:", storeHash);
      return result;
    } catch (error) {
      console.error("❌ Error deleting store:", error.message);
      throw error;
    }
  }

  // Update access token
  static async updateToken(storeHash, newAccessToken) {
    try {
      const [result] = await db.execute(
        "UPDATE stores SET access_token = ?, updated_at = CURRENT_TIMESTAMP WHERE store_hash = ?",
        [newAccessToken, storeHash]
      );

      console.log("✅ Access token updated for store:", storeHash);
      return result;
    } catch (error) {
      console.error("❌ Error updating token:", error.message);
      throw error;
    }
  }
}

module.exports = Store;
