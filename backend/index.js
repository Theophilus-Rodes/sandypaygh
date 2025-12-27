// ✅ IMPORTS
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bodyParser = require("body-parser");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const ExcelJS = require("exceljs"); // ✅ NEW
const multer = require("multer");
const xlsx = require("xlsx");
const path = require("path");
const fs = require("fs");
//calling ussd 
const moolreRouter = require("./shortcode/ussd");


// --- Sessions helpers (place near other requires/configs) ---
const crypto = require("crypto");

function newRef(prefix = "S") {
  return `${prefix}${Date.now()}${Math.floor(Math.random()*1000)}`.slice(0, 24);
}


// Ensure uploads folder exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// ✅ USSD CODE HELPER
function generateUssdCode(baseCode, userId) {
  return `${baseCode.slice(0, -1)}*${userId}#`;
}


// ===== ACCESS CONTROL (place after db is created, before routes) =====
function normalizePhone(raw = "") {
  const s = String(raw || "").replace(/\s+/g, "");
  // +23324xxxxxxx -> 024xxxxxxx
  if (s.startsWith("+233") && s.length >= 13) return "0" + s.slice(4, 6) + s.slice(6);
  // 23324xxxxxxx -> 024xxxxxxx
  if (s.startsWith("233") && s.length === 12)  return "0" + s.slice(3, 5) + s.slice(5);
  return s; // assume already like 024xxxxxxx
}

function getAccessMode(cb) {
  db.query(
    "SELECT setting_value FROM app_settings WHERE setting_key='access_mode' LIMIT 1",
    (err, rows) => cb(err, rows && rows[0] ? rows[0].setting_value : "all")
  );
}

function setAccessMode(mode, cb) {
  db.query(
    "INSERT INTO app_settings (setting_key, setting_value) VALUES ('access_mode', ?) " +
    "ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
    [mode],
    cb
  );
}

function checkAccess(req, res, next) {
  getAccessMode((err, mode) => {
    if (err) return res.status(500).json({ error: "Settings error" });
    if (mode !== "limited") return next(); // open for all

    // Try to read the caller's phone from common fields
    const raw =
      (req.body && (req.body.phone_number || req.body.msisdn || req.body.momo_number)) ||
      (req.query && (req.query.phone_number || req.query.msisdn)) ||
      "";

    const phone = normalizePhone(raw);
    if (!phone) {
      return res.status(403).json({ error: "You don't have access to this service" });
    }

    db.query(
      "SELECT 1 FROM telephone_numbers " +
      "WHERE phone_number = ? AND (status IS NULL OR status = 'allowed') LIMIT 1",
      [phone],
      (qErr, rows) => {
        if (qErr) return res.status(500).json({ error: "Database error" });
        if (!rows || rows.length === 0) {
          return res.status(403).json({ error: "You don't have access to this service" });
        }
        next(); // allowed
      }
    );
  });
}



// ✅ INITIALIZE APP
const app = express();
app.use(cors());
app.use(bodyParser.json());
//Continue ussd
app.use("/api/moolre", moolreRouter);




// compat: GET /api/get-access
app.get('/api/get-access', (req, res) => {
  getAccessMode((err, mode) => {
    if (err) return res.status(500).json({ error: 'Failed to read mode' });
    res.json({ mode });
  });
});

// compat: GET /api/set-access/:mode
app.get('/api/set-access/:mode', (req, res) => {
  const mode = req.params.mode;
  if (!['all','limited'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }
  setAccessMode(mode, (err) => {
    if (err) return res.status(500).json({ error: 'Failed to update mode' });
    res.json({ success: true, mode });
  });
});


// ✅ Create database connection (SECURE + supports CA text or path)
const required = ["DB_HOST", "DB_PORT", "DB_USER", "DB_NAME"];
const missing = required.filter(k => !process.env[k] || String(process.env[k]).trim() === "");
if (missing.length) {
  console.error("❌ Missing environment variables:", missing.join(", "));
}

const DB_PASSWORD = process.env.DB_PASSWORD || process.env.DB_PASS || "";

let caContent = null;
try {
  const caEnv = process.env.DB_SSL_CA;
  if (caEnv && caEnv.trim().startsWith("-----BEGIN")) {
    // CA provided as PEM text in the env var
    caContent = caEnv;
  } else {
    // CA provided as a filesystem path OR fall back to system bundle
    const caPath = caEnv && caEnv.trim() !== "" ? caEnv : "/etc/ssl/certs/ca-certificates.crt";
    caContent = fs.readFileSync(caPath, "utf8");
  }
} catch (e) {
  console.error("⚠️ Could not load CA certificate:", e.message);
}

const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: String(process.env.DB_USER || "").trim(),
  password: DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: caContent
    ? { ca: caContent, rejectUnauthorized: true, minVersion: "TLSv1.2" }
    : { rejectUnauthorized: false }, // last-resort fallback (not recommended long-term)
};

if (!dbConfig.user) {
  throw new Error("DB_USER is empty — set DB_USER in App Platform → Environment Variables.");
}
if (!DB_PASSWORD) {
  throw new Error("DB_PASSWORD is empty — set DB_PASSWORD (or DB_PASS).");
}

const db = mysql.createConnection(dbConfig);

db.connect(err => {
  if (err) {
    console.error("❌ Database connection failed:", err.message);
  } else {
    console.log("✅ Connected securely to DigitalOcean MySQL database!");
  }
});

module.exports = db;


// ✅ SETUP NODEMAILER
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "Sandipayghana@gmail.com",
    pass: "qlrg kukn uvqm lcsz"
  }
});

transporter.verify((error, success) => {
  if (error) console.log("Transporter setup error:", error);
  else console.log("SMTP is ready to send emails.");
});




// helper to make short refs (reuse if already defined)
function newRef(prefix = "SW") {
  return `${prefix}${Date.now()}${Math.floor(Math.random()*1000)}`.slice(0, 30);
}

app.post("/api/sessions/purchase", async (req, res) => {
  try {
    const { vendor_id, amount, computed_hits } = req.body;
    if (!vendor_id || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "vendor_id and valid amount are required" });
    }

    const amt = Number(amount);
    const HIT_COST = 0.02;
    const hits = Number.isFinite(Number(computed_hits))
      ? Math.max(0, Math.floor(Number(computed_hits)))
      : Math.floor(amt / HIT_COST);

    // 1) balance
    const [balRows] = await db.promise().query(
      "SELECT COALESCE(SUM(amount),0) AS balance FROM wallet_loads WHERE vendor_id = ?",
      [vendor_id]
    );
    const balance = Number(balRows?.[0]?.balance || 0);
    if (balance < amt) {
      return res.status(400).json({ error: "Insufficient wallet balance", balance, required: amt });
    }

    // 2) TX begin
    await db.promise().beginTransaction();

    // 3) debit wallet (negative row)
    await db.promise().query(
      "INSERT INTO wallet_loads (vendor_id, momo, amount, date_loaded) VALUES (?, ?, ?, NOW())",
      [vendor_id, "sessions_purchase", -amt]
    );

    // 4) insert purchase
    const reference = newRef("SW");
    const [ins] = await db.promise().query(
      "INSERT INTO session_purchases (vendor_id, source, amount, hits, reference, status, meta_json) VALUES (?,?,?,?,?, 'completed', JSON_OBJECT('computed_hits', ?))",
      [vendor_id, "wallet", amt, hits, reference, hits]
    );

    // 5) commit
    await db.promise().commit();

    return res.json({ id: ins.insertId, reference, status: "completed", hits, new_balance: balance - amt });
  } catch (err) {
    try { await db.promise().rollback(); } catch {}
    console.error("sessions/purchase (wallet) error:", err.message);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
});







// ========================================================
//               MOOLRE SESSION PAYMENT CONFIG
// ========================================================
const MOOLRE_SESSIONS = {
  // INIT endpoint
  payUrl: "https://api.moolre.com/open/transact/payment",

  // Payment Status endpoint from official docs
  statusUrl: "https://api.moolre.com/open/transact/status",

  // Moolre username
  user: process.env.MOOLRE_USER || "acheamp",

  // Used for INIT (sending OTP / payment request)
  pubkey:
    process.env.MOOLRE_PUBKEY ||
    "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyaWQiOjEwNjU0OSwiZXhwIjoxOTI1MDA5OTk5fQ.YNoLN19xWWZRyr2Gdy_2DexpGLZv4V9yATnyYSFef2M",

  // Used for STATUS checks (Moolre Public API Key)
  apiKey:
    process.env.MOOLRE_API_KEY ||
    "9ILLNsdyPt6deXM1YWjpFzd1XIOPwDYXDHJKN930kGuw1Ndt2o4tF8uNUi5IhGzG",

  // Your GHS wallet number
  wallet: process.env.MOOLRE_WALLET || "10654906056819",
};

function moolreChannelId(network) {
  switch (String(network || "").toLowerCase()) {
    case "mtn":
      return 13;
    case "airteltigo":
    case "airtel":
    case "at":
      return 7;
    case "telecel":
    case "vodafone":
    case "voda":
      return 6;
    default:
      return null;
  }
}

function normalizeLocalMomo(msisdn) {
  const digits = String(msisdn || "").replace(/[^\d]/g, "");
  if (digits.startsWith("0") && digits.length >= 9) return digits;
  if (digits.startsWith("233") && digits.length >= 12)
    return "0" + digits.slice(3);
  if (digits.startsWith("00233") && digits.length >= 14)
    return "0" + digits.slice(5);
  return digits;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));





