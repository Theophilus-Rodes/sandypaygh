// shortcode/ussd.js  (ROUTER VERSION)
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");

const router = express.Router();
///////////////////////////////////////////////////////////////////////////
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
//////////////////////////////////////////////////////////////
// Your short code extension (from Moolre)
const EXTENSION_EXPECTED = "717";

// (If you want env vars later, you can swap this out)
const THETELLER = {
  url: "https://prod.theteller.net/v1.1/transaction/process",
  merchant_id: "TTM-00010694",
  // Build Basic token exactly the way you showed (username:password) then Base64 the whole string
  tokenBase64: Buffer
    .from("sandipay6821f47c4bfc0:ZjZjMWViZGY0OGVjMDViNjBiMmM1NmMzMmU3MGE1YzQ=")
    .toString("base64"),
};

// ====== MIDDLEWARE (scoped to this router) ======
router.use(express.json({ type: "application/json" }));  // for JSON
router.use(bodyParser.text({ type: "*/*" }));            // Moolre sometimes sends text/plain
router.use(cors());

// ====== DATABASE ======
/////////////////////////////////////////////////////////
// ====== DATABASE (POOL) ======
const db = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Promise helper (works with pool)
const dbp = db.promise();

console.log("✅ USSD pool created (MySQL).");

////////////////////////////////////////////////////////////
// ====== SESSION STATE ======
const sessions = {};


// ====== HELPERS ======
function getSwitchCode(network) {
  switch ((network || "").toLowerCase()) {
    case "mtn": return "MTN";
    case "vodafone":
    case "telecel": return "VDF";
    case "airteltigo":
    case "airtel": return "ATL";
    case "tigo": return "TGO";
    default: return null;
  }
}

function renderPackages(state) {
  const start = state.packagePage * 5;
  const end = start + 5;
  const sliced = state.packageList.slice(start, end);
  const pkgList = sliced.map((p, i) => `${i + 1}) ${p}`).join("\n");
  const moreOption = end < state.packageList.length ? "\n#. More" : "";
  return `Packages (${state.network})\n${pkgList}${moreOption}\n0) Back`;
}

function confirmMessage(state) {
  const [packageName, price] = state.selectedPkg.split(" @ ");
  return `Confirm Purchase\nRecipient: ${state.recipient}\nNetwork: ${state.network}\nPackage: ${packageName}\nPrice: ${price}\n\n1) Confirm\n2) Cancel`;
}

function normalizeMsisdn(msisdn) {
  const digits = String(msisdn || "").replace(/[^\d]/g, "");
  if (digits.startsWith("233")) return digits;      // 233XXXXXXXXX
  if (digits.startsWith("0")) return "233" + digits.slice(1); // 0XXXXXXXXX -> 233XXXXXXXXX
  return digits;
}
function msisdnVariants(msisdn) {
  const intl = normalizeMsisdn(msisdn);       // 233XXXXXXXXX
  const local = "0" + intl.slice(3);          // 0XXXXXXXXX
  const plusIntl = "+" + intl;                // +233XXXXXXXXX
  return [intl, local, plusIntl];
}

function checkAccess(msisdn, cb) {
  // Read current mode
  db.query(
    "SELECT `value` AS v FROM app_settings WHERE setting='access_mode' LIMIT 1",
    (e, rows) => {
      if (e && e.errno === 1054) {
        // legacy single-column schema
        return db.query("SELECT access_mode AS v FROM app_settings LIMIT 1", (e2, r2) => {
          if (e2) { console.error("app_settings legacy query:", e2); return cb(true); }
          proceed(r2?.[0]?.v);
        });
      }
      if (e) { console.error("app_settings query:", e); return cb(true); }
      proceed(rows?.[0]?.v);
    }
  );

  function proceed(modeRaw) {
    const mode = String(modeRaw || "all").toLowerCase();
    if (mode !== "limited") return cb(true);

    const [intl, local, plusIntl] = msisdnVariants(msisdn);

    // NOTE: use the correct column name: phone_number (not phone)
    db.query(
      "SELECT 1 FROM telephone_numbers WHERE phone_number IN (?, ?, ?) AND (status IS NULL OR status='allowed') LIMIT 1",
      [intl, local, plusIntl],
      (err, r) => {
        if (err) { console.error("telephone_numbers query:", err); return cb(false); }
        cb(!!(r && r.length));
      }
    );
  }
}

