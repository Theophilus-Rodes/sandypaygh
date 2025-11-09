// ussd.js
// -----------------------
// SandyPay USSD (Moolre) with TheTeller payment + ACCESS CONTROL
// - Blocks base *203*717# -> "END APPLICATION UNKNOWN"
// - Extracts vendor_id from *203*717*<id>#
// - Sends TheTeller request with your formatting + token build
// - NEW: If access_mode='limited' only MSISDNs found in telephone_numbers can use the USSD
// -----------------------

const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");

// ====== CONFIG ======
const PORT = 5050;
const DB_CONFIG = {
  host: "localhost",
  user: "root",
  password: "",
  database: "vendor_portal",
};

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
// ==================================

const app = express();
app.use(express.json({ type: "application/json" }));
app.use(bodyParser.text({ type: "*/*" }));
app.use(cors());

// ====== DATABASE ======
const db = mysql.createConnection(DB_CONFIG);
db.connect((err) => {
  if (err) console.error("❌ Database connection failed:", err);
  else console.log("✅ Connected to MySQL database.");
});

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
      return reply("SandyPay.\nNB: The Data Is NOT INSTANT.\n0. Cancel\n\n1. Buy Data\n2. Contact Us");

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
          if (err) { console.error("❌ MySQL error:", err); return end("Service temporarily unavailable. Try again later."); }
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
          const vendorAmount = parseFloat((amount * 0.98).toFixed(2));
          const revenueAmount = parseFloat((amount * 0.02).toFixed(2));

          const ins = `
            INSERT INTO data_orders
              (vendor_id, data_package, amount, recipient_number, momo_number, status, created_at, network, package_id)
            VALUES (?, ?, ?, ?, ?, 'pending', NOW(), ?, ?)
          `;
          db.query(ins, [vendor_id, data_package, amount, recipient_number, momo_number, network, package_id], (err) => {
            if (err) return console.error("❌ Failed to log order:", err);
            console.log("✅ Order logged.");

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
          });
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
app.post("/ussd/moolre", (req, res) => {
  let payload = {};
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.json({ message: "END Invalid JSON format", reply: false });
  }

  const { sessionId, msisdn, data, message, extension, new: isNew } = payload;

  // Wrong extension
  if (String(extension) !== EXTENSION_EXPECTED) {
    return res.json({ message: "END Invalid USSD entry point", reply: false });
  }

  // ===== ACCESS CHECK FIRST =====
  checkAccess(msisdn, (allowed) => {
    if (!allowed) {
      return res.json({ message: "END Sorry, you don't have access.", reply: false });
    }

    // BLOCK base *203*717# (no vendor id after the code)
    if ((isNew === true || !sessions[sessionId]) && (!data || !String(data).trim())) {
      return res.json({ message: "END APPLICATION UNKNOWN", reply: false });
    }

    // New session: extract vendor_id from the first `data` (digits only)
    if (isNew === true || !sessions[sessionId]) {
      const raw = String(data || "").trim();
      const vendorIdFromDial = parseInt(raw.replace(/\D/g, ""), 10);
      const vendorId = Number.isInteger(vendorIdFromDial) && vendorIdFromDial > 0 ? vendorIdFromDial : 1;

      sessions[sessionId] = {
        step: "start",
        vendorId,
        network: "",
        selectedPkg: "",
        recipient: "",
        packageList: [],
        packagePage: 0,
      };
    }

    const input = (data || message || "").trim();
    handleSession(sessionId, input, String(msisdn || ""), res);
  });
});

// ===== Admin: toggle access mode =====
// GET /api/set-access/:mode   -> mode = "all" | "limited"
// GET /api/get-access         -> returns {mode: "all"|"limited"}

app.get("/api/set-access/:mode", (req, res) => {
  const mode = req.params.mode === "limited" ? "limited" : "all";

  // Try new schema (setting/value) first
  db.query(
    "UPDATE app_settings SET `value`=? WHERE setting='access_mode'",
    [mode],
    (e) => {
      if (e && e.errno === 1054) {
        // Fallback to legacy single-column schema (access_mode)
        return db.query(
          "UPDATE app_settings SET access_mode=?",
          [mode],
          (e2) => {
            if (e2) return res.status(500).send("DB error: " + e2.message);
            res.send(`Access mode updated to ${mode.toUpperCase()}`);
          }
        );
      }
      if (e) return res.status(500).send("DB error: " + e.message);
      res.send(`Access mode updated to ${mode.toUpperCase()}`);
    }
  );
});

app.get("/api/get-access", (req, res) => {
  // New schema first
  db.query(
    "SELECT `value` AS v FROM app_settings WHERE setting='access_mode' LIMIT 1",
    (e, rows) => {
      if (e && e.errno === 1054) {
        // Legacy schema fallback
        return db.query("SELECT access_mode AS v FROM app_settings LIMIT 1", (e2, r2) => {
          if (e2) return res.status(500).json({ error: e2.message });
          return res.json({ mode: String(r2?.[0]?.v || "all").toLowerCase() });
        });
      }
      if (e) return res.status(500).json({ error: e.message });
      return res.json({ mode: String(rows?.[0]?.v || "all").toLowerCase() });
    }
  );
});


// ====== START SERVER ======
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`↪️  Expecting Moolre extension: ${EXTENSION_EXPECTED}`);
  console.log(`💳  TheTeller: ENABLED (token-based)`);
});