// ========================================================
//     SESSIONS PURCHASE VIA THETELLER (MO MO PROMPT)
// ========================================================
app.post("/api/sessions/purchase-momo", async (req, res) => {
  const { vendor_id, amount, momo_number, network, computed_hits } = req.body;

  // Basic validation
  if (!vendor_id || !amount || !momo_number || !network) {
    return res
      .status(400)
      .json({ success: false, message: "Missing fields: vendor_id, amount, momo_number, network are required." });
  }

  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid amount." });
  }

  // Local helper – same style as AFA
  function getSwitchCode(net) {
    switch (net.toLowerCase()) {
      case "mtn":
        return "MTN";
      case "vodafone":
      case "telecel":
        return "VDF";
      case "airteltigo":
      case "airtel":
        return "ATL";
      case "tigo":
        return "TGO";
      default:
        return null;
    }
  }

  try {
    const rSwitch = getSwitchCode(network);
    if (!rSwitch) {
      return res
        .status(400)
        .json({ success: false, message: "Unsupported network." });
    }

    // Format MoMo as 233XXXXXXXXX (same idea as AFA)
    const formattedMoMo = momo_number.replace(/^0/, "233");

    // Unique transaction ID and reference
    const transactionId = `TRX-SES-${Date.now()}`.slice(0, 30);
    const reference = transactionId; // we also use this as "reference" in DB

    // TheTeller wants amount in "pesewas" padded to 12 digits
    const amountFormatted = String(Math.round(numericAmount * 100)).padStart(12, "0");

    const payload = {
      amount: amountFormatted,
      processing_code: "000200",
      transaction_id: transactionId,
      desc: "USSD Session Purchase",
      merchant_id: "TTM-00010694",
      subscriber_number: formattedMoMo,
      "r-switch": rSwitch,
      redirect_url: "https://example.com/sessions-callback" // placeholder
    };

    // Same auth style as your AFA code
    const token = Buffer.from(
      "sandipay6821f47c4bfc0:ZjZjMWViZGY0OGVjMDViNjBiMmM1NmMzMmU3MGE1YzQ="
    ).toString("base64");

    // Call TheTeller
    const response = await axios.post(
      "https://prod.theteller.net/v1.1/transaction/process",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${token}`,
          "Cache-Control": "no-cache"
        }
      }
    );

    const status = response.data.status?.toLowerCase();
    const code = response.data.code;

    // Decide if payment is successful
    if (status === "approved" || status === "successful" || code === "000") {
      const HIT_COST = 0.02;

      // If frontend sends computed_hits use it, otherwise derive from amount
      const hits =
        Number.isFinite(Number(computed_hits)) && Number(computed_hits) > 0
          ? Math.floor(Number(computed_hits))
          : Math.floor(numericAmount / HIT_COST);

      // Insert into session_purchases
      db.query(
        `INSERT INTO session_purchases
           (vendor_id, source, amount, hits, reference, status, meta_json)
         VALUES (?, 'momo', ?, ?, ?, 'completed',
           JSON_OBJECT('network', ?, 'momo', ?, 'verified', true))`,
        [
          vendor_id,
          numericAmount,
          hits,
          reference,
          network.toLowerCase(),
          momo_number
        ],
        (err, result) => {
          if (err) {
            console.error("❌ Error inserting session_purchases:", err);
            return res
              .status(500)
              .json({ success: false, message: "Payment went through but could not save sessions." });
          }

          return res.json({
            success: true,
            message: "Payment successful, sessions credited.",
            hits,
            reference
          });
        }
      );
    } else {
      console.error("❌ TheTeller sessions payment declined:", response.data);
      return res
        .status(400)
        .json({ success: false, message: "Payment declined.", raw: response.data });
    }
  } catch (error) {
    console.error(
      "❌ /api/sessions/purchase-momo (TheTeller) error:",
      error.response?.data || error.message
    );
    return res
      .status(500)
      .json({ success: false, message: "Payment failed or cancelled." });
  }
});


//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////



///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//New Code 

// ==============================
// REQUIRED MIDDLEWARE (important)
// ==============================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================================================
// GET /api/admin-data?network=mtn|telecel|airteltigo
// =====================================================
app.get("/api/admin-data", (req, res) => {
  const network = String(req.query.network || "").toLowerCase().trim();

  if (!network) return res.json([]);

  db.query(
    "SELECT id, package_name, price, network FROM AdminData WHERE status='active' AND LOWER(network)=? ORDER BY price ASC",
    [network],
    (err, rows) => {
      if (err) {
        console.error("❌ AdminData fetch error:", err);
        return res.status(500).json({ ok: false, message: "Database error" });
      }
      res.json(rows || []);
    }
  );
});

// ==============================
// HELPERS (required for your flow)
// ==============================

// ✅ Map DB network -> TheTeller r-switch code
function getSwitchCode(network) {
  const n = String(network || "").toLowerCase().trim();

  // MTN
  if (n === "mtn" || n.includes("mtn")) return "MTN";

  // AirtelTigo
  if (
    n === "airteltigo" ||
    n.includes("airteltigo") ||
    n.includes("airtel") ||
    n.includes("tigo") ||
    n.includes("atl")
  )
    return "ATL";

  // Telecel/Vodafone
  if (
    n === "telecel" ||
    n.includes("telecel") ||
    n.includes("vodafone") ||
    n.includes("voda") ||
    n.includes("vdf")
  )
    return "VDF";

  return null;
}

// ✅ Format Ghana numbers to TheTeller style (233xxxxxxxxx)
function formatMsisdnForTheTeller(msisdn) {
  let n = String(msisdn || "").replace(/\D/g, "");
  if (n.startsWith("0")) n = "233" + n.slice(1);
  if (n.startsWith("+")) n = n.slice(1);
  return n;
}

// ✅ Format amount for TheTeller (string "1.00")
function thetellerAmount(amount) {
  const num = Number(amount || 0);
  return num.toFixed(2);
}

// ✅ Unique transaction id
function makeTransactionId() {
  return "TRX" + Date.now() + Math.floor(Math.random() * 1000);
}

// ✅ Group package id for admin_orders download batch
function makePackageId() {
  return "PKG" + Date.now() + Math.floor(Math.random() * 1000);
}

// =====================================================
// POST /api/buy-data-theteller  (returns transaction_id)
// =====================================================
// =======================
// THETELLER CONFIG
// =======================
const THETELLER = {
  endpoint: "https://prod.theteller.net/v1.1/transaction/process",
  merchantId: process.env.THETELLER_MERCHANT_ID || "TTM-00009388",
  username: process.env.THETELLER_USERNAME || "louis66a20ac942e74",
  apiKey:
    process.env.THETELLER_API_KEY ||
    "ZmVjZWZlZDc2MzA4OWU0YmZhOTk5MDBmMDAxNDhmOWY=",
};

// ✅ Build Basic Auth ONCE: base64("username:apikey")
const THETELLER_BASIC_TOKEN = Buffer.from(
  `${THETELLER.username}:${THETELLER.apiKey}`
).toString("base64");

// =======================
// HELPERS
// =======================

// ✅ TheTeller requires 12-digit amount in pesewas
// Example: GHS 1.00 -> "000000000100"
function thetellerAmount12(ghsAmount) {
  const pesewas = Math.round(Number(ghsAmount) * 100); // 6.00 -> 600
  return String(pesewas).padStart(12, "0");
}

// ✅ r-switch mapping
function getSwitchCode(network) {
  const n = String(network || "").toLowerCase().trim();
  if (n.includes("mtn")) return "MTN";
  if (n.includes("airteltigo") || n.includes("airtel") || n.includes("tigo"))
    return "ATL";
  if (n.includes("telecel") || n.includes("vodafone") || n.includes("voda"))
    return "VDF";
  return null;
}

// ✅ MSISDN -> 233XXXXXXXXX
function formatMsisdnForTheTeller(number) {
  if (!number) return "";
  let msisdn = String(number).replace(/\D/g, "");

  // 0XXXXXXXXX -> 233XXXXXXXXX
  if (msisdn.startsWith("0") && msisdn.length === 10) {
    msisdn = "233" + msisdn.slice(1);
  }

  // already 233XXXXXXXXX
  return msisdn;
}

// ✅ Unique transaction id
function makeTransactionId() {
  return `SANDYPAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

// ===============================
//  PENDING ORDERS STORE (MEMORY)
// ===============================
// Key: transaction_id
// Value: { vendor_id, recipient_number, package_name, amount, network, package_id }
const pendingOrders = new Map();

// Helper: treat these as "good" statuses
function isApprovedStatus(status, code) {
  const s = String(status || "").toLowerCase();
  const c = String(code || "");
  return (
    s === "approved" ||
    s === "successful" ||
    s === "success" ||
    s === "completed" ||
    c === "000"
  );
}

function isPendingStatus(status, code) {
  const s = String(status || "").toLowerCase();
  const c = String(code || "");
  return s === "pending" || s === "processing" || c === "099";
}

// =====================================================
// POST /api/buy-data-theteller  (INITIATE PROMPT)
// =====================================================
app.post("/api/buy-data-theteller", async (req, res) => {
  const { package_id, momo_number, recipient_number, vendor_id } = req.body;
  const vid = Number(vendor_id || 1);

  if (!package_id || !momo_number || !recipient_number) {
    return res.json({ ok: false, message: "Missing required fields." });
  }

  try {
    // 1) Fetch package
    const [rows] = await db.promise().query(
      "SELECT id, package_name, price, network FROM AdminData WHERE id=? AND status='active' LIMIT 1",
      [package_id]
    );

    if (!rows.length) {
      return res.json({ ok: false, message: "Package not found or inactive." });
    }

    const pkg = rows[0];

    // 2) Map network to r-switch
    const rSwitch = getSwitchCode(pkg.network);
    if (!rSwitch) {
      return res.json({ ok: false, message: "Unsupported network." });
    }

    // 3) Build payload
    const transactionId = makeTransactionId();

    const payload = {
      amount: thetellerAmount12(pkg.price), // 12 digits pesewas
      processing_code: "000200",
      transaction_id: transactionId,
      desc: `Sandypay Data - ${pkg.package_name}`,
      merchant_id: THETELLER.merchantId,
      subscriber_number: formatMsisdnForTheTeller(momo_number),
      "r-switch": rSwitch,
      redirect_url: "https://sandypay.co/payment-callback",
    };

    console.log("📤 TheTeller INIT payload:", payload);

    // ✅ Use ONE token variable consistently
    const authToken = THETELLER.basicToken; // base64(username:apikey)

    // 4) Call TheTeller INIT
    const tt = await axios.post(THETELLER.endpoint, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${authToken}`,
        "Cache-Control": "no-cache",
      },
      timeout: 30000,
    });

    console.log("📥 TheTeller INIT response:", tt.data);

    const status = String(tt.data?.status || "").toLowerCase();
    const code = String(tt.data?.code || "");

    // INIT can return pending / successful depending on channel
    const accepted = isApprovedStatus(status, code) || isPendingStatus(status, code);

    if (!accepted) {
      return res.json({
        ok: false,
        message: "Payment prompt not accepted.",
        theteller: tt.data,
      });
    }

    // ✅ Store pending details for auto-finalize on status poll
    pendingOrders.set(transactionId, {
      vendor_id: vid,
      recipient_number,
      package_name: pkg.package_name,
      amount: Number(pkg.price),
      network: String(pkg.network || "").toLowerCase(),
      package_id: makePackageId(),
    });

    return res.json({
      ok: true,
      message: "✅ Prompt sent. Please approve on your phone.",
      transaction_id: transactionId,
      vendor_id: vid,
    });
  } catch (err) {
    console.error("❌ TheTeller INIT error:", err.response?.data || err.message);
    return res.status(500).json({
      ok: false,
      message: "Payment could not be initiated. Try again.",
      error: err.response?.data || err.message,
    });
  }
});


// =====================================================
// GET /api/theteller-status?transaction_id=TRX...
// ✅ NOW AUTO-INSERTS INTO admin_orders when approved
// =====================================================
app.get("/api/theteller-status", async (req, res) => {
  const transaction_id = String(req.query.transaction_id || "").trim();
  if (!transaction_id) return res.json({ ok: false, status: "unknown" });

  try {
    const authToken = THETELLER.basicToken;

    const resp = await axios.get(
      `https://prod.theteller.net/v1.1/transaction/status/${encodeURIComponent(transaction_id)}`,
      {
        headers: {
          Authorization: `Basic ${authToken}`,
          "Cache-Control": "no-cache",
        },
        timeout: 30000,
      }
    );

    const raw = resp.data || {};
    const status = String(raw.status || "").toLowerCase();
    const code = String(raw.code || "");

    // If approved/successful → finalize automatically
    if (isApprovedStatus(status, code)) {
      const p = pendingOrders.get(transaction_id);

      // If we still have the pending info, insert it
      if (p) {
        // ✅ prevent duplicates
        const [exists] = await db.promise().query(
          "SELECT 1 FROM admin_orders WHERE updated_reference = ? LIMIT 1",
          [transaction_id]
        );

        if (!exists.length) {
          await db.promise().query(
            `INSERT INTO admin_orders
              (vendor_id, recipient_number, data_package, amount, network, status, sent_at, package_id, updated_reference)
             VALUES (?, ?, ?, ?, ?, 'pending', NOW(), ?, ?)`,
            [
              p.vendor_id,
              p.recipient_number,
              p.package_name,
              Number(p.amount),
              String(p.network).toLowerCase(),
              p.package_id,
              transaction_id,
            ]
          );
        }

        // Once done, clear pending (optional)
        pendingOrders.delete(transaction_id);

        return res.json({
          ok: true,
          status: "approved",
          finalized: true,
          message: "✅ Payment successful. Order saved.",
          raw,
        });
      }

      // Approved but no pending data (server restarted etc.)
      return res.json({
        ok: true,
        status: "approved",
        finalized: false,
        message: "✅ Payment approved, but order data not found. (Server restart?)",
        raw,
      });
    }

    // pending / failed / other states
    return res.json({
      ok: true,
      status,
      finalized: false,
      message:
        status === "pending" || status === "processing"
          ? "⏳ Awaiting approval..."
          : "❌ Payment not approved.",
      raw,
    });
  } catch (e) {
    console.error("❌ TheTeller status error:", e.response?.data || e.message);
    return res.json({ ok: false, status: "unknown" });
  }
});


// =====================================================
// POST /api/buy-data-confirm (OPTIONAL)
// Keep this if you still want manual confirm from frontend
// But with auto-finalize above, you may not even need it.
// =====================================================
app.post("/api/buy-data-confirm", async (req, res) => {
  const {
    transaction_id,
    vendor_id,
    recipient_number,
    package_name,
    amount,
    network,
  } = req.body;

  const amountNum = Number(amount);

  if (
    !transaction_id ||
    !recipient_number ||
    !package_name ||
    !network ||
    Number.isNaN(amountNum)
  ) {
    return res.json({ ok: false, message: "Missing confirm fields." });
  }

  const vendorId = Number(vendor_id || 1);
  const packageIdGroup = makePackageId();

  try {
    const [exists] = await db.promise().query(
      "SELECT 1 FROM admin_orders WHERE updated_reference = ? LIMIT 1",
      [transaction_id]
    );

    if (exists.length) {
      return res.json({ ok: true, message: "Already confirmed." });
    }

    await db.promise().query(
      `INSERT INTO admin_orders
        (vendor_id, recipient_number, data_package, amount, network, status, sent_at, package_id, updated_reference)
       VALUES (?, ?, ?, ?, ?, 'pending', NOW(), ?, ?)`,
      [
        vendorId,
        recipient_number,
        package_name,
        amountNum,
        String(network).toLowerCase(),
        packageIdGroup,
        transaction_id,
      ]
    );

    return res.json({ ok: true, message: "Order confirmed and saved." });
  } catch (err) {
    console.error("❌ Confirm insert error:", err);
    return res.json({ ok: false, message: "Could not save order." });
  }
});



///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////



// GET /api/vendor/ussd-stats?vendor_id=5
app.get("/api/vendor/ussd-stats", async (req, res) => {
  const vendor_id = Number(req.query.vendor_id || 0);
  if (!vendor_id) return res.status(400).json({ error: "vendor_id required" });

  try {
    const [used] = await db.promise().query(
      `SELECT COALESCE(hits_used,0) AS used_hits
         FROM ussd_session_counters
        WHERE vendor_id = ?`,
      [vendor_id]
    );

    const [remain] = await db.promise().query(
      `SELECT COALESCE(SUM(CASE WHEN status='completed' THEN hits ELSE 0 END),0) AS remaining_hits
         FROM session_purchases
        WHERE vendor_id = ?`,
      [vendor_id]
    );

    res.json({
      used_hits: Number(used?.[0]?.used_hits || 0),
      remaining_hits: Number(remain?.[0]?.remaining_hits || 0),
    });
  } catch (e) {
    console.error("ussd-stats error:", e.message);
    res.status(500).json({ error: "server_error" });
  }
});



// GET /api/sessions/hits?vendor_id=5
app.get("/api/sessions/hits", async (req, res) => {
  try {
    const vendor_id = req.query.vendor_id;
    if (!vendor_id) return res.status(400).json({ error: "vendor_id is required" });

    const [rows] = await db.promise().query(
  `SELECT COALESCE(SUM(hits), 0) AS total_hits
   FROM session_purchases
   WHERE vendor_id = ?`,
  [vendor_id]
);

    const total_hits = Number(rows?.[0]?.total_hits || 0);
    res.json({ total_hits });
  } catch (e) {
    console.error("sessions/hits error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});




// ✅ DOWNLOAD COMPLETED ORDERS & RECORD
app.get("/api/download-orders", async (req, res) => {
  const { network, userId } = req.query;
  const sql = `SELECT recipient, volume, network, channel, delivery, payment, timestamp FROM transactions WHERE user_id = ? AND network = ?`;

  db.query(sql, [userId, network], async (err, rows) => {
    if (err || !rows.length) return res.status(500).send("No orders found");

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Orders");

    sheet.columns = [
      { header: "Date", key: "timestamp", width: 15 },
      { header: "Recipient", key: "recipient", width: 20 },
      { header: "Quantity", key: "volume", width: 15 },
      { header: "Network", key: "network", width: 15 },
      { header: "Price", key: "price", width: 10 },
      { header: "Payment", key: "payment", width: 10 },
      { header: "Status", key: "delivery", width: 10 },
      { header: "Ref", key: "reference", width: 20 },
      { header: "Platform", key: "platform", width: 10 },
      { header: "Action", key: "action", width: 10 },
    ];

    const now = new Date().toISOString().slice(0, 19).replace("T", " ");

// Add sorted rows to excel
rows.forEach(row => {
  const cleanPackage = row.data_package.replace(/[^\d.]/g, '');

  // Convert 233XXXXXXXXX -> 0XXXXXXXXX
  let recipient = String(row.recipient_number || "").replace(/\D/g, "");
  if (recipient.startsWith("233") && recipient.length === 12) {
    recipient = "0" + recipient.slice(3);   // 23354xxxxxxx -> 054xxxxxxx
  }

  worksheet.addRow({
    recipient_number: recipient,
    data_package: cleanPackage
  });
});


    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=${network}_orders.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  });
});

// ✅ FETCH DOWNLOADED ORDERS FOR DISPLAY
app.post("/api/downloaded-orders", (req, res) => {
  const { userId } = req.body;
  const sql = `SELECT * FROM downloaded_orders WHERE user_id = ? ORDER BY date DESC`;
  db.query(sql, [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: "Failed to fetch downloaded orders" });
    res.json(rows);
  });
});

// (Leave all other existing routes and logic untouched below this comment)

// ✅ REGISTER
app.post("/api/register", async (req, res) => {
  const { username, phone, sender_id, password, role } = req.body;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(sender_id)) return res.status(400).send("Invalid email format");
  if (password === "0000") return res.status(400).send("PIN cannot be 0000.");

  try {
    db.query("SELECT * FROM users", async (err, users) => {
      if (err) return res.status(500).send("Error checking PINs.");
      for (let user of users) {
        const match = await bcrypt.compare(password, user.password);
        if (match) return res.status(400).send("PIN already in use.");
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const mailOptions = {
        from: "Sandipayghana@gmail.com",
        to: sender_id,
        subject: "Vendor Portal - Email Verification",
        text: `Hi ${username},\n\nWe are verifying this email for your account registration on Vendor Portal.`
      };
     transporter.sendMail(mailOptions, (emailErr) => {
  if (emailErr) {
    console.error("❌ Email sending error:", emailErr); // ✅ Log the actual error
    return res.status(400).send("Invalid email.");
  }
        db.query("INSERT INTO users (username, phone, sender_id, password, role) VALUES (?, ?, ?, ?, ?)",
          [username, phone, sender_id, hashedPassword, role],
          (insertErr, result) => {
            if (insertErr) return res.status(500).send("Registration failed.");

            const userId = result.insertId;
           const ussdCode = generateUssdCode("*203*888#", userId);
           const publicLink = `https://sandipay.co/index1.html?id=${userId}`;


            db.query("UPDATE users SET ussd_code = ?, public_link = ? WHERE id = ?", [ussdCode, publicLink, userId], (updateErr) => {
              if (updateErr) return res.status(500).send("Failed to save USSD code and Link.");
              res.send(`Account created and email sent successfully! Your USSD Code: ${ussdCode}| Link: ${publicLink}`);
            });
          });
      });
    });
  } catch (err) {
    res.status(500).send("Registration error.");
  }
});



// ✅ LOGIN
app.post("/api/login", (req, res) => {
  const { username, pin, role } = req.body;
  db.query("SELECT * FROM users WHERE username = ? AND role = ? LIMIT 1", [username, role], async (err, results) => {
    if (err) return res.status(500).send("Login failed.");
    if (!results.length) return res.status(401).send("Invalid credentials.");
    const user = results[0];
    const match = await bcrypt.compare(pin, user.password);
    if (!match) return res.status(401).send("Incorrect PIN.");
    res.json({ message: "Login successful", username: user.username, role: user.role, id: user.id });
  });
});

// ✅ CHANGE PIN
app.post("/api/change-pin", async (req, res) => {
  const { userId, oldPin, newPin } = req.body;
  if (newPin === "0000") return res.status(400).send("PIN cannot be 0000.");
  db.query("SELECT password FROM users WHERE id = ?", [userId], async (err, results) => {
    if (err) return res.status(500).send("Server error.");
    if (!results.length) return res.status(400).send("User not found.");
    const user = results[0];
    const match = await bcrypt.compare(oldPin, user.password);
    if (!match) return res.status(400).send("Old PIN incorrect.");
    const hashedNewPin = await bcrypt.hash(newPin, 10);
    db.query("UPDATE users SET password = ? WHERE id = ?", [hashedNewPin, userId], (err) => {
      if (err) return res.status(500).send("Failed to change PIN.");
      res.send("PIN changed successfully!");
    });
  });
});

// ✅ LOAD PRICING
app.post("/api/load-pricing", (req, res) => {
  const { network, userId } = req.body;
  let tableName = "";
  if (network === "mtn") tableName = "pricing_mtn";
  else if (network === "airteltigo") tableName = "pricing_airteltigo";
  else if (network === "telecel") tableName = "pricing_telecel";
  else return res.status(400).send("Invalid network type");
  const sql = `SELECT * FROM ${tableName} WHERE user_id = ?`;
  db.query(sql, [userId], (err, results) => {
    if (err) return res.status(500).send("Failed to load pricing.");
    res.json(results);
  });
});

// ✅ SAVE PRICING
app.post("/api/save-pricing", (req, res) => {
  const { network, userId, dataPlan, costPrice, sellingPrice } = req.body;
  let tableName = "";
  if (network === "mtn") tableName = "pricing_mtn";
  else if (network === "airteltigo") tableName = "pricing_airteltigo";
  else if (network === "telecel") tableName = "pricing_telecel";
  else return res.status(400).send("Invalid network type");

  const sql = `INSERT INTO ${tableName} (user_id, data_plan, cost_price, selling_price, status)
               VALUES (?, ?, ?, ?, 'available')
               ON DUPLICATE KEY UPDATE selling_price = VALUES(selling_price), status = 'available'`;

  db.query(sql, [userId, dataPlan, costPrice, sellingPrice], (err) => {
    if (err) return res.status(500).send("Failed to save pricing.");
    res.send("Pricing saved.");
  });
});

// ✅ DELETE PRICING
app.post("/api/delete-pricing", (req, res) => {
  const { network, userId, dataPlan } = req.body;
  let tableName = "";
  if (network === "mtn") tableName = "pricing_mtn";
  else if (network === "airteltigo") tableName = "pricing_airteltigo";
  else if (network === "telecel") tableName = "pricing_telecel";
  else return res.status(400).send("Invalid network type");

  const sql = `DELETE FROM ${tableName} WHERE user_id = ? AND data_plan = ?`;
  db.query(sql, [userId, dataPlan], (err) => {
    if (err) return res.status(500).send("Failed to delete pricing.");
    res.send("Pricing deleted.");
  });
});

// ✅ GET USERS
app.get("/api/users", (req, res) => {
  const sql = "SELECT id, username, role, status FROM users";
  db.query(sql, (err, results) => {
    if (err) return res.status(500).send("Failed to fetch users.");
    res.json(results);
  });
});

// ✅ DEACTIVATE
app.post("/api/deactivate-user", async (req, res) => {
  const { userId } = req.body;
  const hashedPin = await bcrypt.hash("0000", 10);
  db.query("UPDATE users SET password = ?, status = 'inactive' WHERE id = ?", [hashedPin, userId], (err) => {
    if (err) return res.status(500).send("Failed to deactivate.");
    res.send("User deactivated and PIN reset.");
  });
});

// ✅ REACTIVATE
app.post("/api/reactivate-user", async (req, res) => {
  const { userId, newPin } = req.body;
  if (newPin === "0000") return res.status(400).send("PIN cannot be 0000.");
  const hashedPin = await bcrypt.hash(newPin, 10);
  db.query("UPDATE users SET password = ?, status = 'active' WHERE id = ?", [hashedPin, userId], (err) => {
    if (err) return res.status(500).send("Failed to reactivate.");
    res.send("User reactivated.");
  });
});

// ✅ USER INFO (Updated)
app.post("/api/user-info", (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  db.query(
    "SELECT username, phone, sender_id, ussd_code, public_link FROM users WHERE id = ? LIMIT 1",
    [userId],
    (err, results) => {
      if (err) return res.status(500).json({ error: "Database error while fetching user." });
      if (!results.length) return res.status(404).json({ error: "User not found." });
      res.json(results[0]);
    }
  );
});



// ✅ UPDATE SETTINGS
app.post("/api/update-settings", (req, res) => {
  const { userId, username, phone, sender_id } = req.body;
  if (!userId || !username || !phone || !sender_id) return res.status(400).send("All fields required.");
  db.query("UPDATE users SET username = ?, phone = ?, sender_id = ? WHERE id = ?", [username, phone, sender_id, userId], (err) => {
    if (err) return res.status(500).send("Failed to update settings.");
    res.send("Settings updated successfully.");
  });
});

// ✅ ADD DATA PACKAGE
app.post("/api/add-package", (req, res) => {
  const { network, value, amount, status, vendor_id } = req.body;
  const sql = `INSERT INTO data_packages (network, amount, data_package, status, vendor_id) VALUES (?, ?, ?, ?, ?)`;
  db.query(sql, [network, amount, value, status, vendor_id], (err) => {
    if (err) return res.status(500).send("Failed to insert package.");
    res.send("Package inserted successfully.");
  });
});


// ✅ FETCH DATA PACKAGES
app.post("/api/get-packages", (req, res) => {
  const { vendor_id, network } = req.body;

  const query = `
    SELECT * FROM data_packages 
    WHERE vendor_id = ? AND network = ? AND status = 'available'
  `;

  db.query(query, [vendor_id, network], (err, results) => {
    if (err) {
      console.error("Error fetching packages:", err);
      return res.status(500).send("Failed to fetch packages.");
    }
    res.json(results);
  });
});

app.post("/api/get-all-packages", (req, res) => {
  const { vendor_id, network } = req.body;

  const query = `
    SELECT
      adp.id                AS admin_id,       -- admin_data_packages.id
      adp.network,
      adp.data_package,
      adp.amount            AS cost_price,     -- admin cost price

      dp.id                 AS vendor_id,      -- data_packages.id (can be null)
      dp.amount             AS selling_price,  -- vendor selling price (can be null)
      dp.status             AS status          -- vendor status (can be null)
    FROM admin_data_packages adp
    LEFT JOIN data_packages dp
      ON dp.vendor_id    = ?
     AND dp.network      = adp.network
     AND dp.data_package = adp.data_package
    WHERE adp.network = ?
    ORDER BY adp.id ASC
  `;

  db.query(query, [vendor_id, network], (err, results) => {
    if (err) {
      console.error("Error fetching all packages:", err);
      return res.status(500).send("Failed to fetch packages.");
    }
    res.json(results);
  });
});




// ✅ UPDATE PACKAGE STATUS
app.post("/api/update-status", (req, res) => {
  const { id, status } = req.body;
  const sql = `UPDATE data_packages SET status = ? WHERE id = ?`;
  db.query(sql, [status, id], (err) => {
    if (err) return res.status(500).send("Failed to update status.");
    res.send("Status updated.");
  });
});


// ✅ RESET PIN
app.post("/api/reset-pin", async (req, res) => {
  const { username, phone, newPin } = req.body;
  if (newPin === "0000") return res.status(400).send("PIN cannot be 0000.");
  const sql = "SELECT id FROM users WHERE username = ? AND phone = ? LIMIT 1";
  db.query(sql, [username, phone], async (err, results) => {
    if (err) return res.status(500).send("Server error.");
    if (!results.length) return res.status(404).send("User not found.");
    const userId = results[0].id;
    const hashedPin = await bcrypt.hash(newPin, 10);
    db.query("UPDATE users SET password = ? WHERE id = ?", [hashedPin, userId], (err) => {
      if (err) return res.status(500).send("Failed to reset PIN.");
      res.send("PIN reset successfully.");
    });
  });
});
// ✅ PLACE DATA ORDER WITH MOOLRE
const axios = require("axios");

// ✅ Multi-network payment endpoint (Moolre)
app.post("/api/place-order", async (req, res) => {
  const { vendor_id, network, data_package, amount, recipient_number, momo_number } = req.body;

  console.log("📥 Incoming order body:", req.body);

  if (!vendor_id || !network || !data_package || !amount || !recipient_number || !momo_number) {
    return res.status(400).send("All fields are required.");
  }

  // Map network -> Moolre channel (from docs)
  function getChannel(network) {
    switch (network.toLowerCase()) {
      case "mtn":
        return 13; // MTN
      case "airteltigo":
      case "airtel":
      case "at":
        return 7; // AirtelTigo
      case "vodafone":
      case "telecel":
      case "voda":
        return 6; // Vodafone/Telecel
      default:
        return null;
    }
  }

  const channel = getChannel(network);
  if (!channel) {
    return res.status(400).send("❌ Invalid or unsupported network selected.");
  }

  try {
    // 🔐 Hardcoded Moolre Authentication
    const MOOLRE_USER   = "dataguygh";                // ← your Moolre username
    const MOOLRE_PUBKEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyaWQiOjEwNjkxNywiZXhwIjoxOTI1MDA5OTk5fQ.x2qzFc-tmOGM0j9tqD3KEsrRzkVFZ3cxvJMukb4bfos"; // ← paste full Public API key here (one line)
    const MOOLRE_WALLET = "10691706051041";           // ← GHS Wallet (correct one)

    // Debug auth being used (doesn't print full key)
    console.log("🔐 Using Moolre auth:", {
      user: MOOLRE_USER,
      pubkeyStart: MOOLRE_PUBKEY.substring(0, 25) + "...",
      wallet: MOOLRE_WALLET,
    });

    // Unique transaction reference
    const transactionId = `TRX${Date.now()}`.slice(0, 30);

    // 🔥 Moolre payment payload (matches docs)
    const payload = {
      type: 1,
      channel: channel,
      currency: "GHS",
      payer: momo_number,            // e.g. "0532XXXXXX"
      amount: Number(amount),        // e.g. 0.20
      externalref: transactionId,
      otpcode: "",                   // first call = empty
      reference: `Purchase of ${data_package}`,
      accountnumber: MOOLRE_WALLET,
    };

    console.log("📤 Sending to Moolre:", payload);

    const response = await axios.post(
      "https://api.moolre.com/open/transact/payment",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "X-API-USER": MOOLRE_USER,
          "X-API-PUBKEY": MOOLRE_PUBKEY,
        },
        timeout: 30000,
      }
    );

    console.log("✅ Moolre payment response:", response.data);

    const mResp = response.data;
    const statusNum = Number(mResp.status); // 1 = success, 0 = failed
    const code = mResp.code;
    const message = mResp.message;

    const isSuccess = statusNum === 1;

    if (isSuccess) {
      // ====== DB: save order into admin_orders ======
      const insertSql = `
        INSERT INTO admin_orders 
          (vendor_id, recipient_number, data_package, amount, network, status, sent_at)
        VALUES (?, ?, ?, ?, ?, 'pending', NOW())
      `;
      db.query(insertSql, [vendor_id, recipient_number, data_package, amount, network], (err) => {
        if (err) console.error("❌ Failed to insert into admin_orders:", err);
        else console.log("✅ Order successfully inserted into admin_orders.");
      });

      // ====== Commission logic (98% vendor, 2% revenue) ======
      const revenueAmount = (amount * 0.02).toFixed(2);
      const vendorAmount = (amount - revenueAmount).toFixed(2);

      // 98% to wallet_loads
      db.query(
        "INSERT INTO wallet_loads (vendor_id, momo, amount, date_loaded) VALUES (?, ?, ?, NOW())",
        [vendor_id, momo_number, vendorAmount],
        (err) => {
          if (err) console.error("❌ Failed to insert into wallet_loads:", err);
        }
      );

      // 2% to total_revenue
      db.query(
        "INSERT INTO total_revenue (vendor_id, source, amount, date_received) VALUES (?, ?, ?, NOW())",
        [vendor_id, `2% from ${network} payment`, revenueAmount],
        (err) => {
          if (err) console.error("❌ Failed to insert into total_revenue:", err);
        }
      );

      // TP14 = OTP / verification flow, but from your side you just tell user to approve
      if (code === "TP14") {
        return res.send(
          "✅ Payment request sent. " +
          (message || "Please complete the verification / approval sent to your phone.")
        );
      }

      return res.send("✅ Payment successful.");
    }

    // If we get here, Moolre says the payment failed
    console.error("❌ Moolre reported failure:", mResp);
    return res
      .status(400)
      .send(`❌ Payment failed: ${message || "Authentication / validation error"}`);

  } catch (err) {
    console.error("🚫 Moolre error:", err.response?.data || err.message);
    return res.status(400).send("❌ Payment failed or cancelled.");
  }
});






//deleting users
app.delete("/api/delete-user/:id", (req, res) => {
  const userId = req.params.id;
  const sql = "DELETE FROM users WHERE id = ?";
  db.query(sql, [userId], (err) => {
    if (err) return res.status(500).send("Failed to delete user.");
    res.send("User deleted successfully.");
  });
});




// ✅ API to get total revenue amount
app.get("/api/total-revenue", (req, res) => {
  const sql = `SELECT SUM(amount) AS total FROM total_revenue`;
  db.query(sql, (err, result) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).send("Error retrieving total revenue.");
    }
    const total = result[0].total || 0;
    res.json({ total });
  });
});

