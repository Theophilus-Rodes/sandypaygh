



// shortcode/ussd.js  (ROUTER VERSION - MOOLRE ONLY)
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
const missing = required.filter(
  (k) => !process.env[k] || String(process.env[k]).trim() === ""
);
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
    const caPath =
      caEnv && caEnv.trim() !== "" ? caEnv : "/etc/ssl/certs/ca-certificates.crt";
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
    : { rejectUnauthorized: false },
};

if (!dbConfig.user) {
  throw new Error(
    "DB_USER is empty — set DB_USER in App Platform → Environment Variables."
  );
}
if (!DB_PASSWORD) {
  throw new Error("DB_PASSWORD is empty — set DB_PASSWORD (or DB_PASS).");
}

// Your short code extension (from Moolre)
const ADMIN_EXTENSIONS = ["888", "444"];
const USER_EXTENSION = "500";



// ✅ Moolre payment accounts
const ADMIN_MOOLRE = {
  url: "https://api.moolre.com/open/transact/payment",
  user: process.env.ADMIN_MOOLRE_USER || "acheamp",
  pubkey: process.env.ADMIN_MOOLRE_PUBKEY || "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyaWQiOjEwNjU0OSwiZXhwIjoxOTI1MDA5OTk5fQ.YNoLN19xWWZRyr2Gdy_2DexpGLZv4V9yATnyYSFef2M",
  wallet: process.env.ADMIN_MOOLRE_WALLET || "10654906056819",
};

const UZO_ADMIN_87_MOOLRE = {
  url: "https://api.moolre.com/open/transact/payment",
  user: process.env.UZO_ADMIN_87_MOOLRE_USER || "dataguygh",
  pubkey: process.env.UZO_ADMIN_87_MOOLRE_PUBKEY || "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyaWQiOjEwNjkxNywiZXhwIjoxOTU2NTQ1OTk5fQ.hpJg5emG0kyO40d7XIaZ12iUAspshzKvNoJPkiorkq8",
  wallet: process.env.UZO_ADMIN_87_MOOLRE_WALLET || "10691706058501",
};

const VENDOR_MOOLRE = {
  url: "https://api.moolre.com/open/transact/payment",
  user: process.env.VENDOR_MOOLRE_USER || "dataguygh",
  pubkey: process.env.VENDOR_MOOLRE_PUBKEY || "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyaWQiOjEwNjkxNywiZXhwIjoxOTU2NTQ1OTk5fQ.hpJg5emG0kyO40d7XIaZ12iUAspshzKvNoJPkiorkq8",
  wallet: process.env.VENDOR_MOOLRE_WALLET || "10691706070650",
};

function getMoolreAccount(state) {
  if (state && state.isUzoAdmin87 === true) {
    return UZO_ADMIN_87_MOOLRE;
  }

  if (state && state.isPlain === true) {
    return ADMIN_MOOLRE;
  }

  return VENDOR_MOOLRE;
}

// ====== MIDDLEWARE (scoped to this router) ======
router.use(express.json({ type: "application/json" })); // for JSON
router.use(bodyParser.text({ type: "*/*" })); // Moolre sometimes sends text/plain
router.use(cors());

// ====== DATABASE ======
const db = mysql.createConnection(dbConfig);

db.connect((err) => {
  if (err) console.error("❌ USSD DB connection failed:", err.message);
  else console.log("✅ USSD connected securely to DigitalOcean MySQL!");
});

const dbp = db.promise(); // for async/await helper queries

// ====== SESSION STATE ======
const sessions = {};

// ====== HELPERS ======

const PAGE_SIZE = 6; // how many packages per page

// Map network name -> Moolre channel ID
function getChannelId(network) {
  switch ((network || "").toLowerCase()) {
    case "mtn":
      return 13;
    case "airteltigo":
    case "airtel":
    case "at":
      return 7;
    case "vodafone":
    case "telecel":
    case "voda":
      return 6;
    default:
      return null;
  }
}

// ✅ PACKAGES LIST WITH PAGINATION
function renderPackages(state) {
  const list = Array.isArray(state.packageList) ? state.packageList : [];
  const total = list.length;
  const page = state.packagePage || 0;
  const start = page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, total);

  if (!total) return "No packages.";

  const lines = [`Packages (${(state.network || "").toUpperCase()})`];

  // Items in this page
  for (let i = start; i < end; i++) {
    lines.push(`${i + 1}) ${list[i]}`);
  }

  // ONLY show “More” — NO BACK
  if (end < total) {
    lines.push("0) More");
  }

  return lines.join("\n");
}


