// backend/lib/db.js
const mysql = require("mysql2");
const fs = require("fs");

// EXACTLY the same env-driven config your index.js uses
const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 25060),
  user: String(process.env.DB_USER || "").trim(),
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    ca: fs.readFileSync(process.env.DB_CA_PATH || "/etc/ssl/certs/ca-certificates.crt")
  }
};

// Use a pool so both index.js and ussd.js can share connections
const pool = mysql.createPool(dbConfig);

// quick sanity check on boot (will show in logs once)
pool.getConnection((err, conn) => {
  if (err) {
    console.error("❌ DB pool init failed:", err.message);
  } else {
    console.log("✅ DB pool ready (shared).");
    conn.release();
  }
});

module.exports = pool;