///////////////////////////////////////////////////
// ===================== ADMIN DATA PACKAGES ===================== //

app.post("/api/admin/data-packages", async (req, res) => {
  try {
    const { package_name, price, network } = req.body;

    if (!package_name || !price || !network) {
      return res.json({
        success: false,
        message: "Package name, price and network are required.",
      });
    }

    // Optional: validate network
    const allowed = ["mtn", "airteltigo", "telecel"];
    if (!allowed.includes(network.toLowerCase())) {
      return res.json({
        success: false,
        message: "Invalid network. Use mtn, airteltigo or telecel.",
      });
    }

    await db
      .promise()
      .query(
        "INSERT INTO AdminData (package_name, price, network, status) VALUES (?, ?, ?, 'active')",
        [package_name, price, network.toLowerCase()]
      );

    res.json({ success: true, message: "Package added successfully." });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Server error while adding package." });
  }
});


// Get all data packages
app.get("/api/admin/data-packages", async (req, res) => {
  try {
    const [rows] = await db
      .promise()
      .query(`
        SELECT id, package_name, price, network, status, created_at
        FROM AdminData
        ORDER BY 
          FIELD(network, 'mtn', 'airteltigo', 'telecel'),  -- MTN first, then AirtelTigo, then Telecel
          id DESC                                           -- newest first inside each network
      `);

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Failed to fetch packages." });
  }
});