function confirmMessage(state) {
  const [packageName, price] = String(state.selectedPkg || "").split(" @ ");
  return `Confirm Purchase
Recipient: ${state.recipient}
Network: ${(state.network || "").toUpperCase()}
Package: ${packageName || ""}
Price: ${price || ""}

1) Confirm
2) Cancel`;
}

// Normalize to 233XXXXXXXXX
function normalizeMsisdn(msisdn) {
  const digits = String(msisdn || "").replace(/[^\d]/g, "");
  if (digits.startsWith("233")) return digits;
  if (digits.startsWith("0")) return "233" + digits.slice(1);
  if (digits.startsWith("00233")) return digits.slice(2);
  return digits;
}

// Return [233XXXXXXXXX, 0XXXXXXXXX, +233XXXXXXXXX]
function msisdnVariants(msisdn) {
  const intl = normalizeMsisdn(msisdn);
  const local = "0" + intl.slice(3);
  const plusIntl = "+" + intl;
  return [intl, local, plusIntl];
}

// Local "0XXXXXXXXX" for Moolre payer
function toLocalMsisdn(msisdn) {
  const intl = normalizeMsisdn(msisdn);
  return "0" + intl.slice(3);
}

// Access control
function checkAccess(msisdn, cb) {
  db.query(
    "SELECT `value` AS v FROM app_settings WHERE setting='access_mode' LIMIT 1",
    (e, rows) => {
      if (e && e.errno === 1054) {
        return db.query(
          "SELECT access_mode AS v FROM app_settings LIMIT 1",
          (e2, r2) => {
            if (e2) {
              console.error("app_settings legacy query:", e2);
              return cb(true);
            }
            proceed(r2?.[0]?.v);
          }
        );
      }
      if (e) {
        console.error("app_settings query:", e);
        return cb(true);
      }
      proceed(rows?.[0]?.v);
    }
  );

  function proceed(modeRaw) {
    const mode = String(modeRaw || "all").toLowerCase();
    if (mode !== "limited") return cb(true);

    const [intl, local, plusIntl] = msisdnVariants(msisdn);

    db.query(
      "SELECT 1 FROM telephone_numbers WHERE phone_number IN (?, ?, ?) AND (status IS NULL OR status='allowed') LIMIT 1",
      [intl, local, plusIntl],
      (err, r) => {
        if (err) {
          console.error("telephone_numbers query:", err);
          return cb(false);
        }
        cb(!!(r && r.length));
      }
    );
  }
}

async function getLockedNetworks(userId) {
  if (!userId) return [];

  const [rows] = await dbp.query(
    `SELECT network
     FROM user_network_locks
     WHERE user_id = ? AND status = 'locked'`,
    [userId]
  );

  return rows.map(r => {
    const n = String(r.network || "").toLowerCase();

    if (n === "airteltigo" || n === "airtel" || n === "at") {
      return "at";
    }

    return n;
  });
}

async function getUserIdByMsisdn(msisdn) {
  const [intl, local, plusIntl] = msisdnVariants(msisdn);

  try {
    const [rows] = await dbp.query(
      `SELECT id
       FROM users
       WHERE phone IN (?, ?, ?)
          OR telephone IN (?, ?, ?)
       LIMIT 1`,
      [intl, local, plusIntl, intl, local, plusIntl]
    );

    return rows && rows.length ? rows[0].id : null;

  } catch (err) {
    console.error("❌ getUserIdByMsisdn error:", err.message);
    return null;
  }
}


function renderNetworkMenu(state) {
  const locked = state.lockedNetworks || [];

  const networks = [
    { key: "mtn", label: "MTN" },
   { key: "at", label: "AirtelTigo" },
    { key: "telecel", label: "Telecel" }
  ].filter(n => !locked.includes(n.key.toLowerCase()));

  state.availableNetworks = networks;

  if (!networks.length) {
    return "No network is available for you now.";
  }

  let msg = "Network\n";
  networks.forEach((n, index) => {
    msg += `${index + 1}) ${n.label}\n`;
  });
  msg += "0) Back";

  return msg;
}

