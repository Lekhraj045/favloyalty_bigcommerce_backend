const mysql = require("mysql2/promise");

// Create a connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

// Test the connection
pool
  .getConnection()
  .then((connection) => {
    console.log("✅ MySQL Database connected successfully");
    connection.release();
  })
  .catch((err) => {
    console.error("❌ MySQL Database connection failed:", err.message);
  });

module.exports = pool;