// Activate / Deactivate a package
app.patch("/api/admin/data-packages/:id/status", (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // "active" or "inactive"

  if (!["active", "inactive"].includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status" });
  }

  const sql = `UPDATE AdminData SET status = ? WHERE id = ?`;
  db.query(sql, [status, id], (err, result) => {
    if (err) {
      console.error("Error updating status:", err);
      return res.status(500).json({ success: false, message: "Database error" });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }
    return res.json({ success: true, message: `Package ${status}` });
  });
});

// Delete a package
app.delete("/api/admin/data-packages/:id", (req, res) => {
  const { id } = req.params;

  const sql = `DELETE FROM AdminData WHERE id = ?`;
  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error("Error deleting package:", err);
      return res.status(500).json({ success: false, message: "Database error" });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }
    return res.json({ success: true, message: "Package deleted" });
  });
});
//////////////////////////////////////////////////////////////////////////




// 📞 Get all telephone numbers
app.get("/api/telephone-numbers", (req, res) => {
  const sql = "SELECT * FROM telephone_numbers ORDER BY id DESC";
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching numbers:", err);
      res.status(500).json({ error: "Failed to fetch numbers" });
    } else {
      res.json(results);
    }
  });
});


// ✅ Update status (Allow / Deny)
app.post("/api/update-status", (req, res) => {
  const { id, status } = req.body;
  if (!id || !status) return res.status(400).json({ error: "Invalid data" });

  const sql = "UPDATE telephone_numbers SET status = ? WHERE id = ?";
  db.query(sql, [status, id], (err, result) => {
    if (err) {
      console.error("Error updating status:", err);
      res.status(500).json({ error: "Database error" });
    } else {
      res.json({ success: true });
    }
  });
});



// Configure Multer for Excel uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// ✅ 1. Upload Excel and save numbers
app.post("/api/upload-numbers", upload.single("excelFile"), (req, res) => {
  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet);

    let inserted = 0;
    rows.forEach(row => {
      const phone = row.phone_number || row.phone || row.number;
      if (phone) {
        db.query(
          "INSERT IGNORE INTO telephone_numbers (phone_number) VALUES (?)",
          [phone],
          (err) => {
            if (!err) inserted++;
          }
        );
      }
    });

    res.json({ message: `${inserted} numbers uploaded successfully.` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to process Excel file." });
  }
});

// ✅ 2. Add single phone number manually
app.post("/api/add-number", (req, res) => {
  const { phone_number } = req.body;
  if (!phone_number) return res.status(400).json({ error: "Phone number is required" });

  db.query(
    "INSERT INTO telephone_numbers (phone_number) VALUES (?)",
    [phone_number],
    (err) => {
      if (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to add number" });
      } else {
        res.json({ message: "Number added successfully!" });
      }
    }
  );
});



app.post("/api/check-order", (req, res) => {
  const { recipient_number } = req.body;

  if (!recipient_number) return res.status(400).send("Phone number required.");

  const sql = "SELECT status, amount, data_package, recipient_number FROM data_orders WHERE recipient_number = ?";
  db.query(sql, [recipient_number], (err, rows) => {
    if (err) return res.status(500).send("Database error.");
    res.json(rows);
  });
});


app.get("/api/afa-price/:vendor_id", (req, res) => {
  const vendorId = req.params.vendor_id;
  const sql = "SELECT price FROM afa_prices WHERE user_id = ? ORDER BY id DESC LIMIT 1";

  db.query(sql, [vendorId], (err, result) => {
    if (err) {
      console.error("Price fetch error:", err);
      return res.status(500).json({ message: "Failed to get price" });
    }
    if (!result.length) {
      return res.status(404).json({ message: "No price set for this vendor" });
    }
    res.json({ price: result[0].price });
  });
});

app.post("/api/submit-afa-payment", async (req, res) => {
  const {
    vendor_id, momo_number, network,
    fullname, id_number, dob, phone_number,
    location, region, occupation
  } = req.body;

  if (!vendor_id || !momo_number || !network || !fullname || !id_number || !dob || !phone_number || !location || !region || !occupation) {
    return res.status(400).json({ success: false, message: "Missing AFA form fields." });
  }

  const priceQuery = "SELECT price FROM afa_prices WHERE user_id = ? ORDER BY id DESC LIMIT 1";
  db.query(priceQuery, [vendor_id], async (err, rows) => {
    if (err || !rows.length) return res.status(500).json({ success: false, message: "Failed to retrieve price." });

    const amount = parseFloat(rows[0].price);
    const revenueAmount = (amount * 0.02).toFixed(2);
    const vendorAmount = (amount - revenueAmount).toFixed(2);

    function getSwitchCode(net) {
      switch (net.toLowerCase()) {
        case "mtn": return "MTN";
        case "vodafone":
        case "telecel": return "VDF";
        case "airteltigo":
        case "airtel": return "ATL";
        case "tigo": return "TGO";
        default: return null;
      }
    }

    const rSwitch = getSwitchCode(network);
    const formattedMoMo = momo_number.replace(/^0/, "233");
    const transactionId = `TRX-AFA-${Date.now()}`.slice(0, 30);
    const amountFormatted = String(Math.round(amount * 100)).padStart(12, "0");

    const payload = {
      amount: amountFormatted,
      processing_code: "000200",
      transaction_id: transactionId,
      desc: "AFA Registration",
      merchant_id: "TTM-00010694",
      subscriber_number: formattedMoMo,
      "r-switch": rSwitch,
      redirect_url: "https://example.com/afa-callback"
    };

    const token = Buffer.from(`sandipay6821f47c4bfc0:ZjZjMWViZGY0OGVjMDViNjBiMmM1NmMzMmU3MGE1YzQ=`).toString("base64");

    try {
      const response = await axios.post("https://prod.theteller.net/v1.1/transaction/process", payload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${token}`,
          "Cache-Control": "no-cache"
        }
      });

      const status = response.data.status?.toLowerCase();
      const code = response.data.code;

      if (status === "approved" || status === "successful" || code === "000") {
        db.query(`INSERT INTO wallet_loads (vendor_id, momo, amount, date_loaded) VALUES (?, ?, ?, NOW())`, [vendor_id, momo_number, vendorAmount]);
        db.query(`INSERT INTO total_revenue (vendor_id, source, amount, date_received) VALUES (?, ?, ?, NOW())`, [vendor_id, "2% from AFA registration", revenueAmount]);
        db.query(`INSERT INTO afa_requests (vendor_id, fullname, id_number, dob, phone_number, location, region, occupation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [vendor_id, fullname, id_number, dob, phone_number, location, region, occupation]);

        return res.json({ success: true, message: "Payment and registration completed" });
      } else {
        return res.status(400).json({ success: false, message: "Payment declined." });
      }

    } catch (error) {
      console.error("❌ AFA Payment error:", error.response?.data || error.message);
      return res.status(500).json({ success: false, message: "Payment failed or cancelled." });
    }
  });
});











app.post("/api/transactions", (req, res) => {
  const { userId } = req.body;
  const sql = "SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1";
  db.query(sql, [userId], (err, result) => {
    if (err) return res.status(500).send("Error fetching transactions");
    res.json(result);
  });
});

const { v4: uuidv4 } = require("uuid"); 

const { format } = require("date-fns");

app.get("/api/export-mtn-orders", (req, res) => {
  const vendorId = req.query.vendor_id;
  if (!vendorId) return res.status(400).send("Vendor ID missing");

  const now = new Date();
  const newPackageId = format(now, "yyyy-MM-dd HH:mm");

  const assignQuery = `
    UPDATE data_orders
    SET package_id = ?
    WHERE vendor_id = ? AND status = 'pending' AND network = 'mtn'
  `;

  db.query(assignQuery, [newPackageId, vendorId], (err) => {
    if (err) return res.status(500).send("Error assigning package ID");

    const selectQuery = `
      SELECT recipient_number, data_package, amount, status, created_at
      FROM data_orders
      WHERE vendor_id = ? AND package_id = ?
    `;

    db.query(selectQuery, [vendorId, newPackageId], async (err, rows) => {
      if (err) return res.status(500).send("Error fetching for export");

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("MTN Orders");

      worksheet.columns = [
  { header: "Recipient", key: "recipient_number", width: 20, style: { numFmt: '@' } },
  { header: "Package", key: "data_package", width: 15 },
      ];

     
// Add sorted rows to excel
rows.forEach(row => {
  const cleanPackage = row.data_package.replace(/[^\d.]/g, '');

  // Convert 233XXXXXXXXX -> 0XXXXXXXXX
  let recipient = String(row.recipient_number || "").replace(/\D/g, "");
  if (recipient.startsWith("233") && recipient.length === 12) {
    recipient = "0" + recipient.slice(3);
  }

  // Zero-width space to force Excel TEXT without showing anything
  const textRecipient = "\u200B" + recipient;

  worksheet.addRow({
    recipient_number: textRecipient,
    data_package: cleanPackage
  });
});




      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=mtn_orders.xlsx");
      await workbook.xlsx.write(res);
      res.end();
    });
  });
});



app.post("/api/mark-package-delivered", (req, res) => {
  const { package_id } = req.body;
  const query = `UPDATE data_orders SET status = 'delivered' WHERE package_id = ?`;
  db.query(query, [package_id], (err) => {
    if (err) return res.status(500).send("Update failed");
    res.send("Package marked as delivered.");
  });
});

app.post("/api/mtn-orders", (req, res) => {
  const { vendor_id } = req.body;
  if (!vendor_id) return res.status(400).send("Missing vendor_id");

  const query = `
    SELECT id, recipient_number, data_package, amount, status, created_at, package_id
    FROM data_orders
    WHERE vendor_id = ? AND network = 'mtn'
    ORDER BY created_at DESC
  `;

  db.query(query, [vendor_id], (err, results) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).send("Database error");
    }
    res.json(results);
  });
});


// ✅ UPDATE ORDER STATUS
app.post("/api/update-order-status", (req, res) => {
  const { recipient_number, new_status, vendor_id } = req.body;

  const sql = `
    UPDATE data_orders
    SET status = ?
    WHERE recipient_number = ? AND vendor_id = ?
  `;

  db.query(sql, [new_status, recipient_number, vendor_id], (err, result) => {
    if (err) {
      console.error("Failed to update order status:", err);
      return res.status(500).send("Failed to update status.");
    }
    res.send("Order status updated successfully.");
  });
});


// ✅ MARK ORDER AS DELIVERED
app.post("/api/mark-delivered", (req, res) => {
  const { id } = req.body;

  const sql = `
    UPDATE data_orders
    SET status = 'delivered'
    WHERE id = ?
  `;

  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error("Failed to mark as delivered:", err);
      return res.status(500).send("Failed to mark as delivered.");
    }

    if (result.affectedRows === 0) return res.status(404).send("Order not found.");
    res.send("Marked as delivered.");
  });
});


// Telecel Orders
app.post("/api/telecel-orders", (req, res) => {
  const { vendor_id } = req.body;
  if (!vendor_id) return res.status(400).send("Missing vendor_id");

  const query = `
    SELECT id, recipient_number, data_package, amount, status, created_at, package_id
    FROM data_orders
    WHERE vendor_id = ? AND network = 'telecel'
    ORDER BY created_at DESC
  `;

  db.query(query, [vendor_id], (err, results) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).send("Database error");
    }
    res.json(results);
  });
});