// ====== CORE SESSION HANDLER ======
function handleSession(sessionId, input, msisdn, res) {
  const state = sessions[sessionId];
  const reply = (msg) => res.json({ message: msg, reply: true });
  const end = (msg) => res.json({ message: msg, reply: false });

 switch (state.step) {
    case "start": 
      state.step = "menu";
      const brand = state.brandName || "SandyPay";
      return reply
        `${brand}.\nNB: The Data Is NOT INSTANT.\n0. Cancel\n\n1. Buy Data\n2. Contact Us`
      

    case "menu":
      if (input === "1") {
        state.step = "network";
        return reply("Network\n1) MTN\n2) AirtelTigo\n3) Telecel\n0) Back");
      }
      if (input === "2") return end("Contact us:\n0559126985\nsupport@sandypaygh.com");
      if (input === "0") {
        state.step = "start";
        return reply("Cancelled.\n1. Buy Data\n2. Contact Us");
      }
      return reply("Invalid option. Choose:\n1) Buy Data\n2) Contact Us");

    case "network":
      if (input === "1") state.network = "MTN";
      else if (input === "2") state.network = "AirtelTigo";
      else if (input === "3") state.network = "Telecel";
      else if (input === "0") { state.step = "menu"; return reply("Back to menu:\n1. Buy Data\n2. Contact Us"); }
      else return reply("Invalid network. Choose:\n1) MTN\n2) AirtelTigo\n3) Telecel");

      db.query(
        `SELECT data_package, amount
           FROM data_packages
          WHERE vendor_id = ? AND network = ? AND status = 'available'`,
        [state.vendorId, state.network],
        (err, rows) => {
          if (err) { console.error("❌ MySQL error:", err); return ("Service temporarily unavailable. Try again later."); }
          if (!rows || !rows.length) return end("No data packages available.");

          state.packageList = rows.map((r) => `${r.data_package} @ GHS${r.amount}`);
          state.packagePage = 0;
          state.step = "package";
          return reply(renderPackages(state));
        }
      );
      return;

    case "package":
      if (input === "0") { state.step = "network"; return reply("Choose network:\n1) MTN\n2) AirtelTigo\n3) Telecel"); }
      if (input === "#") {
        const totalPages = Math.ceil(state.packageList.length / 5);
        state.packagePage = (state.packagePage + 1) % Math.max(totalPages, 1);
        return reply(renderPackages(state));
      }
      {
        const index = (parseInt(input, 10) - 1) + state.packagePage * 5;
        if (state.packageList[index]) {
          state.selectedPkg = state.packageList[index];
          state.step = "recipient";
          return reply("Recipient\n1) Buy for self\n2) Buy for others\n0) Back");
        }
        return reply("Invalid selection. Choose a valid number or type # for more.");
      }

    case "recipient":
      if (input === "1") { state.recipient = msisdn; state.step = "confirm"; return reply(confirmMessage(state)); }
      if (input === "2") { state.step = "other_number"; return reply("Enter recipient number:"); }
      if (input === "0") { state.step = "package"; return reply(renderPackages(state)); }
      return reply("Invalid option. Choose:\n1) Buy for self\n2) Buy for others\n0) Back");

    case "other_number":
      state.recipient = input;
      state.step = "confirm";
      return reply(confirmMessage(state));

    case "confirm":
      if (input === "1") {
        const m = state.selectedPkg.match(/@ GHS\s*(\d+(\.\d+)?)/);
        const amount = m ? parseFloat(m[1]) : 0;
        if (!amount) return end("Invalid amount in package.");

        const network = state.network.toLowerCase();
        const recipient_number = state.recipient;
        const momo_number = msisdn;
        const vendor_id = state.vendorId;
        const data_package = state.selectedPkg.split(" @")[0];
        const package_id = new Date().toISOString().slice(0, 16).replace("T", " ");

        // Close USSD immediately, then fire payment + DB in background
        end("✅ Please wait while the prompt loads...\nEnter your MoMo PIN to approve.");

        // ===== TheTeller request =====
        const rSwitch = getSwitchCode(network);
        if (!rSwitch) { console.error("❌ Unsupported network:", network); return; }

        const transactionId = `TRX${Date.now()}`.slice(0, 30); // max 30 chars
        const amountFormatted = String(Math.round(amount * 100)).padStart(12, "0"); // pesewas padded
        const formattedMoMo = momo_number.startsWith("233")
          ? momo_number
          : momo_number.replace(/^0/, "233");

        const payload = {
          amount: amountFormatted,
          processing_code: "000200",
          transaction_id: transactionId,
          desc: `Purchase of ${data_package}`,
          merchant_id: THETELLER.merchant_id,
          subscriber_number: formattedMoMo,
          "r-switch": rSwitch,
          redirect_url: "https://example.com/callback"
        };

        console.log("📤 Sending to TheTeller:", payload);

        axios.post(
          THETELLER.url,
          payload,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Basic ${THETELLER.tokenBase64}`,
              "Cache-Control": "no-cache"
            }
          }
        )
        .then((response) => {
          console.log("✅ TheTeller response:", response.data);

          // After payment request fires, log to DB (pending)
         // After payment request fires, log to DB (pending)
const vendorAmount = parseFloat((amount * 0.98).toFixed(2));
const revenueAmount = parseFloat((amount * 0.02).toFixed(2));

const ins = `
  INSERT INTO admin_orders
    (vendor_id, recipient_number, data_package, amount, network, status, sent_at, package_id)
  VALUES (?, ?, ?, ?, ?, 'pending', NOW(), ?)
`;
db.query(
  ins,
  [vendor_id, recipient_number, data_package, amount, network, package_id],
  (err) => {
    if (err) return console.error("❌ Failed to log admin order:", err);
    console.log("✅ Admin order logged.");

    db.query(
      `INSERT INTO wallet_loads (vendor_id, momo, amount, date_loaded)
       VALUES (?, ?, ?, NOW())`,
      [vendor_id, momo_number, vendorAmount],
      (e) => e ? console.error("❌ Wallet load insert:", e) : console.log("✅ Wallet 98% logged.")
    );

    db.query(
      `INSERT INTO total_revenue (vendor_id, source, amount, date_received)
       VALUES (?, ?, ?, NOW())`,
      [vendor_id, `2% from ${network} payment`, revenueAmount],
      (e) => e ? console.error("❌ Revenue insert:", e) : console.log("✅ 2% revenue logged.")
    );
  }
);

        })
        .catch((err) => {
          console.error("❌ TheTeller error:", err.response?.data || err.message);
        });

        return;
      }

      if (input === "2") return end("Transaction cancelled.");
      return reply("Invalid input.\n1) Confirm\n2) Cancel");

    default:
      state.step = "start";
      return reply("Restarting...\n1. Buy Data\n2. Contact Us");
  }
}

// ====== USSD ROUTE (Moolre) ======
// Parent app will mount this router at /api/moolre, so our path here is "/"
// ====== USSD ROUTE (Moolre) ======
// Parent app will mount this router at /api/moolre, so our path here is "/"
// ====== USSD ROUTE (Moolre) ======
// Parent app will mount this router at /api/moolre, so our path here is "/"
router.post("/", async (req, res) => {
  let payload = {};
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.json({ message: "END Invalid JSON format", reply: false });
  }

  const { sessionId, msisdn, data, message, extension, new: isNew } = payload;

  // Must be our 717 extension
  if (String(extension || "") !== EXTENSION_EXPECTED) {
    return res.json({ message: "END Invalid USSD entry point", reply: false });
  }

  const input = (data || message || "").trim();
  const isNewSession = isNew === true || !sessions[sessionId];

  try {
    // 🔹 CASE 1: New session with NO ID → *203*717#
    // Free to use (no hits check) BUT must be in telephone_numbers
    if (isNewSession && !input) {
      const [intl, local, plusIntl] = msisdnVariants(msisdn);

      // Check whitelist table first
      const [rowsTel] = await dbp.query(
        `SELECT 1
           FROM telephone_numbers
          WHERE phone_number IN (?, ?, ?)
            AND (status IS NULL OR status = 'allowed')
          LIMIT 1`,
        [intl, local, plusIntl]
      );

      // Not in whitelist → behave like unknown application
      if (!rowsTel || !rowsTel.length) {
        return res.json({ message: "APPLICATION UNKNOWN", reply: false });
      }

      // Allowed: no hits check, just open a "free" session
      const vendorId = 1; // default/general vendor for plain *203*717#

      sessions[sessionId] = {
        step: "start",
        vendorId,
        brandName: "SandyPay", // base code always shows SandyPay
        network: "",
        selectedPkg: "",
        recipient: "",
        packageList: [],
        packagePage: 0,
      };

      // input is empty here; handleSession will show the first menu
      handleSession(sessionId, input, String(msisdn || ""), res);
      return;
    }

    // 🔹 CASE 2: New session WITH ID → *203*717*ID#
    // Here we ALLOW every number, but we CHECK SESSIONS/HITS
    if (isNewSession) {
      const raw = input; // contains the ID part from Moolre on first request
      const vendorIdFromDial = parseInt(raw.replace(/\D/g, ""), 10);
      const vendorId =
        Number.isInteger(vendorIdFromDial) && vendorIdFromDial > 0
          ? vendorIdFromDial
          : 1;

      // Check remaining hits for this vendor
      const remaining = await getRemainingHits(vendorId);
      if (remaining <= 0) {
        return res.json({
          message: "Sorry, your session has finished.",
          reply: false,
        });
      }

      // Deduct exactly 1 hit
      const ok = await consumeOneHit(vendorId);
      if (!ok) {
        return res.json({
          message: "END Sorry, your session has finished.",
          reply: false,
        });
      }

      // Increment counter for dashboard
      await incrementUssdCounter(vendorId);

      // 🔹 Fetch vendor display name from users.username
      let brandName = "SandyPay";
      try {
        const [userRows] = await dbp.query(
          "SELECT username FROM users WHERE id = ? LIMIT 1",
          [vendorId]
        );
        if (userRows && userRows.length && userRows[0].username) {
          brandName = userRows[0].username;
        }
      } catch (e) {
        console.error("Error fetching vendor username:", e.message);
      }

      // Create session state
      sessions[sessionId] = {
        step: "start",
        vendorId,
        brandName, // 👈 used in handleSession 'start'
        network: "",
        selectedPkg: "",
        recipient: "",
        packageList: [],
        packagePage: 0,
      };

      // First menu (welcome will show vendor brand name)
      handleSession(sessionId, input, String(msisdn || ""), res);
      return;
    }

    // 🔹 CASE 3: Existing session → continue normally
    handleSession(sessionId, input, String(msisdn || ""), res);
  } catch (e) {
    console.error("USSD route error:", e.message);
    return res.json({
      message: "END Service temporarily unavailable. Try again later.",
      reply: false,
    });
  }
});



module.exports = router;

// --- HIT helpers ---

// Returns total remaining hits for a vendor (only 'completed' rows count)
async function getRemainingHits(vendorId) {
  const [rows] = await dbp.query(
    `SELECT COALESCE(SUM(CASE WHEN status='completed' THEN hits ELSE 0 END), 0) AS total_hits
     FROM session_purchases
     WHERE vendor_id = ?`,
    [vendorId]
  );
  return Number(rows?.[0]?.total_hits || 0);
}

// Atomically deduct 1 hit from the most recent row that still has hits > 0.
// Returns true if 1 hit was deducted, false if none available.
async function consumeOneHit(vendorId) {
  // Use a transaction + FOR UPDATE to avoid race conditions
  const conn = await dbp.getConnection();
  try {
    await conn.beginTransaction();

    const [pick] = await conn.query(
      `SELECT id, hits
         FROM session_purchases
        WHERE vendor_id = ? AND status='completed' AND hits > 0
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        FOR UPDATE`,
      [vendorId]
    );

    if (!pick || !pick.length) {
      await conn.rollback();
      conn.release();
      return false;
    }

    const row = pick[0];
    const newHits = Number(row.hits) - 1;

    await conn.query(
      `UPDATE session_purchases
          SET hits = ?
        WHERE id = ?`,
      [newHits, row.id]
    );

    await conn.commit();
    conn.release();
    return true;
  } catch (e) {
    try { await conn.rollback(); } catch {}
    conn.release();
    console.error("consumeOneHit() error:", e.message);
    return false;
  }
}

// Bump the visible USSD session counter for the vendor (for dashboard display)
async function incrementUssdCounter(vendorId) {
  await dbp.query(
    `INSERT INTO ussd_session_counters (vendor_id, hits_used)
     VALUES (?, 1)
     ON DUPLICATE KEY UPDATE hits_used = hits_used + 1`,
    [vendorId]
  );
}

