



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




// ✅ BulkClix payment accounts
const BULKCLIX_BASE_URL = "https://api.bulkclix.com/api/v1/payment-api";

const ADMIN_BULKCLIX = {
  url: `${BULKCLIX_BASE_URL}/momopay`,
  apiKey: process.env.ADMIN_BULKCLIX_API_KEY || "fTQMwISNm8wyFn6Xg5eY6xj8IU6tdqEdIwRLJk3K",
};

const VENDOR_BULKCLIX = {
  url: `${BULKCLIX_BASE_URL}/momopay`,
  apiKey: process.env.VENDOR_BULKCLIX_API_KEY || "fTQMwISNm8wyFn6Xg5eY6xj8IU6tdqEdIwRLJk3K",
};

const UZO_ADMIN_87_BULKCLIX = {
  url: `${BULKCLIX_BASE_URL}/momopay`,
  apiKey: process.env.UZO_ADMIN_87_BULKCLIX_API_KEY || "fTQMwISNm8wyFn6Xg5eY6xj8IU6tdqEdIwRLJk3K",
};

function getBulkClixAccount(state) {
  if (state && state.isUzoAdmin87 === true) return UZO_ADMIN_87_BULKCLIX;
  if (state && state.isPlain === true) return ADMIN_BULKCLIX;
  return VENDOR_BULKCLIX;
}

function getBulkClixNetwork(network) {
  switch ((network || "").toLowerCase()) {
    case "mtn":
      return "MTN";
    case "airteltigo":
    case "airtel":
    case "at":
      return "AIRTELTIGO";
    case "telecel":
    case "vodafone":
    case "voda":
      return "TELECEL";
    default:
      return null;
  }
}

// ✅ Moolre account for VENDOR payments only
const VENDOR_MOOLRE = {
  url: "https://api.moolre.com/open/transact/payment",
  user: process.env.VENDOR_MOOLRE_USER || "dataguygh",
  pubkey: process.env.VENDOR_MOOLRE_PUBKEY || "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyaWQiOjEwNjkxNywiZXhwIjoxOTU2NTQ1OTk5fQ.hpJg5emG0kyO40d7XIaZ12iUAspshzKvNoJPkiorkq8",
  wallet: process.env.VENDOR_MOOLRE_WALLET || "10691706070650",
};


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