app.get("/api/export-telecel-orders", (req, res) => {
  const vendorId = req.query.vendor_id;
  if (!vendorId) return res.status(400).send("Vendor ID missing");

  const now = new Date();
  const newPackageId = format(now, "yyyy-MM-dd HH:mm");

  const assignQuery = `
    UPDATE data_orders
    SET package_id = ?
    WHERE vendor_id = ? AND status = 'pending' AND network = 'telecel'
  `;

  db.query(assignQuery, [newPackageId, vendorId], (err) => {
    if (err) return res.status(500).send("Error assigning package ID");

    const selectQuery = `
      SELECT recipient_number, data_package, amount, status, created_at
      FROM data_orders
      WHERE vendor_id = ? AND package_id = ?
    `;
    db.query(selectQuery, [vendorId, newPackageId], async (err, rows) => {
      if (err) return res.status(500).send("Error fetching for export");

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Telecel Orders");

      worksheet.columns = [
        { header: "Recipient", key: "recipient_number" },
        { header: "Package", key: "data_package" },
        
      ];

        rows.forEach(row => {
        const cleanPackage = row.data_package.replace(/[^\d.]/g, '');
        sheet.addRow({
          recipient_number: row.recipient_number,
          data_package: cleanPackage
        });
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=telecel_orders.xlsx");

      await workbook.xlsx.write(res);
      res.end();
    });
  });
});


// AirtelTigo Orders
app.post("/api/airteltigo-orders", (req, res) => {
  const { vendor_id } = req.body;
  if (!vendor_id) return res.status(400).send("Missing vendor_id");

  const query = `
    SELECT id, recipient_number, data_package, amount, status, created_at, package_id
    FROM data_orders
    WHERE vendor_id = ? AND network = 'airteltigo'
    ORDER BY created_at DESC
  `;

  db.query(query, [vendor_id], (err, results) => {
    if (err) return res.status(500).send("Database error");
    res.json(results);
  });
});


app.get("/api/export-airteltigo-orders", (req, res) => {
  const vendorId = req.query.vendor_id;
  if (!vendorId) return res.status(400).send("Missing vendor ID.");

  const sql = `
    SELECT recipient_number, data_package
    FROM data_orders
    WHERE vendor_id = ? AND status = 'pending' AND network = 'airteltigo'
  `;

  db.query(sql, [vendorId], async (err, rows) => {
    if (err) return res.status(500).send("Failed to fetch orders.");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Pending AirtelTigo Orders");
    sheet.columns = [
      { header: "Recipient Number", key: "recipient_number", width: 25 },
      { header: "Data Package", key: "data_package", width: 30 }
    ];
      rows.forEach(row => {
        const cleanPackage = row.data_package.replace(/[^\d.]/g, '');
        sheet.addRow({
          recipient_number: row.recipient_number,
          data_package: cleanPackage
        });
      });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=pending_airteltigo_orders.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  });
});






// ✅ SET ORDERS TO PROCESSING AFTER SENDING TO ADMIN
app.post("/api/set-orders-processing", (req, res) => {
  const { vendor_id, network } = req.body;

  if (!vendor_id || !network) {
    return res.status(400).send("Vendor ID and network are required.");
  }

  const query = `
    UPDATE data_orders 
    SET status = 'processing'
    WHERE vendor_id = ? AND network = ? AND status = 'pending'
  `;

  db.query(query, [vendor_id, network], (err) => {
    if (err) {
      console.error("❌ Error updating status to processing:", err);
      return res.status(500).send("Failed to update order status.");
    }
    res.send("Please Refresh your Page.");
  });
});


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////

app.post("/api/send-orders-to-admin", (req, res) => {
  const { vendor_id, network } = req.body;

  if (!vendor_id || !network) {
    return res.status(400).send("Vendor ID and network are required.");
  }

  // Step 1: Fetch vendor's pending orders
  const fetchOrdersSql = `
    SELECT id, recipient_number, data_package, amount 
    FROM data_orders 
    WHERE vendor_id = ? AND network = ? AND status = 'pending'
  `;

  db.query(fetchOrdersSql, [vendor_id, network], (err, orders) => {
    if (err || !orders.length) {
      return res.status(404).send("No pending orders found.");
    }

    // Step 2: Get matching admin prices
    const packageNames = [...new Set(orders.map(o => o.data_package))];
    const placeholders = packageNames.map(() => '?').join(',');

    const adminPriceSql = `
      SELECT data_package, amount 
      FROM admin_data_packages 
      WHERE network = ? AND data_package IN (${placeholders})
    `;

    db.query(adminPriceSql, [network, ...packageNames], (adminErr, adminPrices) => {
      if (adminErr) {
        console.error("Admin price fetch failed:", adminErr);
        return res.status(500).send("Failed to fetch admin prices.");
      }

      const priceMap = {};
      adminPrices.forEach(p => {
        priceMap[p.data_package] = parseFloat(p.amount);
      });

      const matchedOrders = orders.filter(o => priceMap[o.data_package] !== undefined);
      if (!matchedOrders.length) {
        return res.status(400).send("No matching admin packages found.");
      }

      // Step 3: Calculate total amount required
      const totalAdminAmount = matchedOrders.reduce((sum, o) => {
        return sum + priceMap[o.data_package];
      }, 0);

      // Step 4: Check vendor's current wallet balance
      const balanceSql = `
        SELECT SUM(amount) AS balance FROM wallet_loads WHERE vendor_id = ?
      `;

      db.query(balanceSql, [vendor_id], (balErr, balResult) => {
        if (balErr) {
          console.error("Wallet balance check failed:", balErr);
          return res.status(500).send("Failed to check wallet balance.");
        }

        const balance = parseFloat(balResult[0].balance) || 0;

        if (balance < totalAdminAmount) {
          return res.status(400).send("❌ You don’t have sufficient balance.");
        }

        // Step 5: Insert into admin_orders
        const now = new Date();
        const insertAdminValues = matchedOrders.map(o => [
          vendor_id,
          o.recipient_number,
          o.data_package,
          priceMap[o.data_package],
          network,
          'pending',
          now
        ]);

        const insertAdminSql = `
          INSERT INTO admin_orders (vendor_id, recipient_number, data_package, amount, network, status, sent_at)
          VALUES ?
        `;

        db.query(insertAdminSql, [insertAdminValues], (insertErr) => {
          if (insertErr) {
            console.error("Insert into admin_orders failed:", insertErr);
            return res.status(500).send("Failed to send orders to admin.");
          }

          // Step 6: Deduct from wallet
          const momo = "system";
          const deductWalletSql = `
            INSERT INTO wallet_loads (vendor_id, momo, amount, date_loaded)
            VALUES (?, ?, ?, NOW())
          `;

          db.query(deductWalletSql, [vendor_id, momo, -totalAdminAmount], (walletErr) => {
            if (walletErr) {
              console.error("Wallet deduction failed:", walletErr);
              return res.status(500).send("Orders sent, but wallet deduction failed.");
            }

            // Step 7: Log total revenue
            const source = `${network.toUpperCase()} orders sent to admin`;
            const logRevenueSql = `
              INSERT INTO total_revenue (vendor_id, source, amount, date_received)
              VALUES (?, ?, ?, NOW())
            `;

            db.query(logRevenueSql, [vendor_id, source, totalAdminAmount], (revErr) => {
              if (revErr) {
                console.error("Revenue logging failed:", revErr);
                return res.status(500).send("Orders sent, but revenue logging failed.");
              }

              // Step 8: Update data_orders status to 'processing' and add package_id
          // ✅ Step 8: Update only matched data_orders to 'processing'
const matchedOrderIds = matchedOrders.map(o => o.id);

// Safety check: do not proceed if no matches (redundant but safe)
if (!matchedOrderIds.length) {
  return res.status(400).send("No matching admin packages found.");
}

// Generate a unique package ID from timestamp
const packageId = now.toISOString().slice(0, 16).replace('T', ' ');

// Prepare query
const updateDataOrdersSql = `
  UPDATE data_orders 
  SET status = 'processing', package_id = ?
  WHERE id IN (${matchedOrderIds.map(() => '?').join(',')})
`;

db.query(updateDataOrdersSql, [packageId, ...matchedOrderIds], (updateErr) => {
  if (updateErr) {
    console.error("Failed to update data_orders:", updateErr);
    return res.status(500).send("Orders sent but data_orders not updated.");
  }

  res.send("✅ Orders sent Successfully.");
});
            });
          });
        });
      });
    });
  });
});










// ✅ LOAD WALLET
// ✅ NEW: Load Wallet via TheTeller for all networks
app.post("/api/load-wallet-the-teller", async (req, res) => {
  const { momo, amount, vendor_id, network } = req.body;

  if (!momo || !amount || !vendor_id || !network) {
    return res.status(400).send("All fields are required.");
  }
  
  // Format values
  const amountFormatted = String(Math.round(amount * 100)).padStart(12, "0");
  const formattedMoMo = momo.replace(/^0/, "233");

  // Map to r-switch
  function getSwitchCode(net) {
    switch (net.toLowerCase()) {
      case "mtn": return "MTN";
      case "vodafone":
      case "telecel": return "VDF";
      case "airteltigo":
      case "airtel": return "ATL";
      case "tigo": return "TGO";
      default: return null;
    }
  }

  const rSwitch = getSwitchCode(network);
  if (!rSwitch) return res.status(400).send("Unsupported network selected");

  const payload = {
    amount: amountFormatted,
    processing_code: "000200",
    transaction_id: `LOAD${Date.now()}`.slice(0, 30),
    desc: `Wallet Top-up - ${network.toUpperCase()}`,
    merchant_id: "TTM-00010694",
    subscriber_number: formattedMoMo,
    "r-switch": rSwitch,
    redirect_url: "https://example.com/callback"
  };

  try {
    const token = Buffer.from(`sandipay6821f47c4bfc0:ZjZjMWViZGY0OGVjMDViNjBiMmM1NmMzMmU3MGE1YzQ=`).toString("base64");

    const response = await axios.post(
      "https://prod.theteller.net/v1.1/transaction/process",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${token}`,
          "Cache-Control": "no-cache"
        }
      }
    );

    console.log("🔁 Load wallet response:", response.data);

    const status = response.data.status?.toLowerCase();
    const code = response.data.code;

    if (status === "approved" || status === "successful" || code === "000") {
      db.query(
        `INSERT INTO wallet_loads (vendor_id, momo, amount, date_loaded) VALUES (?, ?, ?, NOW())`,
        [vendor_id, momo, amount]
      );

      return res.send("✅ Wallet loaded successfully.");
    } else {
      return res.status(400).send("❌ Wallet load failed or declined.");
    }
  } catch (err) {
    console.error("❌ TheTeller error:", err.response?.data || err.message);
    return res.status(400).send("❌ Wallet load failed.");
  }
});


// ✅ FETCH WALLET BALANCE
app.post("/api/wallet-balance", (req, res) => {
  const { vendor_id } = req.body;
  if (!vendor_id) return res.status(400).send("Missing vendor ID");

  const sql = "SELECT SUM(amount) AS balance FROM wallet_loads WHERE vendor_id = ?";
  db.query(sql, [vendor_id], (err, result) => {
    if (err) return res.status(500).send("Error fetching balance");
    const balance = result[0].balance || 0;
    res.json({ balance });
  });
});

// ✅ FETCH DELIVERED ORDERS
app.post("/api/fetch-delivered-orders", (req, res) => {
  const { vendor_id } = req.body;
  const sql = `
    SELECT recipient_number, data_package, amount, network 
    FROM data_orders 
    WHERE vendor_id = ? AND status = 'delivered' 
    ORDER BY created_at DESC
  `;
  db.query(sql, [vendor_id], (err, rows) => {
    if (err) return res.status(500).send("Failed to fetch delivered orders.");
    res.json(rows);
  });
});


app.post("/api/dashboard-metrics", (req, res) => {
  const { vendor_id } = req.body;
  if (!vendor_id) return res.status(400).send("Missing vendor ID.");

  const metrics = {};

  // Wallet balance first
  const q0 = `SELECT SUM(amount) AS wallet_balance FROM wallet_loads WHERE vendor_id = ?`;
  db.query(q0, [vendor_id], (err, wallet) => {
    if (err) return res.status(500).send("Error fetching wallet.");
    metrics.wallet_balance = wallet[0].wallet_balance || 0;

    // Continue with all other queries as before
    const q1 = `SELECT COUNT(DISTINCT recipient_number) AS total_customers FROM data_orders WHERE vendor_id = ?`;
    db.query(q1, [vendor_id], (err, r1) => {
      if (err) return res.status(500).send("Error fetching customers.");
      metrics.total_customers = r1[0].total_customers;

      const q2 = `SELECT COUNT(*) AS total_transactions FROM data_orders WHERE vendor_id = ? AND status = 'delivered'`;
      db.query(q2, [vendor_id], (err, r2) => {
        if (err) return res.status(500).send("Error fetching transactions.");
        metrics.total_transactions = r2[0].total_transactions;

        const q3 = `SELECT COUNT(*) AS pending_mtn FROM data_orders WHERE vendor_id = ? AND status = 'pending' AND network = 'mtn'`;
        db.query(q3, [vendor_id], (err, r3) => {
          if (err) return res.status(500).send("Error fetching pending MTN.");
          metrics.pending_mtn = r3[0].pending_mtn;

          const q4 = `SELECT COUNT(*) AS pending_at FROM data_orders WHERE vendor_id = ? AND status = 'pending' AND network = 'airteltigo'`;
          db.query(q4, [vendor_id], (err, r4) => {
            if (err) return res.status(500).send("Error fetching pending AT.");
            metrics.pending_at = r4[0].pending_at;

            const q5 = `SELECT COUNT(*) AS pending_telecel FROM data_orders WHERE vendor_id = ? AND status = 'pending' AND network = 'telecel'`;
            db.query(q5, [vendor_id], (err, r5) => {
              if (err) return res.status(500).send("Error fetching pending Telecel.");
              metrics.pending_telecel = r5[0].pending_telecel;

              const q6 = `SELECT COUNT(*) AS pending_afa FROM afa_requests WHERE vendor_id = ?`;
              db.query(q6, [vendor_id], (err, r6) => {
                if (err) return res.status(500).send("Error fetching pending AFA.");
                metrics.pending_afa = r6[0].pending_afa;

                const q7 = `SELECT COUNT(*) AS completed_afa FROM afa_requests WHERE vendor_id = ?`;
                db.query(q7, [vendor_id], (err, r7) => {
                  if (err) return res.status(500).send("Error fetching completed AFA.");
                  metrics.completed_afa = r7[0].completed_afa;

                  // ✅ Finally respond with all metrics including wallet_balance
                  res.json(metrics);
                });
              });
            });
          });
        });
      });
    });
  });
});



app.post("/api/dashboard-stats", (req, res) => {
  const vendorId = req.body.vendor_id;
  const queries = {
    total_customers: `
      SELECT COUNT(DISTINCT recipient_number) AS count
      FROM data_orders
      WHERE vendor_id = ? AND status IN ('pending', 'delivered')
    `,
    total_transactions: `
      SELECT COUNT(*) AS count
      FROM data_orders
      WHERE vendor_id = ? AND status = 'delivered'
    `,
    pending_mtn: `
      SELECT COUNT(*) AS count
      FROM data_orders
      WHERE vendor_id = ? AND network = 'mtn' AND status = 'pending'
    `,
    pending_at: `
      SELECT COUNT(*) AS count
      FROM data_orders
      WHERE vendor_id = ? AND network = 'airteltigo' AND status = 'pending'
    `,
    pending_telecel: `
      SELECT COUNT(*) AS count
      FROM data_orders
      WHERE vendor_id = ? AND network = 'telecel' AND status = 'pending'
    `,
    pending_afa: `
      SELECT COUNT(*) AS count
      FROM afa_requests
      WHERE vendor_id = ?
    `,
    completed_afa: `
      SELECT COUNT(*) AS count
      FROM afa_requests
      WHERE vendor_id = ? AND status = 'completed'
    `
  };

  const results = {};
  const keys = Object.keys(queries);
  let remaining = keys.length;

  keys.forEach(key => {
    db.query(queries[key], [vendorId], (err, rows) => {
      if (err) {
        results[key] = 0;
      } else {
        results[key] = rows[0]?.count || 0;
      }

      remaining--;
      if (remaining === 0) {
        res.json(results);
      }
    });
  });
});

// ✅ GET WALLET BALANCE
app.post("/api/get-wallet-balance", (req, res) => {
  const { vendor_id } = req.body;

  const sql = `
    SELECT COALESCE(SUM(amount), 0) AS total 
    FROM wallet_loads 
    WHERE vendor_id = ?
  `;
  db.query(sql, [vendor_id], (err, rows) => {
    if (err) {
      console.error("Error fetching wallet:", err);
      return res.status(500).send("Failed to get wallet balance.");
    }
    res.json({ balance: rows[0].total });
  });
});



app.get("/api/download-afa-orders", (req, res) => {
  const { vendor_id } = req.query;
  if (!vendor_id) return res.status(400).send("Missing vendor ID");

  const sql = `
    SELECT fullname, id_number, dob, phone_number, location, region, occupation, status 
    FROM afa_requests 
    WHERE vendor_id = ? AND status = 'pending'
  `;

  db.query(sql, [vendor_id], async (err, rows) => {
    if (err) return res.status(500).send("Error fetching pending AFA data");

    if (!rows.length) return res.status(404).send("No pending AFA orders found");

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Pending AFA Orders");

    sheet.columns = [
      { header: "Full Name", key: "fullname", width: 25 },
      { header: "ID Number", key: "id_number", width: 20 },
      { header: "DOB", key: "dob", width: 15 },
      { header: "Phone", key: "phone_number", width: 15 },
      { header: "Location", key: "location", width: 20 },
      { header: "Region", key: "region", width: 20 },
      { header: "Occupation", key: "occupation", width: 20 },
      { header: "Status", key: "status", width: 15 }
    ];

    rows.forEach(row => sheet.addRow(row));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=pending_afa_orders.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  });
});

app.post("/api/fetch-afa-orders", (req, res) => {
  const { vendor_id } = req.body;

  const sql = `
    SELECT id, fullname, id_number, dob, phone_number, location, region, occupation, status
    FROM afa_requests
    WHERE vendor_id = ?
    ORDER BY id DESC
  `;

  db.query(sql, [vendor_id], (err, rows) => {
    if (err) {
      console.error("Error fetching AFA orders:", err);
      return res.status(500).send("Failed to fetch AFA orders.");
    }
    res.json(rows);
  });
});

// ✅ UPDATE AFA STATUS
app.post("/api/update-afa-status", (req, res) => {
  const { id, status } = req.body;

  if (!id || !status) return res.status(400).send("Missing fields");

  const sql = "UPDATE afa_requests SET status = ? WHERE id = ?";
  db.query(sql, [status, id], (err) => {
    if (err) {
      console.error("Failed to update AFA status:", err);
      return res.status(500).send("Failed to update status");
    }
    res.send("AFA status updated successfully");
  });
});


 app.post("/api/request-withdrawal", (req, res) => {
  const { vendor_id, momo_number, amount, network } = req.body;

  if (!vendor_id || !momo_number || !amount || !network) {
    return res.status(400).send("All fields are required.");
  }

  const checkSql = "SELECT SUM(amount) AS balance FROM wallet_loads WHERE vendor_id = ?";
  db.query(checkSql, [vendor_id], (err, result) => {
    if (err) return res.status(500).send("Error checking wallet balance.");

    const balance = result[0].balance || 0;
    if (balance < amount) {
      return res.status(400).send("Insufficient wallet balance.");
    }

    // ✅ NEW: Fetch vendor name first
    db.query("SELECT username FROM users WHERE id = ?", [vendor_id], (nameErr, nameResult) => {
      if (nameErr || !nameResult.length) {
        return res.status(500).send("Failed to fetch vendor name.");
      }

      const vendor_name = nameResult[0].username;

      // ✅ Insert into withdrawal_requests (correct table now)
      const insertSql = `
        INSERT INTO withdrawal_requests (vendor_id, vendor_name, momo_number, amount, network, status, requested_at)
        VALUES (?, ?, ?, ?, ?, 'pending', NOW())
      `;

      db.query(insertSql, [vendor_id, vendor_name, momo_number, amount, network], (err) => {
        if (err) {
          console.error("❌ Error inserting withdrawal:", err);
          return res.status(500).send("Failed to request withdrawal.");
        }

        // Deduct from wallet
        const deductSql = `
          INSERT INTO wallet_loads (vendor_id, momo, amount, date_loaded)
          VALUES (?, ?, ?, NOW())
        `;
        db.query(deductSql, [vendor_id, momo_number, -amount], (deductErr) => {
          if (deductErr) {
            console.error("❌ Error deducting from wallet:", deductErr);
            return res.status(500).send("Wallet deduction failed.");
          }

          // ✅ Send Email to Admin
          const mailOptions = {
            from: '"DATAREQUEST" <Sandipayghana@gmail.com>',
            to: "Sandipayghana@gmail.com",
            subject: "New Withdrawal Request",
            text: `A vendor has submitted a withdrawal request:\n\nVendor: ${vendor_name} (ID: ${vendor_id})\nNetwork: ${network.toUpperCase()}\nMoMo Number: ${momo_number}\nAmount: GHS ${amount}\n\nPlease process this manually.`
          };

          transporter.sendMail(mailOptions, (emailErr, info) => {
            if (emailErr) {
              console.error("❌ Email error:", emailErr);
              return res.status(500).send("Request saved, but email failed.");
            }

            console.log("✅ Email sent:", info.response);
            res.send("✅ DONE! Please wait 5 to 10 minutes, your withdrawal is processing.");
          });
        });
      });
    });
  });
});




// ✅ GET all withdrawal requests sorted by vendor name
app.get("/api/withdrawal-requests", (req, res) => {
  const sql = `
    SELECT * FROM withdrawal_requests 
    ORDER BY vendor_name ASC, requested_at DESC
  `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).send("Failed to fetch withdrawal requests.");
    res.json(results);
  });
});

// ✅ UPDATE withdrawal status to 'paid'
app.post("/api/mark-withdrawal-paid", (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).send("Missing withdrawal ID");

  const sql = `UPDATE withdrawal_requests SET status = 'paid' WHERE id = ?`;
  db.query(sql, [id], (err) => {
    if (err) return res.status(500).send("Failed to update status.");
    res.send("✅ Status updated to PAID.");
  });
});





app.post("/api/mark-package-downloaded", (req, res) => {
  const { vendor_id, network } = req.body;
  if (!vendor_id || !network) return res.status(400).send("Vendor ID and network are required.");

  const pendingSql = `SELECT id FROM data_orders WHERE vendor_id = ? AND network = ? AND status = 'pending'`;
  db.query(pendingSql, [vendor_id, network], (err, orders) => {
    if (err) return res.status(500).send("Failed to check orders.");
    if (!orders.length) return res.status(404).send("No pending orders to mark.");

    const orderIds = orders.map(o => o.id);
    const checkSql = `SELECT package_id FROM downloaded_flags WHERE vendor_id = ? AND network = ? AND package_id IN (?)`;
    db.query(checkSql, [vendor_id, network, orderIds], (err2, markedRows) => {
      if (err2) return res.status(500).send("Failed to verify existing records.");

      const alreadyMarkedIds = new Set(markedRows.map(r => r.package_id));
      const toInsert = orderIds.filter(id => !alreadyMarkedIds.has(id));

      if (!toInsert.length) return res.status(409).send("You've already downloaded this package.");

      const insertValues = toInsert.map(id => [vendor_id, id, network]);
      const insertSql = `INSERT INTO downloaded_flags (vendor_id, package_id, network) VALUES ?`;

      db.query(insertSql, [insertValues], (err3) => {
        if (err3) return res.status(500).send("Insert error.");
        res.send(`Marked ${toInsert.length} orders as downloaded.`);
      });
    });
  });
});

app.post("/api/set-processing-status", (req, res) => {
  const { vendor_id, network } = req.body;
  if (!vendor_id || !network) return res.status(400).send("Missing vendor_id or network");

  const query = `
    UPDATE data_orders
    SET status = 'processing'
    WHERE vendor_id = ? AND status = 'pending' AND network = ?
  `;

  db.query(query, [vendor_id, network], (err) => {
    if (err) return res.status(500).send("Database update error");
    res.send("Status updated to processing.");
  });
});


app.get("/api/export-airtel-orders", (req, res) => {
  const vendorId = req.query.vendor_id;
  if (!vendorId) return res.status(400).send("Vendor ID missing");

  const now = new Date();
  const newPackageId = format(now, "yyyy-MM-dd HH:mm");

  const assignQuery = `
    UPDATE data_orders
    SET package_id = ?
    WHERE vendor_id = ? AND status = 'pending' AND network = 'airteltigo'
  `;

  db.query(assignQuery, [newPackageId, vendorId], (err) => {
    if (err) return res.status(500).send("Error assigning package ID");

    const selectQuery = `
      SELECT recipient_number, data_package, amount, status, created_at
      FROM data_orders
      WHERE vendor_id = ? AND package_id = ?
    `;
    db.query(selectQuery, [vendorId, newPackageId], async (err, rows) => {
      if (err) return res.status(500).send("Error fetching for export");

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("AirtelTigo Orders");

      worksheet.columns = [
        { header: "Recipient", key: "recipient_number" },
        { header: "Package", key: "data_package" },
     
      ];

        rows.forEach(row => {
        const cleanPackage = row.data_package.replace(/[^\d.]/g, '');
        sheet.addRow({
          recipient_number: row.recipient_number,
          data_package: cleanPackage
        });
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=airteltigo_orders.xlsx");

      await workbook.xlsx.write(res);
      res.end();
    });
  });
});



app.get("/api/export-afa-orders", async (req, res) => {
  const vendorId = req.query.vendor_id;

  // Step 1: Generate a new package_id for grouping
  const packageId = format(new Date(), "yyyy-MM-dd HH:mm");

  // Step 2: Update pending orders to include package_id and mark as processing
  db.query(
    `UPDATE afa_requests SET package_id = ?, status = 'processing' WHERE vendor_id = ? AND status = 'pending'`,
    [packageId, vendorId],
    (err) => {
      if (err) return res.status(500).send("Failed to update status");

      // Step 3: Fetch all orders just updated
      db.query(
        `SELECT * FROM afa_requests WHERE vendor_id = ? AND package_id = ?`,
        [vendorId, packageId],
        async (err, rows) => {
          if (err) return res.status(500).send("Failed to fetch orders");

          // Step 4: Build Excel
          const workbook = new ExcelJS.Workbook();
          const sheet = workbook.addWorksheet("AFA Orders");

          sheet.columns = [
            { header: "Full Name", key: "fullname" },
            { header: "ID Number", key: "id_number" },
            { header: "DOB", key: "dob" },
            { header: "Phone", key: "phone_number", style: { numFmt: "@" } },
            { header: "Location", key: "location" },
            { header: "Region", key: "region" },
            { header: "Occupation", key: "occupation" },
            { header: "Status", key: "status" },
            { header: "Date", key: "created_at" }
          ];

          rows.forEach(row => {
            row.phone_number = `'${row.phone_number}`;
            sheet.addRow(row);
          });

          // Step 5: Stream Excel to response
          res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          res.setHeader("Content-Disposition", "attachment; filename=afa_orders.xlsx");

          await workbook.xlsx.write(res);
          res.end(); // ✅ This line is essential
        }
      );
    }
  );
});