// ====== CORE SESSION HANDLER ======
async function handleSession(sessionId, input, msisdn, res) {
  const state = sessions[sessionId];

  if (!state) {
    console.error(
      "⚠️ handleSession called but no session state found for:",
      sessionId
    );
    return res.json({
      message: "END Session expired. Please dial again.",
      reply: false,
    });
  }

console.log("➡️ handleSession called:", {
  sessionId,
  step: state.step,
  input,
  msisdn,
  vendorId: state.vendorId,
  isPlain: state.isPlain,
  codeType: state.codeType || null,
  assignedCode: state.assignedCode || null
});

  const reply = (msg) => {
    console.log("📤 USSD reply:", { sessionId, step: state.step, msg });
    return res.json({ message: msg, reply: true });
  };
  const end = (msg) => {
    console.log("📤 USSD end:", { sessionId, step: state.step, msg });
    return res.json({ message: msg, reply: false });
  };

  try {
    switch (state.step) {
      // ================== START ==================
      case "start": {
        state.step = "menu";
        const brand = state.brandName || "SandyPay";
        return reply(
          `${brand}.\nNB: The Data Is NOT INSTANT.\n It takes between 5min to 30Mins to deliver\n0. Cancel\n\n1. Buy Data\n2. Contact Us`
        );
      }

      // ================== MENU ==================
      case "menu": {
        const choice = (input || "").trim();
if (choice === "1") {
let lockUserId = state.vendorId;

try {
  // Admin/plain codes 888, 444 and 426*87 should use admin lock account ID 3
  if (state.isPlain === true) {
    lockUserId = 3;
  }

  state.lockedNetworks = await getLockedNetworks(lockUserId);

  console.log("🔒 NETWORK LOCK CHECK:", {
    isPlain: state.isPlain,
    lockUserId,
    lockedNetworks: state.lockedNetworks
  });

} catch (err) {
  console.error("❌ Network lock check failed:", err.message);
  state.lockedNetworks = [];
}

  state.step = "network";

  const menu = renderNetworkMenu(state);

  if (menu === "No network is available for you now.") {
    return end(menu);
  }

  return reply(menu);
}

        if (choice === "2") {
          if (!state.vendorId || state.isPlain) {
            return end("Contact us:\n0502888235");
          }

          db.query(
            "SELECT phone FROM users WHERE id = ? LIMIT 1",
            [state.vendorId],
            (err, rows) => {
              if (err) {
                console.error("❌ MySQL error (Contact vendor):", err);
                return end("Contact us:\n0502888235");
              }

              if (!rows || !rows.length || !rows[0].phone) {
                return end("Contact us:\n0502888235");
              }

              const phone = rows[0].phone;
              return end(`Contact us:\n${phone}`);
            }
          );
          return;
        }

        if (choice === "0") {
          state.step = "start";
          return reply("Cancelled.\n1. Buy Data\n2. Contact Us");
        }

        return reply("Invalid option. Choose:\n1) Buy Data\n2) Contact Us");
      }

      // ================== NETWORK ==================
      case "network": {
        const choice = (input || "").trim();

       if (choice === "0") {
  state.step = "menu";
  return reply("Back to menu:\n1. Buy Data\n2. Contact Us");
}

const availableNetworks = state.availableNetworks || [];
const selectedIndex = parseInt(choice, 10) - 1;

if (
  !Number.isInteger(selectedIndex) ||
  selectedIndex < 0 ||
  selectedIndex >= availableNetworks.length
) {
  return reply("Invalid network. Choose:\n" + renderNetworkMenu(state));
}

state.network = availableNetworks[selectedIndex].key;

        // PLAIN MODE → AdminData
        if (state.isPlain) {
          const net = state.network.toLowerCase();
          db.query(
            `SELECT 
               package_name AS data_package, 
               price AS amount,
               network
             FROM AdminData
           WHERE status = 'active'
  AND (
    LOWER(network) = LOWER(?)
    OR (? = 'at' AND LOWER(network) IN ('at', 'airteltigo', 'airtel'))
  )
             ORDER BY price ASC`,
            [net, net],
            (err, rows) => {
              try {
                if (err) {
                  console.error("❌ MySQL error (AdminData):", err);
                  return end(
                    "Service temporarily unavailable. Try again later."
                  );
                }

                if (!rows || !rows.length) {
                  return end("No data packages available for this network.");
                }

                state.packageList = rows.map(
                  (r) => `${r.data_package} @ GHS${r.amount}`
                );
                state.packagePage = 0; // reset page
                state.step = "package";
                return reply(renderPackages(state));
              } catch (cbErr) {
                console.error(
                  "❌ USSD callback error (AdminData packages):",
                  cbErr
                );
                return end(
                  "Service temporarily unavailable. Try again later."
                );
              }
            }
          );
          return;
        }

        // VENDOR MODE → data_packages
        const net = state.network.toLowerCase();
   db.query(
  `SELECT data_package, amount
   FROM data_packages
   WHERE vendor_id = ?
     AND (
       LOWER(network) = LOWER(?)
       OR (? = 'at' AND LOWER(network) IN ('at', 'airteltigo', 'airtel'))
     )
     AND status = 'available'
   ORDER BY amount ASC`,
  [state.vendorId, net, net],
          (err, rows) => {
            try {
              if (err) {
                console.error("❌ MySQL error (data_packages):", err);
                return end("Service temporarily unavailable. Try again later.");
              }
              if (!rows || !rows.length)
                return end("No data packages available.");

              state.packageList = rows.map(
                (r) => `${r.data_package} @ GHS${r.amount}`
              );
              state.packagePage = 0; // reset page
              state.step = "package";
              return reply(renderPackages(state));
            } catch (cbErr) {
              console.error(
                "❌ USSD callback error (vendor packages):",
                cbErr
              );
              return end(
                "Service temporarily unavailable. Try again later."
              );
            }
          }
        );
        return;
      }

      // ================== PACKAGE STEP (WITH PAGINATION) ==================
      case "package": {
        const trimmed = (input || "").trim();
        const list = state.packageList || [];
        const total = list.length;
        const page = state.packagePage || 0;
        const start = page * PAGE_SIZE;
        const end = Math.min(start + PAGE_SIZE, total);

        // 0 = "More" if there is another page, otherwise "Back"
        if (trimmed === "0") {
          if (end < total) {
            // go to next page
            state.packagePage = page + 1;
            return reply(renderPackages(state));
          } else {
            // last page → back to network
            state.packagePage = 0;
            state.step = "network";
           return reply(renderNetworkMenu(state));
          }
        }

        // If user presses # or blank, just re-show current page
        if (trimmed === "" || trimmed === "#") {
          return reply(
            "Please enter a number from the list.\n" + renderPackages(state)
          );
        }

        const idx = parseInt(trimmed, 10) - 1;

        if (
          Number.isInteger(idx) &&
          idx >= 0 &&
          idx < total &&
          list[idx]
        ) {
          state.selectedPkg = list[idx];
          state.step = "recipient";
          return reply(
            "Recipient\n1) Buy for self\n2) Buy for others\n0) Back"
          );
        }

        return reply(
          "Invalid selection. Choose a valid number from the list.\n" +
            renderPackages(state)
        );
      }

      // ================== RECIPIENT STEP ==================
      case "recipient": {
        const choice = (input || "").trim();

        if (choice === "1") {
          state.recipient = msisdn;
          state.step = "confirm";
          return reply(confirmMessage(state));
        }
        if (choice === "2") {
          state.step = "other_number";
          return reply("Enter recipient number:");
        }
        if (choice === "0") {
          state.step = "package";
          return reply(renderPackages(state));
        }
        return reply(
          "Invalid option. Choose:\n1) Buy for self\n2) Buy for others\n0) Back"
        );
      }

      // ================== OTHER NUMBER ==================
      case "other_number": {
        state.recipient = input;
        state.step = "confirm";
        return reply(confirmMessage(state));
      }

      // ================== CONFIRM (PAYMENT) ==================
      case "confirm": {
        const choice = (input || "").trim();

        if (choice === "1") {
    // ====== INITIATE PAYMENT VIA MOOLRE ======
          const m = String(state.selectedPkg || "").match(
            /@ GHS\s*(\d+(\.\d+)?)/i
          );
          const amount = m ? parseFloat(m[1]) : 0;
          if (!amount) return end("Invalid amount in package.");

          const network = (state.network || "").toLowerCase();
          const recipient_number = state.recipient;
          const momo_number = msisdn;
          const vendor_id = state.vendorId;
          const data_package = String(state.selectedPkg || "").split(" @")[0];

          const transactionId = `TRX${Date.now()}`.slice(0, 30);

          // 👉 Save pending order in DB using this externalref
          db.query(
            `INSERT INTO moolre_temp_orders
               (externalref, mode, vendor_id, data_package, network,
                recipient_number, momo_number, amount)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              transactionId,
              state.isPlain ? "plain" : "vendor",
              vendor_id,
              data_package,
              network,
              recipient_number,
              momo_number,
              amount,
            ],
            (err) => {
              if (err) {
                console.error("❌ moolre_temp_orders insert error:", err);
              } else {
                console.log("✅ Temp order saved for externalref:", transactionId);
              }
            }
          );

          // Close USSD first
end(
  "Please wait for payment prompt.\nEnter your MoMo PIN to approve.\nCheck My Approvals if delayed."
);

const channelId = getChannelId(network);

if (!channelId) {
  console.error("❌ Unsupported network for Moolre:", network);
  return;
}

const moolreAccount = getMoolreAccount(state);

const payload = {
  type: 1,
  channel: channelId,
  currency: "GHS",
  payer: toLocalMsisdn(momo_number),
  amount: Number(amount.toFixed(2)),
  externalref: transactionId,
  reference: `Purchase of ${data_package}`,
  accountnumber: moolreAccount.wallet,
  sessionid: state.moolreSessionId,
  thirdpartyref: JSON.stringify({
    mode: state.isPlain ? "plain" : "vendor",
    vendor_id,
    data_package,
    network,
    recipient_number,
    momo_number,
  }),
};

console.log("📤 Sending payment to MOOLRE:", {
  accountUser: moolreAccount.user,
  wallet: moolreAccount.wallet,
  payload,
});

axios
  .post(moolreAccount.url, payload, {
    headers: {
      "Content-Type": "application/json",
      "X-API-USER": moolreAccount.user,
      "X-API-PUBKEY": moolreAccount.pubkey,
    },
  })
  .then((response) => {
    console.log("✅ MOOLRE payment INIT response:", response.data);
  })
  .catch((err) => {
    console.error("❌ MOOLRE payment error:", err.response?.data || err.message);
  });

return;
        }

        if (choice === "2") return end("Transaction cancelled.");
        return reply("Invalid input.\n1) Confirm\n2) Cancel");
      }

      // ================== DEFAULT ==================
      default: {
        state.step = "start";
        return reply("Restarting...\n1. Buy Data\n2. Contact Us");
      }
    }
  } catch (err) {
    console.error("❌ USSD runtime error:", err);
    return end("Service temporarily unavailable. Try again later.");
  }
}


// =====================================================
// CREATE A VENDOR SESSION FOR EITHER MOOLRE OR UZO
// =====================================================
async function createAssignedVendorSession({
  sessionKey,
  vendorId,
  msisdn,
  responseObject,
  source = "moolre",
  assignedCode = null
}) {
  const numericVendorId = Number(vendorId);

  if (!numericVendorId) {
    return responseObject.json({
      message: "APPLICATION UNKNOWN.",
      reply: false
    });
  }

  // Check that vendor exists and is not locked
  const [vendorRows] = await dbp.query(
    `SELECT
       id,
       username,
       ussd_locked
     FROM users
     WHERE id = ?
       AND LOWER(role) = 'vendor'
     LIMIT 1`,
    [numericVendorId]
  );

  if (!vendorRows || !vendorRows.length) {
    console.log("❌ Assigned vendor not found:", numericVendorId);

    return responseObject.json({
      message: "APPLICATION UNKNOWN.",
      reply: false
    });
  }

  const vendor = vendorRows[0];

  if (Number(vendor.ussd_locked) === 1) {
    console.log("❌ Assigned vendor is locked:", numericVendorId);

    return responseObject.json({
      message:
        "This vendor account has been locked. Please contact admin for support.",
      reply: false
    });
  }

  // Check vendor session balance
  const remaining = await getRemainingHits(numericVendorId);

  console.log("📊 Remaining vendor hits:", {
    vendorId: numericVendorId,
    remaining,
    source,
    assignedCode
  });

  if (remaining <= 0) {
    return responseObject.json({
      message: "APPLICATION UNKNOWN.",
      reply: false
    });
  }

  // Deduct one session
  const consumed = await consumeOneHit(numericVendorId);

  if (!consumed) {
    return responseObject.json({
      message: "Sorry, your session has finished.",
      reply: false
    });
  }

  await incrementUssdCounter(numericVendorId);

  // Save the customer with correct source
  await saveVendorCustomer(
    numericVendorId,
    msisdn,
    source
  );

  // Create shared session
  sessions[sessionKey] = {
    step: "start",
    vendorId: numericVendorId,
    brandName: vendor.username || "SandyPay",
    isPlain: false,

    // Shows whether customer entered through Uzo or Moolre
    codeType: source,
    assignedCode,

    network: "",
    selectedPkg: "",
    recipient: "",
    packageList: [],
    packagePage: 0,
    moolreSessionId: sessionKey
  };

  console.log("🟩 CREATED ASSIGNED VENDOR SESSION:", {
    sessionKey,
    vendorId: numericVendorId,
    source,
    assignedCode
  });

  return handleSession(
    sessionKey,
    "",
    String(msisdn || ""),
    responseObject
  );
}

// ====== USSD ROUTE (Moolre) ======
router.post("/", (req, res) => {
  console.log("📲 NEW USSD REQUEST:", req.body);

  let payload = {};
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.json({ message: "END Invalid JSON format", reply: false });
  }

  const { sessionId, msisdn, data, message, extension, new: isNew } = payload;
// Extension supplied by Moolre
const ext = String(extension || "")
  .replace(/[^\d]/g, "")
  .trim();

if (!ext) {
  console.log("❌ Missing Moolre extension:", extension);

  return res.json({
    message: "END Invalid USSD entry point",
    reply: false
  });
}

/*
  We no longer reject every extension except 888, 444 and 500 here.

  888 and 444 remain admin extensions.
  500 remains the legacy vendor-ID extension.
  Other extensions will be checked against uzo_vendor_codes
  where code_type = 'moolre'.
*/

  const inputFromUser = (data || message || "").trim();
  const isNewSession = isNew === true || !sessions[sessionId];

  console.log("🔍 SESSION CHECK:", {
    sessionId,
    isNewSession,
    data,
    message,
    inputFromUser,
  });

  // CASE 1: NEW PLAIN SESSION (*203*717#)
if (isNewSession && !inputFromUser && ADMIN_EXTENSIONS.includes(ext)) {
    console.log("🟦 NEW PLAIN SESSION for:", msisdn);

    const [intl, local, plusIntl] = msisdnVariants(msisdn);

    db.query(
      `SELECT 1
         FROM telephone_numbers
        WHERE phone_number IN (?, ?, ?)
          AND (status IS NULL OR status='allowed')
        LIMIT 1`,
      [intl, local, plusIntl],
      (err, rows) => {
        if (err) {
          console.error("❌ telephone_numbers lookup error:", err);
          return res.json({
            message: "APPLICATION UNKNOWN",
            reply: false,
          });
        }

        if (!rows || !rows.length) {
          console.log(
            "❌ MSISDN not found in telephone_numbers for plain mode:",
            msisdn
          );
          return res.json({
            message: "APPLICATION UNKNOWN",
            reply: false,
          });
        }

        sessions[sessionId] = {
          step: "start",
          vendorId: 1,
          brandName: "SandyPay",
          isPlain: true,
          network: "",
          selectedPkg: "",
          recipient: "",
          packageList: [],
          packagePage: 0,
          moolreSessionId: sessionId,
        };

        console.log("🟦 CREATED PLAIN SESSION:", sessions[sessionId]);
        return handleSession(sessionId, "", String(msisdn || ""), res);
      }
    );

    return;
  }

  // CASE 2: Vendor sessions & existing sessions
  checkAccess(msisdn, (allowed) => {
    if (!allowed) {
      return res.json({
        message: "Sorry, you don't have access.",
        reply: false,
      });
    }

    const isNewSessionInner = isNew === true || !sessions[sessionId];
    const inputInner = inputFromUser;

    // New vendor session *203*717*ID#
// =====================================================
// NEW MOOLRE VENDOR SESSION
// =====================================================
if (isNewSessionInner) {
  (async () => {
    /*
      LEGACY MODE

      Extension 500 continues to work with the vendor ID supplied
      as the first input.

      Example:
      assigned entry using extension 500 + vendor ID.
    */
    if (ext === USER_EXTENSION) {
      console.log(
        "🟨 NEW LEGACY MOOLRE VENDOR SESSION:",
        {
          extension: ext,
          firstInput: inputInner
        }
      );

      const rawVendorId = String(inputInner || "")
        .replace(/[^\d]/g, "");

      const vendorId = Number(rawVendorId);

      if (!vendorId) {
        return res.json({
          message: "END Invalid vendor entry.",
          reply: false
        });
      }

      return createAssignedVendorSession({
        sessionKey: sessionId,
        vendorId,
        msisdn,
        responseObject: res,
        source: "moolre",
        assignedCode: ext
      });
    }

    /*
      ASSIGNED MOOLRE CODE MODE

      For every other extension, find the active vendor assignment
      where code_type is moolre.
    */
    console.log("🟨 CHECKING ASSIGNED MOOLRE CODE:", {
      extension: ext,
      msisdn,
      sessionId
    });

    const [codeRows] = await dbp.query(
      `SELECT
         uvc.id AS assignment_id,
         uvc.vendor_id,
         uvc.code,
         uvc.code_type,
         uvc.status,
         uvc.expiry_date,

         u.username,
         u.ussd_locked

       FROM uzo_vendor_codes uvc

       JOIN users u
         ON u.id = uvc.vendor_id

       WHERE uvc.code = ?
         AND LOWER(COALESCE(uvc.code_type, 'uzo')) = 'moolre'
         AND LOWER(uvc.status) = 'active'
         AND (
           uvc.expiry_date IS NULL
           OR uvc.expiry_date >= CURDATE()
         )
         AND LOWER(u.role) = 'vendor'

       LIMIT 1`,
      [ext]
    );

    if (!codeRows || !codeRows.length) {
      console.log(
        "❌ Moolre extension is not assigned to an active vendor:",
        ext
      );

      return res.json({
        message: "END APPLICATION UNKNOWN.",
        reply: false
      });
    }

    const assignedVendor = codeRows[0];

    console.log("✅ MOOLRE CODE ASSIGNMENT FOUND:", {
      extension: ext,
      vendorId: assignedVendor.vendor_id,
      codeType: assignedVendor.code_type,
      expiryDate: assignedVendor.expiry_date
    });

    return createAssignedVendorSession({
      sessionKey: sessionId,
      vendorId: assignedVendor.vendor_id,
      msisdn,
      responseObject: res,
      source: "moolre",
      assignedCode: ext
    });

  })().catch((error) => {
    console.error(
      "❌ Assigned Moolre vendor session error:",
      error
    );

    return res.json({
      message:
        "END Service temporarily unavailable. Please try again later.",
      reply: false
    });
  });

  return;
}


    // Existing session – continue
    return handleSession(sessionId, inputInner, String(msisdn || ""), res);
  });
});




///// Uzo Code
// ====== USSD ROUTE (UZO - VENDORS ONLY) ======
///// Uzo Code
// ====== USSD ROUTE (UZO - VENDORS ONLY - PRIVATE CODE MAPPING) ======
router.post("/uzo", (req, res) => {
  console.log("📲 NEW UZO USSD REQUEST:", req.body);

  let payload = {};
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.json({
      message: "Invalid JSON format",
      ussdServiceOp: 17,
    });
  }

  const {
    ussdString,
    msisdn,
    ussdServiceOp,
    sessionID,
    sessionId,
    code,
  } = payload;

  const rawSessionId = String(sessionID || sessionId || "").trim();
  const uzoSessionKey = `UZO_${rawSessionId}`;

  if (!rawSessionId) {
    return res.json({
      message: "Invalid session.",
      ussdServiceOp: 17,
    });
  }

  const fullUssd = String(ussdString || "").trim();
  const baseCode = String(code || "").trim();

  console.log("🔍 UZO SESSION CHECK:", {
    uzoSessionKey,
    fullUssd,
    baseCode,
    msisdn,
    ussdServiceOp,
  });

  const uzoRes = {
    json: (data) => {
      const msg = String(data?.message || "").replace(/^END\s*/i, "");

      return res.json({
        message: msg,
        ussdServiceOp: data?.reply === false ? 17 : 2,
      });
    },
  };

  const parts = fullUssd
    .replace(/^#|#$/g, "")
    .split("*")
    .filter(Boolean);

  const baseParts = baseCode
    .replace(/^#|#$/g, "")
    .split("*")
    .filter(Boolean);

  const mainCode = parts[0] || baseParts[0];
const uzoCode = parts[1] || baseParts[1];

// Existing session first
if (sessions[uzoSessionKey]) {

  // Uzo usually sends only latest input after first screen
  const lastInput =
    parts.length > 0
      ? parts[parts.length - 1]
      : String(ussdString || "").trim();

if (sessions[uzoSessionKey]?.isUzoAdmin87 === true) {
  return handleSession(
    uzoSessionKey,
    lastInput || "",
    String(msisdn || ""),
    uzoRes
  );
}

return checkAccess(msisdn, (allowed) => {
    if (!allowed) {
      return res.json({
        message: "Sorry, you don't have access.",
        ussdServiceOp: 17,
      });
    }

    return handleSession(
      uzoSessionKey,
      lastInput || "",
      String(msisdn || ""),
      uzoRes
    );
  });
}


// ✅ UZO ADMIN CODE: *426*87#
// Works like admin 888/plain mode
// ✅ UZO ADMIN CODE: *426*87#
// Allows ALL numbers, uses AdminData, but uses special UZO payment account
if (mainCode === "426" && uzoCode === "87") {
  sessions[uzoSessionKey] = {
    step: "start",
    vendorId: 1,
    brandName: "SandyPay",
    isPlain: true,
    isUzoAdmin87: true,
    network: "",
    selectedPkg: "",
    recipient: "",
    packageList: [],
    packagePage: 0,
    moolreSessionId: uzoSessionKey,
    uzoCode: "87",
  };

  console.log("🟦 CREATED UZO ADMIN 87 SESSION - ALL NUMBERS ALLOWED:", {
    uzoSessionKey,
    msisdn,
  });

  return handleSession(
    uzoSessionKey,
    "",
    String(msisdn || ""),
    uzoRes
  );
}
// ONLY validate entry point for NEW session
if (mainCode !== "426" || !uzoCode) {
  return res.json({
    message: "Invalid USSD entry point.",
    ussdServiceOp: 17,
  });
}
  // New Uzo session:
  // Uzo does not support vendor ID in the dial code,
  // so we check uzo_vendor_codes table to know which vendor owns the code.
  checkAccess(msisdn, (allowed) => {
    if (!allowed) {
      return res.json({
        message: "Sorry, you don't have access.",
        ussdServiceOp: 17,
      });
    }

    console.log("🟧 NEW UZO PRIVATE CODE SESSION:", {
      uzoCode,
      msisdn,
      uzoSessionKey,
    });

    (async () => {
 const [codeRows] = await dbp.query(
  `SELECT
     uvc.id AS assignment_id,
     uvc.vendor_id,
     uvc.code,
     uvc.code_type,
     uvc.status,
     uvc.expiry_date,

     u.username,
     u.ussd_locked

   FROM uzo_vendor_codes uvc

   JOIN users u
     ON u.id = uvc.vendor_id

   WHERE uvc.code = ?
     AND LOWER(COALESCE(uvc.code_type, 'uzo')) = 'uzo'
     AND LOWER(uvc.status) = 'active'
     AND (
       uvc.expiry_date IS NULL
       OR uvc.expiry_date >= CURDATE()
     )
     AND LOWER(u.role) = 'vendor'

   LIMIT 1`,
  [uzoCode]
);

      if (!codeRows || !codeRows.length) {
        console.log("❌ Uzo code not mapped to any active vendor:", uzoCode);
        return res.json({
          message: "APPLICATION UNKNOWN.",
          ussdServiceOp: 17,
        });
      }

      if (Number(codeRows[0].ussd_locked) === 1) {
  console.log("❌ Uzo vendor account locked:", codeRows[0].vendor_id);

  return res.json({
    message: "This vendor account has been locked. Please contact admin for support.",
    ussdServiceOp: 17,
  });
}

const vendorId = Number(codeRows[0].vendor_id);

console.log("✅ UZO CODE ASSIGNMENT FOUND:", {
  uzoCode,
  vendorId,
  codeType: codeRows[0].code_type,
  expiryDate: codeRows[0].expiry_date
});

return createAssignedVendorSession({
  sessionKey: uzoSessionKey,
  vendorId,
  msisdn,
  responseObject: uzoRes,
  source: "uzo",
  assignedCode: uzoCode
});     


    })().catch((e) => {
      console.error("❌ UZO private code session error:", e);

      return res.json({
        message: "Service temporarily unavailable. Please try again later.",
        ussdServiceOp: 17,
      });
    });
  });
});
/////////////////////////////////////////////////////////////////////////////////////////



async function saveVendorCustomer(vendorId, msisdn, source = "moolre") {
  const customerNumber = normalizeMsisdn(msisdn);

  if (!vendorId || !customerNumber) return;

  await dbp.query(
    `INSERT INTO vendor_customers 
      (vendor_id, customer_number, source)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE 
      source = VALUES(source)`,
    [vendorId, customerNumber, source]
  );
}
// HIT HELPERS
async function getRemainingHits(vendorId) {
  const [rows] = await dbp.query(
    `SELECT COALESCE(SUM(CASE WHEN status='completed' THEN hits ELSE 0 END), 0) AS total_hits
     FROM session_purchases
     WHERE vendor_id = ?`,
    [vendorId]
  );
  return Number(rows?.[0]?.total_hits || 0);
}

async function consumeOneHit(vendorId) {
  const [pick] = await dbp.query(
    `SELECT id, hits
       FROM session_purchases
       WHERE vendor_id = ? AND status='completed' AND hits > 0
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    [vendorId]
  );
  if (!pick || !pick.length) return false;
  const row = pick[0];
  const newHits = Math.max(0, Number(row.hits) - 1);
  await dbp.query(
    `UPDATE session_purchases SET hits = ? WHERE id = ?`,
    [newHits, row.id]
  );
  return true;
}

async function incrementUssdCounter(vendorId) {
  await dbp.query(
    `INSERT INTO ussd_session_counters (vendor_id, hits_used)
     VALUES (?, 1)
     ON DUPLICATE KEY UPDATE hits_used = hits_used + 1`,
    [vendorId]
  );
}



module.exports = router;