// ====== CORE SESSION HANDLER ======
function handleSession(sessionId, input, msisdn, res) {
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
          state.step = "network";
          return reply("Network\n1) MTN\n2) AirtelTigo\n3) Telecel\n0) Back");
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

        if (choice === "1") state.network = "mtn";
        else if (choice === "2") state.network = "airteltigo";
        else if (choice === "3") state.network = "telecel";
        else if (choice === "0") {
          state.step = "menu";
          return reply("Back to menu:\n1. Buy Data\n2. Contact Us");
        } else {
          return reply(
            "Invalid network. Choose:\n1) MTN\n2) AirtelTigo\n3) Telecel"
          );
        }

        // PLAIN MODE → AdminData
        if (state.isPlain) {
          const net = state.network.toLowerCase();
          db.query(
            `SELECT 
               package_name AS data_package, 
               price AS amount,
               network
             FROM AdminData
             WHERE status = 'active' AND network = ?
             ORDER BY price ASC`,
            [net],
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
           WHERE vendor_id = ? AND network = ? AND status = 'available'
           ORDER BY amount ASC`,
          [state.vendorId, net],
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
            return reply("Choose network:\n1) MTN\n2) AirtelTigo\n3) Telecel");
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
          // ====== INITIATE PAYMENT VIA BULKCLIX ======
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

      // ✅ VENDOR PAYMENTS USE MOOLRE
if (!state.isPlain && !state.isUzoAdmin87) {
  const channelId = getChannelId(network);

  if (!channelId) {
    console.error("❌ Unsupported network for Moolre:", network);
    return;
  }

  const payload = {
    type: 1,
    channel: channelId,
    currency: "GHS",
    payer: toLocalMsisdn(momo_number),
    amount: Number(amount.toFixed(2)),
    externalref: transactionId,
    reference: `Purchase of ${data_package}`,
    accountnumber: VENDOR_MOOLRE.wallet,
    sessionid: state.moolreSessionId,

    thirdpartyref: JSON.stringify({
      mode: "vendor",
      vendor_id,
      data_package,
      network,
      recipient_number,
      momo_number,
    }),
  };

  console.log("📤 Sending VENDOR payment to MOOLRE:", payload);

  axios
    .post(VENDOR_MOOLRE.url, payload, {
      headers: {
        "Content-Type": "application/json",
        "X-API-USER": VENDOR_MOOLRE.user,
        "X-API-PUBKEY": VENDOR_MOOLRE.pubkey,
      },
    })
    .then((response) => {
      console.log("✅ MOOLRE vendor payment INIT response:", response.data);
    })
    .catch((err) => {
      console.error("❌ MOOLRE vendor error:", err.response?.data || err.message);
    });

  return;
}

// ✅ ADMIN PAYMENTS USE BULKCLIX
const bulkNetwork = getBulkClixNetwork(network);

if (!bulkNetwork) {
  console.error("❌ Unsupported network for BulkClix:", network);
  return;
}

const bulkClixAccount = getBulkClixAccount(state);

const payload = {
  amount: Number(amount.toFixed(2)),
  phone_number: toLocalMsisdn(momo_number),
  network: bulkNetwork,
  transaction_id: transactionId,
  callback_url: "https://sandipay.co/api/moolre/bulkclix-webhook",
  reference: `SANDYPAY ${data_package}`,
};

console.log("📤 Sending ADMIN payment to BULKCLIX:", payload);

axios
  .post(bulkClixAccount.url, payload, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-key": bulkClixAccount.apiKey,
    },
  })
  .then((response) => {
    console.log("✅ BULKCLIX admin payment INIT response:", response.data);
  })
  .catch((err) => {
    console.error("❌ BULKCLIX admin error:", err.response?.data || err.message);
  });          return;
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

  // Wrong extension
 const ext = String(extension || "").trim();

// Only allow admin(888) or user/vendor(500)
if (!ADMIN_EXTENSIONS.includes(ext) && ext !== USER_EXTENSION) {
  console.log("❌ Invalid extension:", extension);
  return res.json({ message: "END Invalid USSD entry point", reply: false });
}

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
 if (isNewSessionInner) {
  if (ext !== USER_EXTENSION) {
    return res.json({
      message: "END Invalid user entry point",
      reply: false,
    });
  }

  console.log(
    "🟨 NEW VENDOR SESSION (ID MODE). Raw first data:",
    inputInner
  );

      (async () => {
        const raw = String(inputInner || "").trim();
        const vendorIdFromDial = parseInt(raw.replace(/\D/g, ""), 10);
        const vendorId =
          Number.isInteger(vendorIdFromDial) && vendorIdFromDial > 0
            ? vendorIdFromDial
            : 1;


          const [vendorRows] = await dbp.query(
  `SELECT id, username, ussd_locked 
   FROM users 
   WHERE id = ? AND role = 'vendor' 
   LIMIT 1`,
  [vendorId]
);

if (!vendorRows || !vendorRows.length) {
  return res.json({
    message: "APPLICATION UNKNOWN.",
    reply: false,
  });
}

if (Number(vendorRows[0].ussd_locked) === 1) {
  return res.json({
    message: "This vendor account has been locked. Please contact admin for support.",
    reply: false,
  });
}

        const remaining = await getRemainingHits(vendorId);
        console.log("📊 Remaining hits for vendor", vendorId, "=", remaining);
        if (remaining <= 0) {
          return res.json({
            message: "APPLICATION UNKNOWN.",
            reply: false,
          });
        }

        const ok = await consumeOneHit(vendorId);
        if (!ok) {
          return res.json({
            message: "END Sorry, your session has finished.",
            reply: false,
          });
        }

        await incrementUssdCounter(vendorId);
        await saveVendorCustomer(vendorId, msisdn, "moolre");

        db.query(
          "SELECT username FROM users WHERE id = ? LIMIT 1",
          [vendorId],
          (err, rows) => {
            let brandName = "SandyPay";
            if (!err && rows && rows.length && rows[0].username) {
              brandName = rows[0].username;
            }

            sessions[sessionId] = {
              step: "start",
              vendorId,
              brandName,
              isPlain: false,
              network: "",
              selectedPkg: "",
              recipient: "",
              packageList: [],
              packagePage: 0,
              moolreSessionId: sessionId,
            };

            console.log("🟩 CREATED VENDOR SESSION:", sessions[sessionId]);
            return handleSession(sessionId, "", String(msisdn || ""), res);
          }
        );
      })().catch((e) => {
        console.error("❌ Vendor session error:", e.message);
        return res.json({
          message: "END Service temporarily unavailable. Please try again later.",
          reply: false,
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
   uvc.vendor_id,
   u.username,
   u.ussd_locked
 FROM uzo_vendor_codes uvc
 JOIN users u ON u.id = uvc.vendor_id
 WHERE uvc.code = ?
   AND uvc.status = 'active'
   AND u.role = 'vendor'
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

      const vendorId = codeRows[0].vendor_id;
      const brandName = codeRows[0].username || "SandyPay";

      const remaining = await getRemainingHits(vendorId);

      console.log("📊 UZO Remaining hits for vendor", vendorId, "=", remaining);

      if (remaining <= 0) {
        return res.json({
          message: "APPLICATION UNKNOWN.",
          ussdServiceOp: 17,
        });
      }

      const ok = await consumeOneHit(vendorId);

      if (!ok) {
        return res.json({
          message: "Sorry, your session has finished.",
          ussdServiceOp: 17,
        });
      }

      await incrementUssdCounter(vendorId);
      await saveVendorCustomer(vendorId, msisdn, "uzo");

      sessions[uzoSessionKey] = {
        step: "start",
        vendorId,
        brandName,
        isPlain: false,
        network: "",
        selectedPkg: "",
        recipient: "",
        packageList: [],
        packagePage: 0,
        moolreSessionId: uzoSessionKey,
        uzoCode,
      };

      console.log("🟩 CREATED UZO VENDOR SESSION:", sessions[uzoSessionKey]);

      return handleSession(
        uzoSessionKey,
        "",
        String(msisdn || ""),
        uzoRes
      );
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



// ✅ BulkClix payment webhook
router.post("/bulkclix-webhook", async (req, res) => {
  try {
    console.log("📩 BULKCLIX WEBHOOK:", req.body);

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const transactionId = body.transaction_id;
    const status = String(body.status || "").toLowerCase();

    if (!transactionId) {
      return res.status(400).send("Missing transaction_id");
    }

    if (status !== "success") {
      console.log("⚠️ BulkClix not successful:", status);
      return res.status(200).send("OK");
    }

    const [orders] = await dbp.query(
      `SELECT * FROM moolre_temp_orders WHERE externalref = ? LIMIT 1`,
      [transactionId]
    );

    if (!orders || !orders.length) {
      return res.status(200).send("No matching temp order");
    }

    const meta = orders[0];

    const mode = meta.mode;
    const vendor_id = Number(meta.vendor_id);
    const data_package = meta.data_package;
    const network = String(meta.network || "").toLowerCase();
    const recipient_number = meta.recipient_number || body.phone_number;
    const momo_number = meta.momo_number || body.phone_number;
    const amountPaid = Number(meta.amount);

    const package_id =
      body.ext_transaction_id || new Date().toISOString().slice(0, 16).replace("T", " ");

    if (mode === "plain") {
      await dbp.query(
        `INSERT INTO admin_orders
         (vendor_id, recipient_number, data_package, amount, network, status, sent_at, package_id)
         VALUES (?, ?, ?, ?, ?, 'pending', NOW(), ?)`,
        [1, recipient_number, data_package, amountPaid, network, package_id]
      );

      await dbp.query(
        `INSERT INTO total_revenue (vendor_id, source, amount, date_received)
         VALUES (?, ?, ?, NOW())`,
        [1, "AdminData USSD sale", amountPaid]
      );

      await dbp.query(
        `DELETE FROM moolre_temp_orders WHERE externalref = ?`,
        [transactionId]
      );

      return res.status(200).send("OK");
    }

    const [baseRows] = await dbp.query(
      `SELECT amount FROM admin_data_packages WHERE data_package = ? LIMIT 1`,
      [data_package]
    );

    if (!baseRows || !baseRows.length) {
      console.error("❌ admin_data_packages lookup failed:", data_package);
      return res.status(500).send("Package lookup error");
    }

    const baseAmount = parseFloat(baseRows[0].amount);
    let revenueAmount = baseAmount;
    let vendorAmount = parseFloat((amountPaid - baseAmount).toFixed(2));

    const [destRows] = await dbp.query(
      `SELECT order_destination
       FROM vendor_order_settings
       WHERE vendor_id = ?
       LIMIT 1`,
      [vendor_id]
    );

    const destination =
      destRows && destRows.length ? destRows[0].order_destination : "admin_orders";

    const targetTable =
      destination === "vendor_orders" ? "vendor_orders" : "admin_orders";

    if (targetTable === "vendor_orders") {
      revenueAmount = parseFloat((amountPaid * 0.01).toFixed(2));
      vendorAmount = parseFloat((amountPaid - revenueAmount).toFixed(2));
    }

    await dbp.query(
      `INSERT INTO ${targetTable}
       (vendor_id, recipient_number, data_package, amount, network, status, sent_at, package_id)
       VALUES (?, ?, ?, ?, ?, 'pending', NOW(), ?)`,
      [vendor_id, recipient_number, data_package, amountPaid, network, package_id]
    );

    await dbp.query(
      `INSERT INTO wallet_loads (vendor_id, momo, amount, date_loaded)
       VALUES (?, ?, ?, NOW())`,
      [vendor_id, momo_number, vendorAmount]
    );

    await dbp.query(
      `INSERT INTO total_revenue (vendor_id, source, amount, date_received)
       VALUES (?, ?, ?, NOW())`,
      [vendor_id, `Admin base for ${network} ${data_package}`, revenueAmount]
    );

    await dbp.query(
      `DELETE FROM moolre_temp_orders WHERE externalref = ?`,
      [transactionId]
    );

    console.log("✅ BulkClix order saved successfully:", transactionId);
    return res.status(200).send("OK");

  } catch (err) {
    console.error("❌ BulkClix webhook error:", err);
    return res.status(500).send("Server error");
  }
});

module.exports = router;