// ✅ BACKEND: Fetch all AFA orders with status = 'processing' grouped by package_id
// ✅ Fetch all AFA orders (processing + delivered) grouped by package_id
app.post("/api/afa-all-packages", (req, res) => {
  const { vendor_id } = req.body;
  if (!vendor_id) return res.status(400).send("Missing vendor ID");

  const sql = `
    SELECT * FROM afa_requests
    WHERE vendor_id = ? AND status IN ('processing', 'delivered')
    ORDER BY package_id DESC, created_at DESC
  `;
  db.query(sql, [vendor_id], (err, rows) => {
    if (err) {
      console.error("❌ Failed to fetch packages:", err);
      return res.status(500).send("Error fetching packages");
    }
    res.json(rows);
  });
});


// ✅ BACKEND: Mark all orders in a package as delivered
app.post("/api/mark-afa-delivered", (req, res) => {
  const { vendor_id, package_id } = req.body;
  if (!vendor_id || !package_id) return res.status(400).send("Missing vendor_id or package_id");

  const sql = `UPDATE afa_requests SET status = 'delivered' WHERE vendor_id = ? AND package_id = ?`;
  db.query(sql, [vendor_id, package_id], (err) => {
    if (err) return res.status(500).send("Failed to update package");
    res.send("✅ Marked as delivered");
  });
});





app.post("/api/mark-afa-delivered", (req, res) => {
  const { vendor_id, package_id } = req.body;

  const query = `
    UPDATE afa_requests
    SET status = 'delivered'
    WHERE vendor_id = ? AND package_id = ?
  `;

  db.query(query, [vendor_id, package_id], (err, result) => {
    if (err) {
      console.error("❌ Error marking AFA delivered:", err);
      return res.status(500).send("Failed to update status");
    }
    res.send("AFA package marked as delivered.");
  });
});



app.post("/api/set-afa-processing", (req, res) => {
  const { vendor_id } = req.body;
  db.query(`
    UPDATE afa_requests SET status = 'processing' 
    WHERE vendor_id = ? AND status = 'pending'`,
    [vendor_id],
    err => {
      if (err) return res.status(500).send("Error updating AFA status");
      res.send("AFA status updated to processing");
    });
});

app.post("/api/afa-orders", (req, res) => {
  const { vendor_id } = req.body;

  const query = "SELECT * FROM afa_requests WHERE vendor_id = ? ORDER BY created_at DESC";

  db.query(query, [vendor_id], (err, rows) => {
    if (err) {
      console.error("❌ MySQL Error in /api/afa-orders:", err); // ✅ Show exact error
      return res.status(500).send("Error loading AFA orders");
    }

    console.log("✅ AFA Orders Fetched:", rows.length);
    res.json(rows);
  });
});

app.post("/api/save-whatsapp-link", (req, res) => {
  const { vendor_id, link } = req.body;

  if (!vendor_id || !link) {
    return res.status(400).json({ message: "Missing vendor_id or link" });
  }

  const query = `
    INSERT INTO whatsapp_community_links (vendor_id, link)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE link = VALUES(link)
  `;

  db.query(query, [vendor_id, link], (err, result) => {
    if (err) {
      console.error("DB Error:", err);
      return res.status(500).json({ message: "Database error" });
    }
    res.json({ message: "Link saved successfully" });
  });
});




function createAdminDownloadRoute(app, db, network) {
  app.get(`/api/admin-download-${network}`, (req, res) => {
    const packageId = format(new Date(), "yyyy-MM-dd HH:mm");

    // Step 1: Update admin_orders with package ID
    const assignAdminQuery = `
      UPDATE admin_orders
      SET package_id = ?, status = 'processing'
      WHERE status = 'pending' AND network = ?
    `;

    // Step 2: Update data_orders with same package ID
    const assignDataQuery = `
      UPDATE data_orders
      SET package_id = ?, status = 'processing'
      WHERE status = 'pending' AND network = ?
    `;

    db.query(assignAdminQuery, [packageId, network], (assignErr) => {
      if (assignErr) {
        console.error("❌ Failed to assign package ID to admin_orders:", assignErr);
        return res.status(500).send("Error assigning package ID to admin_orders");
      }

      db.query(assignDataQuery, [packageId, network], (dataErr) => {
        if (dataErr) {
          console.error("❌ Failed to assign package ID to data_orders:", dataErr);
          return res.status(500).send("Error assigning package ID to data_orders");
        }

        // Step 3: Select updated records for Excel
        const selectQuery = `
          SELECT recipient_number, data_package, amount, status, sent_at AS created_at
          FROM admin_orders
          WHERE package_id = ?
        `;

        db.query(selectQuery, [packageId], async (err, rows) => {
          if (err) {
            console.error("❌ Failed to fetch records:", err);
            return res.status(500).send("Error fetching for export");
          }

          const workbook = new ExcelJS.Workbook();
          const worksheet = workbook.addWorksheet(`${network.toUpperCase()} Orders`);

          worksheet.columns = [
           { header: "Recipient", key: "recipient_number", width: 20 },
            { header: "Package", key: "data_package", width: 15 },
          ];

         // Sort rows from smallest → biggest
rows.sort((a, b) => {
  const numA = parseFloat(a.data_package.replace(/[^\d.]/g, ''));
  const numB = parseFloat(b.data_package.replace(/[^\d.]/g, ''));
  return numA - numB; // ascending
});

// Add sorted rows to excel
// Add sorted rows to excel
rows.forEach(row => {
  const cleanPackage = row.data_package.replace(/[^\d.]/g, '');

  let recipient = String(row.recipient_number || "").replace(/\D/g, "");

  // CASE 1: 233XXXXXXXXX -> drop 233, keep local without leading 0
  // 23354xxxxxxx (12 digits) -> "54xxxxxxx" (9 digits)
  if (recipient.startsWith("233") && recipient.length === 12) {
    recipient = recipient.slice(3); // remove "233"
  }

  // CASE 2: if it comes as 0XXXXXXXXX (10 digits), drop the 0
  if (recipient.startsWith("0") && recipient.length === 10) {
    recipient = recipient.slice(1); // "0543..." -> "543..."
  }

  const numericRecipient = Number(recipient); // true NUMBER

  worksheet.addRow({
    recipient_number: numericRecipient,   // stored as number in Excel
    data_package: cleanPackage
  });
});






          res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          res.setHeader("Content-Disposition", `attachment; filename=admin_${network}_orders.xlsx`);

          await workbook.xlsx.write(res);
          res.end();
        });
      });
    });
  });
}




// Display Orders by Admin (only status = 'available')
app.get("/api/get-admin-orders", (req, res) => {
  const { network } = req.query;

  if (!network) return res.status(400).send("Network is required");

  const sql = `
    SELECT data_package, amount 
    FROM admin_data_packages 
    WHERE network = ? AND status = 'active'
    ORDER BY 
      CAST(REGEXP_SUBSTR(data_package, '^[0-9]+') AS UNSIGNED),
      data_package
  `;

  db.query(sql, [network], (err, results) => {
    if (err) {
      console.error("❌ Error fetching admin orders:", err);
      return res.status(500).send("Error fetching admin orders");
    }
    res.json(results);
  });
});

//Admin package deletion 
app.post("/api/delete-admin-package", (req, res) => {
  const { id } = req.body;

  if (!id) return res.status(400).send("Missing package ID");

  const sql = `DELETE FROM admin_data_packages WHERE id = ?`;

  db.query(sql, [id], (err) => {
    if (err) {
      console.error("❌ Failed to delete package:", err);
      return res.status(500).send("Failed to delete");
    }
    res.send("✅ Package deleted successfully.");
  });
});



// Delete a telephone number
app.post("/api/delete-telephone-number", (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "ID is required",
    });
  }

  const sql = "DELETE FROM telephone_numbers WHERE id = ?";

  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error("❌ Error deleting telephone number:", err);
      return res.status(500).json({
        success: false,
        message: "Database error while deleting number",
      });
    }

    if (result.affectedRows === 0) {
      return res.json({
        success: false,
        message: "Number not found",
      });
    }

    return res.json({ success: true });
  });
});



// ✅ CREATE FOR EACH NETWORK
createAdminDownloadRoute(app, db, "mtn");
createAdminDownloadRoute(app, db, "airteltigo");
createAdminDownloadRoute(app, db, "telecel");

// ✅ FETCH GROUPED ADMIN ORDERS (NO vendor_id filter)
app.post("/api/admin-packages", (req, res) => {
  const { network } = req.body;
  if (!network) return res.status(400).send("Missing network field");

  const sql = `
    SELECT package_id, recipient_number, data_package, amount, status
    FROM admin_orders
    WHERE network = ? AND status IN ('processing', 'delivered')
    ORDER BY package_id DESC
  `;

  db.query(sql, [network], (err, rows) => {
    if (err) {
      console.error("Failed to fetch admin packages:", err);
      return res.status(500).send("Failed to fetch packages.");
    }
    res.json(rows);
  });
});

// ✅ MARK ADMIN PACKAGE AS DELIVERED
app.post("/api/admin-mark-delivered", (req, res) => {
  const { package_id } = req.body;
  if (!package_id) return res.status(400).send("Missing package ID");

  const updateAdmin = `UPDATE admin_orders SET status = 'delivered' WHERE package_id = ?`;
  const updateData = `UPDATE data_orders SET status = 'delivered' WHERE package_id = ?`;

  db.query(updateAdmin, [package_id], (err) => {
    if (err) {
      console.error("Failed to update admin_orders:", err);
      return res.status(500).send("Error updating admin_orders");
    }

    db.query(updateData, [package_id], (err2) => {
      if (err2) {
        console.error("Failed to update data_orders:", err2);
        return res.status(500).send("Error updating data_orders");
      }

      res.send("Package marked as delivered in both tables.");
    });
  });
});

//DASHBOARD COUNTS 
///////////////////////////////////////////////////////////////////////////////////////
// Total users (exclude admins)
app.get("/api/total-users", (req, res) => {
  const sql = `
    SELECT COUNT(*) AS totalUsers
    FROM users
    WHERE LOWER(role) <> 'admin'
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error counting users:", err);
      return res.status(500).json({ error: "Database error" });
    }
    const totalUsers = results[0]?.totalUsers || 0;
    res.json({ totalUsers });
  });
});


// ✅ Total pending orders from admin_orders
app.get("/api/pending-orders", (req, res) => {
  const sql = `
    SELECT COUNT(*) AS pendingOrders
    FROM admin_orders
    WHERE LOWER(status) = 'pending'
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error counting pending orders:", err);
      return res.status(500).json({ error: "Database error" });
    }

    const pendingOrders = results[0]?.pendingOrders || 0;
    res.json({ pendingOrders });
  });
});


// ✅ Revenue today (sum of total_revenue.amount for current date)
app.get("/api/revenue-today", (req, res) => {
  const sql = `
    SELECT COALESCE(SUM(amount), 0) AS revenueToday
    FROM total_revenue
    WHERE DATE(date_received) = CURDATE()
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error getting today's revenue:", err);
      return res.status(500).json({ error: "Database error" });
    }

    const revenueToday = results[0]?.revenueToday || 0;
    res.json({ revenueToday });
  });
});


// ✅ Total lifetime transactions (count all admin_orders)
app.get("/api/total-transactions", (req, res) => {
  const sql = `
    SELECT COUNT(*) AS totalTransactions
    FROM admin_orders
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error counting transactions:", err);
      return res.status(500).json({ error: "Database error" });
    }

    const totalTransactions = results[0]?.totalTransactions || 0;
    res.json({ totalTransactions });
  });
});






app.post("/api/admin/add-package", (req, res) => {
  const { network, data_package, amount } = req.body;

  if (!network || !data_package || !amount) {
    return res.status(400).send("Missing fields");
  }

  const sql = `
    INSERT INTO admin_data_packages (network, data_package, amount)
    VALUES (?, ?, ?)
  `;

  db.query(sql, [network, data_package, amount], (err, result) => {
    if (err) {
      console.error("Insert failed:", err);
      return res.status(500).send("Insert failed");
    }

    // Return the newly inserted item with ID
    res.json({
      id: result.insertId,
      network,
      data_package,
      amount,
      status: 'active'
    });
  });
});

app.post("/api/admin/update-status", (req, res) => {
  const { id, status } = req.body;

  const sql = `
    UPDATE admin_data_packages
    SET status = ?
    WHERE id = ?
  `;

  db.query(sql, [status, id], (err) => {
    if (err) {
      console.error("Status update failed:", err);
      return res.status(500).send("Failed");
    }
    res.send("✅ Status updated");
  });
});

app.get("/api/admin/packages", (req, res) => {
  const { network } = req.query;

  if (!network) return res.status(400).send("Network is required.");

  const sql = `
    SELECT * FROM admin_data_packages 
    WHERE network = ?
    ORDER BY 
      CAST(SUBSTRING_INDEX(data_package, 'G', 1) AS DECIMAL)
  `;

  db.query(sql, [network], (err, results) => {
    if (err) {
      console.error("Fetch error:", err);
      return res.status(500).send("Database error");
    }
    res.json(results);
  });
});


// vendor packages are in data_packages
// base cost price is in admin_data_packages
app.post("/api/get-all-packages", (req, res) => {
  const { vendor_id, network } = req.body;

  const sql = `
    SELECT
      dp.id,
      dp.data_package,
      dp.amount,              -- SELLING PRICE (what you edit)
      dp.status,
      adp.amount AS cost_price -- COST PRICE from admin_data_packages
    FROM data_packages dp
    LEFT JOIN admin_data_packages adp
      ON adp.network = dp.network
     AND adp.data_package = dp.data_package
    WHERE dp.vendor_id = ?
      AND dp.network = ?
    ORDER BY dp.id ASC
  `;

  db.query(sql, [vendor_id, network], (err, rows) => {
    if (err) {
      console.error("get-all-packages error:", err);
      return res.status(500).json({ error: "db error" });
    }
    res.json(rows);
  });
});


app.post("/api/update-package-amount", (req, res) => {
  const { id, amount } = req.body;
  if (!id || amount === undefined) {
    return res.status(400).json({ error: "Missing id or amount" });
  }

  const sql = `UPDATE data_packages SET amount = ? WHERE id = ?`;
  db.query(sql, [amount, id], (err) => {
    if (err) {
      console.error("update-package-amount error:", err);
      return res.status(500).json({ error: "db error" });
    }
    res.json({ success: true });
  });
});

















//DISPLAY FOR BADGES
app.get("/api/get-pending-counts", (req, res) => {
  const sql = `
    SELECT network, COUNT(*) AS count
    FROM admin_orders
    WHERE status = 'pending'
    GROUP BY network
  `;

  db.query(sql, (err, results) => {
    if (err) return res.status(500).send("DB error");

    const counts = { MTN: 0, TELECEL: 0, AT: 0 };
    results.forEach(row => {
      const key = row.network.toUpperCase();
      if (key === "MTN" || key === "TELECEL" || key === "AT") {
        counts[key] = row.count;
      }
    });
    res.json(counts);
  });
});









// GET user by ID
app.get("/api/user/:id", (req, res) => {
  const sql = "SELECT username, fullname, email, phone FROM users WHERE id = ?";
  db.query(sql, [req.params.id], (err, result) => {
    if (err) return res.status(500).send("Database error.");
    if (result.length === 0) return res.status(404).send("User not found.");
    res.json(result[0]);
  });
});

// UPDATE user by ID
app.put("/api/user/:id", (req, res) => {
  const { fullname, email, phone } = req.body;
  const sql = "UPDATE users SET fullname = ?, email = ?, phone = ? WHERE id = ?";
  db.query(sql, [fullname, email, phone, req.params.id], (err, result) => {
    if (err) return res.status(500).send("Failed to update user.");
    res.send("✅ Account updated successfully.");
  });
});




app.post("/api/theteller-withdraw", async (req, res) => {
  const { vendor_id, momo_number, amount, network } = req.body;

  if (!vendor_id || !momo_number || !amount || !network) {
    return res.status(400).send("Missing fields");
  }

  // Format amount
  const formattedAmount = String(Math.round(amount * 100)).padStart(12, "0");
  const transactionId = `WD${Date.now()}`.slice(0, 30);
  const formattedMoMo = momo_number.replace(/^0/, "233");

  function getSwitchCode(net) {
    switch (net.toLowerCase()) {
      case "mtn": return "MTN";
      case "airteltigo": return "ATL";
      case "telecel": return "VDF";
      default: return null;
    }
  }

  const rSwitch = getSwitchCode(network);
  if (!rSwitch) return res.status(400).send("Unsupported network");

 const payload = {
  amount: formattedAmount,
  processing_code: "404000",
  transaction_id: transactionId,
  desc: "Vendor Withdrawal",
  merchant_id: "TTM-00010694",
  subscriber_number: formattedMoMo,
  "r-switch": rSwitch,
  redirect_url: "https://example.com/withdrawal-callback",

  // ✅ Required for 404000
  account_number: formattedMoMo,       // usually same as MoMo number
  account_issuer: rSwitch              // same as r-switch (e.g. MTN, ATL)
};

  const token = Buffer.from("sandipay6821f47c4bfc0:ZjZjMWViZGY0OGVjMDViNjBiMmM1NmMzMmU3MGE1YzQ=").toString("base64");

  try {
    const response = await axios.post(
      "https://prod.theteller.net/v1.1/transaction/process",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${token}`,
          "Cache-Control": "no-cache"
        }
      }
    );

    console.log("✅ TheTeller withdrawal:", response.data);
    const code = response.data.code;
    const status = response.data.status?.toLowerCase();

 if (code === "000" || status === "approved" || status === "successful") {
  // ✅ Deduct from wallet here
  const deductSql = `
    INSERT INTO wallet_loads (vendor_id, momo, amount, date_loaded)
    VALUES (?, ?, ?, NOW())
  `;

  db.query(deductSql, [vendor_id, momo_number, -amount], (deductErr) => {
    if (deductErr) {
      console.error("Failed to deduct:", deductErr);
      return res.status(500).send("Withdrawal processed but deduction failed.");
    }
    res.send("✅ Withdrawal processed and wallet updated.");
  });
} else {
  return res.status(400).send("❌ Withdrawal failed or declined.");
}


  } catch (err) {
    console.error("❌ TheTeller error:", err.response?.data || err.message);
    return res.status(400).send("Withdrawal failed.");
  }
});





//////////////////////////////////////////////////////////////////////////////////////////API
// ✅ Handle Allow / Close Limited and send email notice
app.post("/api/access-mode", async (req, res) => {
  const { mode } = req.body || {};
  const action =
    mode === "all"
      ? "Allow For All (open access)"
      : "Close Limited (restrict access)";

  try {
    await transporter.sendMail({
      from: '"Sandypay Admin Alerts" <Sandipayghana@gmail.com>',
      to: "edutheo33@gmail.com",
      subject: `Sandypay Admin Request: ${action}`,
      text:
        `An admin has triggered the following action from the Allow Menu:\n\n` +
        `Action: ${action}\n` +
        `Time: ${new Date().toLocaleString()}\n\n` +
        `Please log in and apply this change on the backend.`
    });

    // Frontend doesn't really use this, but we return success anyway
    return res.json({ success: true });
  } catch (err) {
    console.error("access-mode email error:", err);
    return res.status(500).json({ success: false, error: "Mail send failed" });
  }
});




















// NUMBER OF PENDING AFA ORDERS BY VENDOR ID
app.get("/api/afa-pending-count", (req, res) => {
  const { vendor_id } = req.query;

  if (!vendor_id) {
    return res.status(400).json({ error: "Vendor ID is required" });
  }

  const sql = `
    SELECT COUNT(*) AS count
    FROM afa_requests
    WHERE status = 'pending' AND vendor_id = ?
  `;

  db.query(sql, [vendor_id], (err, result) => {
    if (err) {
      console.error("❌ AFA count error:", err);
      return res.status(500).send("DB error");
    }
    res.json({ count: result[0].count });
  });
});



//AFA 
app.get('/api/afa-price/admin', (req, res) => {
  db.query("SELECT price FROM afa_prices WHERE status = 'admin' ORDER BY created_at DESC LIMIT 1", (err, result) => {
    if (err) return res.status(500).json({ error: err });
    const price = result.length > 0 ? result[0].price : 0;
    res.json({ adminPrice: price });
  });
});

app.post('/api/afa-price/vendor', (req, res) => {
  const { user_id, price } = req.body;
  if (!user_id || !price) return res.status(400).json({ message: 'Missing fields' });

  db.query("INSERT INTO afa_prices (user_id, status, price) VALUES (?, 'vendor', ?)", [user_id, price], (err) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ message: 'Vendor price set successfully' });
  });
});






//WHATSAPP LINK
app.post("/api/get-whatsapp-link", (req, res) => {
  const { vendor_id } = req.body;
  if (!vendor_id) return res.status(400).json({ error: "Vendor ID required" });

  const sql = `SELECT link FROM whatsapp_community_links WHERE vendor_id = ? ORDER BY updated_at DESC LIMIT 1`;

  db.query(sql, [vendor_id], (err, rows) => {
    if (err) {
      console.error("❌ Failed to fetch WhatsApp link:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (!rows.length || !rows[0].link) {
      return res.json({ link: null });
    }

    res.json({ link: rows[0].link });
  });
});
//VENDOR DELETE PACKAGE
app.post("/api/delete-package", (req, res) => {
  const { id } = req.body;
  db.query("DELETE FROM data_packages WHERE id = ?", [id], (err) => {
    if (err) {
      console.error("❌ Failed to delete package:", err);
      return res.status(500).send("Failed to delete");
    }
    res.send("Deleted successfully");
  });
});





// ADMIN AFA PRICE SETUP - Update for admin ID 25
app.post('/api/afa-price/admin', (req, res) => {
  const { price } = req.body;

  const user_id = 25;
  const status = 'admin';

  if (!price) {
    return res.status(400).json({ message: 'Missing price' });
  }

  const updateQuery = `
    UPDATE afa_prices 
    SET price = ?, created_at = NOW()
    WHERE user_id = ? AND status = ?
  `;

  db.query(updateQuery, [price, user_id, status], (err, result) => {
    if (err) return res.status(500).json({ message: 'Update error', error: err });

    if (result.affectedRows === 0) {
      // No row to update — optionally insert it
      const insertQuery = `
        INSERT INTO afa_prices (user_id, status, price) 
        VALUES (?, ?, ?)
      `;
      db.query(insertQuery, [user_id, status, price], (insertErr) => {
        if (insertErr) return res.status(500).json({ message: 'Insert failed', error: insertErr });
        return res.json({ message: 'AFA price inserted successfully' });
      });
    } else {
      res.json({ message: 'AFA price updated successfully' });
    }
  });
});






app.post("/api/send-afa-orders", (req, res) => {
  const { vendor_id } = req.body;
  if (!vendor_id) return res.status(400).send("Vendor ID required");

  // 1. Get AFA price
  const priceSql = `SELECT price FROM afa_prices WHERE status = 'admin' ORDER BY id DESC LIMIT 1`;

  db.query(priceSql, async (priceErr, priceRows) => {
    if (priceErr || !priceRows.length) {
      console.error("❌ Failed to fetch AFA price:", priceErr);
      return res.status(500).send("Failed to get AFA price.");
    }

    const afaPrice = parseFloat(priceRows[0].price);

    // 2. Get pending orders
    const fetchSql = `
      SELECT * FROM afa_requests 
      WHERE vendor_id = ? AND status = 'pending'
    `;

    db.query(fetchSql, [vendor_id], (err, rows) => {
      if (err) {
        console.error("❌ AFA Fetch Error:", err);
        return res.status(500).send("Failed to fetch pending orders");
      }

      if (!rows.length) return res.status(404).send("No pending orders found");

      const totalAmount = afaPrice * rows.length;

      // 3. Check available wallet balance
      const walletSql = `
        SELECT SUM(amount) AS total FROM wallet_loads WHERE vendor_id = ?
      `;

      db.query(walletSql, [vendor_id], (walletErr, walletRows) => {
        if (walletErr) {
          console.error("❌ Wallet check failed:", walletErr);
          return res.status(500).send("Could not verify wallet balance");
        }

        const walletBalance = parseFloat(walletRows[0].total || 0);
        if (walletBalance < totalAmount) {
          return res.status(400).send(`❌ Insufficient wallet balance. Required: GHS ${totalAmount}`);
        }

        // 4. Deduct from wallet
        const deductSql = `
          INSERT INTO wallet_loads (vendor_id, momo, amount, date_loaded)
          VALUES (?, '', ?, NOW())
        `;

        db.query(deductSql, [vendor_id, -totalAmount], (deductErr) => {
          if (deductErr) {
            console.error("❌ Failed to deduct from wallet:", deductErr);
            return res.status(500).send("Wallet deduction failed");
          }

          // 5. Insert into afareceive with updated fields
          const packageId = new Date().toISOString().slice(0, 16).replace("T", " ");
          const now = new Date();

          const insertValues = rows.map(r => [
            vendor_id,
            r.fullname,
            r.id_number,
            r.dob,
            r.phone_number,
            r.location,
            r.region,
            r.occupation,
            r.submitted_at || now,
            'pending'
           
          ]);

          const insertSql = `
            INSERT INTO afareceive (
              vendor_id, fullname, id_number, dob, phone_number,
              location, region, occupation, submitted_at,
              status
            ) VALUES ?
          `;

          db.query(insertSql, [insertValues], (insertErr) => {
            if (insertErr) {
              console.error("❌ Insert into afareceive failed:", insertErr);
              return res.status(500).send("Failed to send orders to admin");
            }

            // 6. Update original afa_requests status
            const updateSql = `
              UPDATE afa_requests
              SET status = 'processing', package_id = ?
              WHERE vendor_id = ? AND status = 'pending'
            `;

            db.query(updateSql, [packageId, vendor_id], () => {
              res.send("✅ AFA orders sent to admin and wallet updated");
            });
          });
        });
      });
    });
  });
});




//adming afa download 
app.get("/api/admin-export-afa-orders", async (req, res) => {
  const sql = `
    SELECT * FROM afareceive WHERE status = 'pending'
  `;

  db.query(sql, async (err, rows) => {
    if (err) {
      console.error("❌ Failed to export:", err);
      return res.status(500).send("Export failed");
    }

    // Update status to processing
    const packageId = new Date().toISOString().slice(0, 16).replace("T", " ");
    db.query(`UPDATE afareceive SET status = 'processing', package_id = ? WHERE status = 'pending'`, [packageId]);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("AFA Admin Orders");

    sheet.columns = [
      { header: "Full Name", key: "fullname" },
      { header: "ID Number", key: "id_number" },
      { header: "DOB", key: "dob" },
      { header: "Phone", key: "phone_number" },
      { header: "Location", key: "location" },
      { header: "Region", key: "region" },
      { header: "Occupation", key: "occupation" },
      { header: "Status", key: "status" },
      { header: "Created At", key: "created_at" },
    ];

    rows.forEach(row => sheet.addRow(row));

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=afa_admin_orders.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  });
});

app.post("/api/afa-mark-delivered", (req, res) => {
  const { package_id } = req.body;
  if (!package_id) return res.status(400).send("Missing package_id");

  const sql = `UPDATE afareceive SET status = 'delivered' WHERE package_id = ?`;

  db.query(sql, [package_id], (err) => {
    if (err) {
      console.error("❌ Failed to update status:", err);
      return res.status(500).send("Failed to update status");
    }

    res.send("✅ All orders marked as delivered");
  });
});



app.post("/api/afa-admin-processing", (req, res) => {
  const sql = `
    SELECT * FROM afareceive
    WHERE status IN ('processing', 'delivered')
    ORDER BY package_id DESC, created_at DESC
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error("❌ Failed to fetch AFA processing packages:", err);
      return res.status(500).send("Failed to fetch processing orders");
    }

    res.json(rows);
  });
});



//badges
app.get("/api/afa-admin-pending-count", (req, res) => {
  const sql = `
    SELECT COUNT(*) AS count FROM afareceive WHERE status = 'pending'
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error("❌ Failed to count pending:", err);
      return res.status(500).send("Error counting pending orders");
    }

    res.json({ count: rows[0].count });
  });
});



app.post("/api/vendor-transactions", (req, res) => {
  const { vendor_id } = req.body;
  if (!vendor_id) return res.status(400).send("Vendor ID required");

  const results = {};

  const queries = {
    data_orders: `SELECT * FROM data_orders WHERE vendor_id = ? ORDER BY created_at DESC`,
    afa_requests: `SELECT * FROM afa_requests WHERE vendor_id = ? ORDER BY created_at DESC`,
    wallet_loads: `SELECT * FROM wallet_loads WHERE vendor_id = ? ORDER BY date_loaded DESC`,
    withdrawals: `SELECT * FROM withdrawals WHERE vendor_id = ? ORDER BY requested_at DESC` // ✅ fixed field name
  };

  const runQuery = (key, sql, next) => {
    db.query(sql, [vendor_id], (err, rows) => {
      if (err) return res.status(500).send(`Error loading ${key}`);
      results[key] = rows;
      next();
    });
  };

  runQuery("data_orders", queries.data_orders, () => {
    runQuery("afa_requests", queries.afa_requests, () => {
      runQuery("wallet_loads", queries.wallet_loads, () => {
        runQuery("withdrawals", queries.withdrawals, () => {
          res.json(results);
        });
      });
    });
  });
});



//USSD FETCH
app.post("/api/get-ussd-code", (req, res) => {
  const { vendor_id } = req.body;
  if (!vendor_id) return res.status(400).send("Vendor ID required");

  const sql = "SELECT ussd_code FROM users WHERE id = ?";
  db.query(sql, [vendor_id], (err, rows) => {
    if (err) {
      console.error("❌ Failed to fetch USSD code:", err);
      return res.status(500).send("Failed to fetch USSD code");
    }

    if (!rows.length) return res.status(404).send("USSD code not found");

    res.json({ ussd_code: rows[0].ussd_code });
  });
});





//NAME FETCH
app.post("/api/fetch-vendor-name", (req, res) => {
  const { vendor_id } = req.body;
  if (!vendor_id) return res.status(400).json({ error: "Vendor ID is required" });

  const sql = "SELECT username AS name FROM users WHERE id = ?";
  db.query(sql, [vendor_id], (err, result) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (result.length === 0) return res.status(404).json({ error: "Vendor not found" });

    res.json({ name: result[0].name });
  });
});


//LINK DOMAIN 
app.post("/api/update-public-link-by-username", (req, res) => {
  const { username, publicLink } = req.body;
  if (!username || !publicLink) return res.status(400).json({ success: false, message: "Missing fields" });

  const sql = "UPDATE users SET public_link = ? WHERE username = ?";
  db.query(sql, [publicLink, username], (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Database error" });
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, message: "✅ Domain linked successfully!" });
  });
});


//REMOVE DOMAIN
app.post("/api/reset-public-link", (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ success: false, message: "Missing username" });

  const sql = "UPDATE users SET public_link = NULL WHERE username = ?";
  db.query(sql, [username], (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Database error" });
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, message: "✅ Domain removed" });
  });
});


//GET ALL USERS
app.get("/api/get-users-domains", (req, res) => {
  const sql = "SELECT id, username, role, status, public_link FROM users ORDER BY id DESC";
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json([]);
    res.json(results);
  });
});


//GERERATE CODE AND SEND TO DATABASE FOR MTN
app.post('/api/insert-mtn-code', (req, res) => {
  const { vendor_id, code } = req.body;

  if (!vendor_id || !code) {
    return res.status(400).json({ status: 'error', message: 'Missing vendor_id or code' });
  }

  const sql = "UPDATE data_orders SET code = ? WHERE vendor_id = ? AND status = 'pending'";
  db.query(sql, [code, vendor_id], (err, result) => {
    if (err) {
      console.error("Error updating code:", err);
      return res.status(500).json({ status: 'error', message: 'Database update failed' });
    }
    return res.json({ status: 'success', message: 'Code inserted successfully' });
  });
});


//GERERATE CODE AND SEND TO DATABASE FOR TELECEL
app.post('/api/insert-telecel-code', (req, res) => {
  const { vendor_id, code } = req.body;

  if (!vendor_id || !code) {
    return res.status(400).json({ status: 'error', message: 'Missing vendor_id or code' });
  }

  const sql = "UPDATE data_orders SET code = ? WHERE vendor_id = ? AND network = 'telecel' AND status = 'pending'";
  db.query(sql, [code, vendor_id], (err, result) => {
    if (err) {
      console.error("Error inserting Telecel code:", err);
      return res.status(500).json({ status: 'error', message: 'Database error' });
    }

    return res.json({ status: 'success', message: 'Telecel code inserted successfully' });
  });
});



//GERERATE CODE AND SEND TO DATABASE FOR AIRTELTIGO
app.post('/api/insert-airteltigo-code', (req, res) => {
  const { vendor_id, code } = req.body;

  if (!vendor_id || !code) {
    return res.status(400).json({ status: 'error', message: 'Missing vendor_id or code' });
  }

  const sql = "UPDATE data_orders SET code = ? WHERE vendor_id = ? AND network = 'airteltigo' AND status = 'pending'";
  db.query(sql, [code, vendor_id], (err, result) => {
    if (err) {
      console.error("Error inserting AirtelTigo code:", err);
      return res.status(500).json({ status: 'error', message: 'Database error' });
    }

    return res.json({ status: 'success', message: 'AirtelTigo code inserted successfully' });
  });
});






app.get('/api/download-by-code', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("Missing code");

  try {
    const [orders] = await db.promise().query(
      "SELECT * FROM data_orders WHERE code = ? AND status = 'pending'",
      [code]
    );

    if (!orders.length) return res.status(404).send("No pending orders found for this code");

    const vendorId = orders[0].vendor_id;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Orders");

    sheet.columns = [
      { header: "Recipient", key: "recipient_number" },
      { header: "Package", key: "data_package" }
    ];

    let totalAmount = 0;
    const matchingOrderIds = [];

    for (const order of orders) {
      const cleanPkg = order.data_package.replace(/\s/g, ''); // e.g., "1 GB" -> "1GB"
      const network = order.network;

      const [adminMatch] = await db.promise().query(
        "SELECT amount FROM admin_data_packages WHERE network = ? AND REPLACE(data_package, ' ', '') = ? LIMIT 1",
        [network, cleanPkg]
      );

      if (adminMatch.length) {
        const adminAmount = parseFloat(adminMatch[0].amount);
        totalAmount += adminAmount;
        matchingOrderIds.push(order.id);

        // ➕ Extract only numeric part from package (e.g., "1GB" -> "1")
        const numericOnly = cleanPkg.replace(/[^\d.]/g, '');

        sheet.addRow({
          recipient_number: order.recipient_number,
          data_package: numericOnly
        });
      }
    }

    if (matchingOrderIds.length === 0) {
      return res.status(400).send("❌ No matching packages found. Nothing was processed.");
    }

    // Get wallet balance
    const [wallet] = await db.promise().query(
      "SELECT SUM(amount) as balance FROM wallet_loads WHERE vendor_id = ?",
      [vendorId]
    );

    const balance = parseFloat(wallet[0].balance || 0);
    if (balance < totalAmount) {
      return res.status(400).send("❌ Insufficient wallet balance.");
    }

    // Deduct from wallet
    await db.promise().query(
      "INSERT INTO wallet_loads (vendor_id, momo, amount, date_loaded) VALUES (?, '', ?, NOW())",
      [vendorId, -totalAmount]
    );

    // Add to total revenue
    await db.promise().query(
      "INSERT INTO total_revenue (vendor_id, source, amount, date_received) VALUES (?, ?, ?, NOW())",
      [vendorId, `Code ${code} order`, totalAmount]
    );

    // Generate package ID using timestamp
    const packageId = new Date().toISOString().slice(0, 16).replace("T", " ");

    // Update only matched orders
    await db.promise().query(
      `UPDATE data_orders 
       SET status = 'processing', package_id = ?
       WHERE id IN (${matchingOrderIds.map(() => '?').join(',')})`,
      [packageId, ...matchingOrderIds]
    );

    // Return Excel
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=Orders_${code}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error("❌ Download by code failed:", err);
    res.status(500).send("Server error");
  }
});










//PENDING TO STATUS
app.post('/api/set-processing-by-code', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).send("Missing code");

  // Generate new package ID using current timestamp
  const packageId = new Date().toISOString().slice(0, 16).replace("T", " "); // e.g. 2025-07-03 19:46

  const sql = `
    UPDATE data_orders
    SET status = 'processing', package_id = ?
    WHERE code = ?
  `;

  db.query(sql, [packageId, code], (err, result) => {
    if (err) {
      console.error("❌ Failed to update rows:", err);
      return res.status(500).send("Failed to update package info");
    }

    res.send(`✅ ${result.affectedRows} orders grouped as package: ${packageId}`);
  });
});


//PACK
// /api/admin-packages
app.post('/api/admin-packages-by-network', (req, res) => {
  const { vendor_id, network } = req.body;

const sql = `
  SELECT * FROM data_orders
  WHERE package_id IS NOT NULL
    AND status IN ('processing', 'delivered')
  ORDER BY package_id DESC
`;

  db.query(sql, [vendor_id, network], (err, result) => {
    if (err) {
      console.error("❌ Error fetching packages:", err);
      return res.status(500).send("Error fetching package data");
    }

    res.json(result);
  });
});





app.post('/api/admin-packages-by-code', (req, res) => {
  const { code } = req.body;

  if (!code) return res.status(400).send("Missing code");

  const sql = `
    SELECT * FROM data_orders
    WHERE code = ?
      AND package_id IS NOT NULL
      AND status IN ('processing', 'delivered')
    ORDER BY package_id DESC
  `;

  db.query(sql, [code], (err, results) => {
    if (err) {
      console.error("❌ Fetch by code failed:", err);
      return res.status(500).send("Server error fetching orders by code");
    }

    res.json(results);
  });
});









// ✅ BASIC HEALTH ENDPOINTS FOR DEPLOYMENT
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

// ✅ ENABLE CORS FOR FRONTEND REQUESTS

app.use(cors({ origin: "*" }));

// ✅ FALLBACK (MUST STAY LAST)
app.use((req, res) => {
  res.status(404).send("Endpoint not found");
});

// ✅ START SERVER (DigitalOcean Compatible)
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});



