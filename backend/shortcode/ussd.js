



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

// 444 works in two ways:
// *203*444#       = admin
// *203*444*ID#    = default vendor
const USER_EXTENSION = "444";




// ✅ BulkClix payment accounts
const BULKCLIX_BASE_URL = "https://api.bulkclix.com/api/v1/payment-api";

const ADMIN_BULKCLIX = {
  url: `${BULKCLIX_BASE_URL}/momopay`,
  apiKey: process.env.ADMIN_BULKCLIX_API_KEY || "fTQMwISNm8wyFn6Xg5eY6xj8IU6tdqEdIwRLJk3K",
};

const VENDOR_BULKCLIX = {
  url: `${BULKCLIX_BASE_URL}/momopay`,
  apiKey:
    process.env.VENDOR_BULKCLIX_API_KEY ||
    "atsrf36Y37tVpSvzwI2nS2N451G9NwYpJLxzEPht",
};

const UZO_ADMIN_87_BULKCLIX = {
  url: `${BULKCLIX_BASE_URL}/momopay`,
  apiKey: process.env.UZO_ADMIN_87_BULKCLIX_API_KEY || "fTQMwISNm8wyFn6Xg5eY6xj8IU6tdqEdIwRLJk3K",
};

////////////////////////////////////////////////////////////////////////////////Me
// ======================================================
// FASTUPPAGE BULKCLIX ACCOUNT
// Used ONLY by UZO *920*142#
// ======================================================

const FASTUPPAGE_BULKCLIX = {
  url: `${BULKCLIX_BASE_URL}/momopay`,

  apiKey:
    process.env.FASTUPPAGE_BULKCLIX_API_KEY || "cKfY4iURvjRTRPFrQSgTP7X6taXsM7fwzGNueQTd",
};
/////////////////////////////////////////////////////////////////////////////////Me

// ✅ MOOLRE ACCOUNT USED ONLY BY ARKESEL *928*145#
// ✅ MOOLRE ACCOUNT USED ONLY BY ARKESEL *928*145#
// const ARKESEL_ADMIN_MOOLRE = {
//   url: "https://api.moolre.com/open/transact/payment",

//   user:
//     process.env.ARKESEL_ADMIN_MOOLRE_USER ||
//     "dataguygh",

//   pubkey:
//     process.env.ARKESEL_ADMIN_MOOLRE_PUBKEY ||
//     "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyaWQiOjEwNjkxNywiZXhwIjoxOTU2NTQ1OTk5fQ.hpJg5emG0kyO40d7XIaZ12iUAspshzKvNoJPkiorkq8",

//   wallet:
//     process.env.ARKESEL_ADMIN_MOOLRE_WALLET ||
//     "10691706058501",
// };

function getBulkClixAccount(state) {
  // UZO Admin (*426*87#)
  if (state && state.isUzoAdmin87 === true) {
    return UZO_ADMIN_87_BULKCLIX;
  }

// FROG Admin (*800*789#)
if (state && state.isFrogAdmin789 === true) {
  return VENDOR_BULKCLIX;
}

  // Normal admin (*203*888# / *203*444#)
  if (state && state.isPlain === true) {
    return ADMIN_BULKCLIX;
  }

  // All vendor USSD codes
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


// ====== MIDDLEWARE (scoped to this router) ======

// JSON requests from Moolre, UZO and NALO Solutions
router.use(express.json({
  type: ["application/json", "text/json", "application/*+json"]
}));

// Keep URL-encoded support as a fallback
router.use(express.urlencoded({ extended: false }));

// Moolre sometimes sends text/plain
router.use(bodyParser.text({ type: "text/plain" }));

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

// ======================================================
// SEND ARKESEL PAYMENT THROUGH MOOLRE
// Used only by *928*145#
// ======================================================
// async function sendArkeselMoolrePayment({
//   amount,
//   network,
//   momoNumber,
//   transactionId,
//   dataPackage,
// }) {
//   const channel = getChannelId(network);

//   if (!channel) {
//     throw new Error(`Unsupported Moolre network: ${network}`);
//   }

//   const payer = toLocalMsisdn(momoNumber);

//   if (!/^0\d{9}$/.test(payer)) {
//     throw new Error(`Invalid Moolre payer number: ${payer}`);
//   }

//   const requestPayload = {
//     type: 1,
//     channel,
//     currency: "GHS",
//     payer,
//     amount: Number(Number(amount).toFixed(2)),
//     externalref: transactionId,
//     otpcode: "",
//     reference: `DIDWAPA DATA ${dataPackage}`,
//     accountnumber: ARKESEL_ADMIN_MOOLRE.wallet,
//   };

//   console.log("📤 ARKESEL → MOOLRE PAYMENT REQUEST:", {
//     ...requestPayload,
//     apiUser: ARKESEL_ADMIN_MOOLRE.user,
//     pubkey: "[HIDDEN]",
//   });

//   const response = await axios.post(
//     ARKESEL_ADMIN_MOOLRE.url,
//     requestPayload,
//     {
//       headers: {
//         Accept: "application/json",
//         "Content-Type": "application/json",
//         "X-API-USER": ARKESEL_ADMIN_MOOLRE.user,
//         "X-API-PUBKEY": ARKESEL_ADMIN_MOOLRE.pubkey,
//       },
//       timeout: 30000,
//       validateStatus: () => true,
//     }
//   );

//   const responseData = response.data || {};

//   console.log("📥 ARKESEL → MOOLRE RAW RESPONSE:", {
//     httpStatus: response.status,
//     data: responseData,
//   });

//   const status = Number(responseData.status);
//   const code = String(responseData.code || "").trim();
//   const message = String(
//     responseData.message ||
//     responseData.reason ||
//     ""
//   ).trim();

//   /*
//    * Moolre can return status=1 with codes such as TP14
//    * when the payment approval request has been initiated.
//    */
//   const accepted =
//     response.status >= 200 &&
//     response.status < 300 &&
//     (
//       status === 1 ||
//       code === "TP14" ||
//       code === "00" ||
//       code === "000"
//     );

//   if (!accepted) {
//     throw new Error(
//       `Moolre rejected payment. HTTP=${response.status}, status=${status}, code=${code}, message=${message}`
//     );
//   }

//   return {
//     accepted: true,
//     status,
//     code,
//     message,
//     raw: responseData,
//   };
// }

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


// Check whether a caller is allowed to use a locked vendor code
async function checkVendorTelephoneAccess(
  vendorId,
  vendorNumberLock,
  msisdn
) {
  // Lock is OFF: allow every number without checking the table
  if (Number(vendorNumberLock) !== 1) {
    console.log("🔓 Vendor number lock is OFF:", {
      vendorId,
      msisdn,
    });

    return true;
  }

  // Lock is ON: check this caller under this particular vendor
  const [intl, local, plusIntl] = msisdnVariants(msisdn);

  console.log("🔒 Checking locked vendor telephone access:", {
    vendorId,
    receivedMsisdn: msisdn,
    intl,
    local,
    plusIntl,
  });

  const [rows] = await dbp.query(
    `SELECT id
     FROM vendor_telephone_numbers
     WHERE vendor_id = ?
       AND telephone IN (?, ?, ?)
     LIMIT 1`,
    [vendorId, intl, local, plusIntl]
  );

  const allowed = Boolean(rows && rows.length);

  console.log("🔍 Vendor telephone access result:", {
    vendorId,
    msisdn,
    allowed,
  });

  return allowed;
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


// ======================================================
// NALO SOLUTIONS RESPONSE ADAPTER
//
// The shared handleSession() function returns:
// {
//   message: "...",
//   reply: true/false
// }
//
// NALO expects:
// {
//   USERID: "...",
//   MSISDN: "...",
//   USERDATA: "...",
//   MSG: "...",
//   MSGTYPE: true/false
// }
//
// MSGTYPE true  = continue the USSD session
// MSGTYPE false = terminate the USSD session
// ======================================================
function createNaloResponseAdapter(
  res,
  userID,
  msisdn,
  userData
) {
  return {
    json(data) {
      const rawMessage = String(data?.message || "");

      const cleanMessage = rawMessage
        .replace(/^CON\s*/i, "")
        .replace(/^END\s*/i, "")
        .trim();

      const shouldContinue = data?.reply !== false;

      console.log("📤 NALO USSD RESPONSE:", {
        USERID: String(userID || ""),
        MSISDN: String(msisdn || ""),
        USERDATA: String(userData || ""),
        MSG: cleanMessage,
        MSGTYPE: shouldContinue,
      });

      return res.status(200).json({
        USERID: String(userID || ""),
        MSISDN: String(msisdn || ""),
        USERDATA: String(userData || ""),
        MSG: cleanMessage,
        MSGTYPE: shouldContinue,
      });
    },
  };
}


// NALO normally sends the value entered by the user in USERDATA.
// This helper also supports accumulated values separated by *.
function getNaloLatestInput(userData, isNewSession) {
  const value = String(userData || "").trim();

  // Ignore USERDATA on the first request because it may contain
  // the dialled USSD code instead of a menu answer.
  if (isNewSession) {
    return "";
  }

  if (!value) {
    return "";
  }

  const cleaned = value
    .replace(/^#+|#+$/g, "")
    .trim();

  const parts = cleaned
    .split("*")
    .map((item) => item.trim())
    .filter(Boolean);

  return parts.length
    ? parts[parts.length - 1]
    : cleaned;
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
          `${brand}.\n0. Cancel\n\n1. Recharge\n2. Contact Us`
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
            return end("Contact us:\n0507946712");
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


// ======================================================
// PAYMENT PROVIDER ROUTING
//
// ALL USSD PAYMENTS USE BULKCLIX
// FROG admin *800*789# uses VENDOR_BULKCLIX
// Moolre plain/admin sessions use ADMIN_BULKCLIX
// Vendor sessions use VENDOR_BULKCLIX
// UZO admin 87 uses UZO_ADMIN_87_BULKCLIX
// ======================================================


// ======================================================
// ARKESEL PAYMENT THROUGH MOOLRE ONLY
// ======================================================
// ======================================================
// ARKESEL *928*145# USES MOOLRE ONLY
// ======================================================
// if (state.isArkeselAdmin145 === true) {
//   console.log("🟪 ARKESEL PAYMENT ROUTE SELECTED:", {
//     transactionId,
//     network,
//     momo_number,
//     amount,
//     data_package,
//     wallet: ARKESEL_ADMIN_MOOLRE.wallet,
//   });

//   sendArkeselMoolrePayment({
//     amount,
//     network,
//     momoNumber: momo_number,
//     transactionId,
//     dataPackage: data_package,
//   })
//     .then((result) => {
//       console.log(
//         "✅ ARKESEL MOOLRE PAYMENT ACCEPTED:",
//         result
//       );
//     })
//     .catch(async (error) => {
//       console.error(
//         "❌ ARKESEL MOOLRE PAYMENT FAILED:",
//         error.response?.data ||
//         error.message ||
//         error
//       );

//       // Remove the unused temporary order when payment initiation fails
//       try {
//         await dbp.query(
//           `DELETE FROM moolre_temp_orders
//            WHERE externalref = ?`,
//           [transactionId]
//         );

//         console.log(
//           "🗑️ Failed Arkesel temp order removed:",
//           transactionId
//         );
//       } catch (deleteError) {
//         console.error(
//           "❌ Could not remove failed Arkesel temp order:",
//           deleteError.message
//         );
//       }
//     });

//   return;
// }


// ======================================================
// ALL USSD CODES USE BULKCLIX
// ======================================================
const bulkNetwork = getBulkClixNetwork(network);

if (!bulkNetwork) {
  console.error(
    "❌ Unsupported network for BulkClix:",
    network
  );

  return;
}

const bulkClixAccount = getBulkClixAccount(state);

const paymentBrand = "SANDYPAY";

const bulkPayload = {
  amount: Number(amount.toFixed(2)),
  phone_number: toLocalMsisdn(momo_number),
  network: bulkNetwork,
  transaction_id: transactionId,

  callback_url:
    "https://sandipay.co/api/moolre/bulkclix-webhook",

  reference: `${paymentBrand} ${data_package}`,
};

console.log(
  "📤 Sending USSD payment to BULKCLIX:",
  bulkPayload
);

axios
  .post(
    bulkClixAccount.url,
    bulkPayload,
    {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": bulkClixAccount.apiKey,
      },

      timeout: 30000,
    }
  )
  .then((response) => {
    console.log(
      "✅ BULKCLIX payment INIT response:",
      response.data
    );
  })
  .catch((err) => {
    console.error(
      "❌ BULKCLIX payment error:",
      err.response?.data || err.message
    );
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

if (!ext) {
  console.log("❌ Missing Moolre extension:", extension);

  return res.json({
    message: "END Invalid USSD entry point",
    reply: false,
  });
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

// ======================================================
// NEW MOOLRE VENDOR SESSION
//
// DEFAULT VENDOR CODE:
// *203*444*VENDOR_ID#
//
// CUSTOM MOOLRE CODE:
// *203*CUSTOM_EXTENSION#
// Example: *203*222#
//
// UZO is handled separately inside router.post("/uzo")
// ======================================================
if (isNewSessionInner) {
  // 888 is admin-only.
  // 444 is shared:
  //   *203*444#    = admin
  //   *203*444*ID# = vendor
  if (ADMIN_EXTENSIONS.includes(ext) && ext !== USER_EXTENSION) {
    return res.json({
      message: "END Invalid vendor entry point",
      reply: false,
    });
  }

  console.log("🟨 NEW MOOLRE VENDOR SESSION:", {
    extension: ext,
    firstInput: inputInner,
    msisdn,
    sessionId,
  });

  (async () => {
    let vendorId = null;
    let brandName = "SandyPay";
    let vendorRow = null;
    let extensionMode = "";
    let assignedCode = null;

    // ==================================================
// METHOD 1: DEFAULT EXTENSION 444
// Dial format: *203*444*VENDOR_ID#
    // ==================================================
    if (ext === USER_EXTENSION) {
      const rawVendorId = String(inputInner || "").trim();

      const vendorIdFromDial = parseInt(
        rawVendorId.replace(/\D/g, ""),
        10
      );

      if (
        !Number.isInteger(vendorIdFromDial) ||
        vendorIdFromDial <= 0
      ) {
        console.log(
          "❌ Default extension 444 received without valid vendor ID:",
          inputInner
        );

        return res.json({
          message: "APPLICATION UNKNOWN.",
          reply: false,
        });
      }

      vendorId = vendorIdFromDial;
      extensionMode = "default";

      const [vendorRows] = await dbp.query(
  `SELECT
     id,
     username,
     ussd_locked,
     vendor_number_lock
   FROM users
   WHERE id = ?
     AND role = 'vendor'
   LIMIT 1`,
  [vendorId]
);

      if (!vendorRows || !vendorRows.length) {
        console.log(
          "❌ Default Moolre vendor ID not found:",
          vendorId
        );

        return res.json({
          message: "APPLICATION UNKNOWN.",
          reply: false,
        });
      }

      vendorRow = vendorRows[0];
      brandName = vendorRow.username || "SandyPay";

      // Check whether admin has already assigned this vendor
      // a custom Moolre code.
      const [customRows] = await dbp.query(
        `SELECT code
         FROM uzo_vendor_codes
         WHERE vendor_id = ?
           AND LOWER(TRIM(code_type)) = 'moolre'
           AND LOWER(TRIM(status)) = 'active'
           AND (
             expiry_date IS NULL
             OR DATE(expiry_date) >= CURDATE()
           )
         LIMIT 1`,
        [vendorId]
      );

      if (customRows && customRows.length) {
        console.log(
          "❌ Vendor already has a custom Moolre extension:",
          {
            vendorId,
            customCode: customRows[0].code,
          }
        );

        return res.json({
          message: "APPLICATION UNKNOWN.",
          reply: false,
        });
      }

      console.log("✅ Default Moolre vendor resolved:", {
        vendorId,
        extension: USER_EXTENSION,
      });
    }

    // ==================================================
    // METHOD 2: CUSTOM MOOLRE EXTENSION
    // Dial format: *203*CUSTOM_EXTENSION#
    // Example: *203*222#
    // ==================================================
    else {
      extensionMode = "custom";
      assignedCode = ext;

     const [codeRows] = await dbp.query(
  `SELECT
     uvc.vendor_id,
     uvc.code,
     uvc.code_type,
     uvc.status,
     uvc.expiry_date,
     u.username,
     u.ussd_locked,
     u.vendor_number_lock
   FROM uzo_vendor_codes uvc
   JOIN users u
     ON u.id = uvc.vendor_id
   WHERE uvc.code = ?
     AND LOWER(TRIM(uvc.code_type)) = 'moolre'
     AND LOWER(TRIM(uvc.status)) = 'active'
     AND (
       uvc.expiry_date IS NULL
       OR DATE(uvc.expiry_date) >= CURDATE()
     )
     AND u.role = 'vendor'
   LIMIT 1`,
  [ext]
);

      if (!codeRows || !codeRows.length) {
        console.log(
          "❌ Custom Moolre extension not found:",
          ext
        );

        return res.json({
          message: "APPLICATION UNKNOWN.",
          reply: false,
        });
      }

      vendorRow = codeRows[0];
      vendorId = Number(vendorRow.vendor_id);
      brandName = vendorRow.username || "SandyPay";

      console.log("✅ Custom Moolre vendor resolved:", {
        extension: ext,
        vendorId,
      });
    }

    // ==================================================
    // VENDOR LOCK CHECK
    // ==================================================
    if (Number(vendorRow.ussd_locked) === 1) {
      console.log("❌ Vendor account is locked:", vendorId);

      return res.json({
        message:
          "This vendor account has been locked. Please contact admin for support.",
        reply: false,
      });
    }



    // ==================================================
// VENDOR TELEPHONE NUMBER LOCK CHECK
// Applies only to Moolre vendor codes:
// 1. *203*444*VENDOR_ID#
// 2. *203*CUSTOM_EXTENSION#
// ==================================================
const telephoneAllowed = await checkVendorTelephoneAccess(
  vendorId,
  vendorRow.vendor_number_lock,
  msisdn
);

if (!telephoneAllowed) {
  console.log(
    "❌ Caller not found in vendor_telephone_numbers:",
    {
      vendorId,
      msisdn,
      extensionMode,
      extension: ext,
    }
  );

  return res.json({
    message: "APPLICATION UNKNOWN",
    reply: false,
  });
}

    // ==================================================
    // HIT CHECK
    // ==================================================
    const remaining = await getRemainingHits(vendorId);

    console.log(
      "📊 Remaining hits for Moolre vendor",
      vendorId,
      "=",
      remaining
    );

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

    // ==================================================
    // CREATE MOOLRE VENDOR SESSION
    // ==================================================
    sessions[sessionId] = {
      step: "start",
      vendorId,
      brandName,
      isPlain: false,

      ussdProvider: "moolre",
      extensionMode,

      vendorCode:
        extensionMode === "default"
          ? USER_EXTENSION
          : assignedCode,

      network: "",
      selectedPkg: "",
      recipient: "",
      packageList: [],
      packagePage: 0,
      moolreSessionId: sessionId,
    };

    console.log(
      "🟩 CREATED MOOLRE VENDOR SESSION:",
      sessions[sessionId]
    );

    return handleSession(
      sessionId,
      "",
      String(msisdn || ""),
      res
    );
  })().catch((e) => {
    console.error("❌ Moolre vendor session error:", e);

    return res.json({
      message:
        "END Service temporarily unavailable. Please try again later.",
      reply: false,
    });
  });

  return;
}

    // Existing session – continue
    return handleSession(sessionId, inputInner, String(msisdn || ""), res);
  });
});

////////////////////////////////////////////////////////////////////////////////////////////
// ======================================================
// FROG / WIGAL SMART USSD V1
//
// USSD CODE:
// *800*789#
//
// CALLBACK URL:
// https://sandipay.co/api/moolre/frog
//
// METHOD:
// GET
//
// FROG sends:
// network
// mode
// msisdn
// sessionid
// userdata
// username
// trafficid
// other
// ======================================================


// Converts the normal handleSession response into
// the pipe-separated response required by FROG.
function createPaystackResponseAdapter(res) {
  return {
    json(data) {

      const message = String(data?.message || "")
        .replace(/^CON\s*/i, "")
        .replace(/^END\s*/i, "")
        .trim();

      let type = "continue";

      if (data?.reply === false) {
        type = "end";
      }

      return res.status(200).json({
        message,
        type
      });
    }
  };
}


// ======================================================
// PAYSTACK USSD ROUTE
//
// CALLBACK URL:
// https://sandipay.co/api/moolre/paystack
//
// METHOD:
// POST
//
// PAYSTACK SENDS:
// session
// message
// phone
// network_code
// service_code
// ======================================================
// router.post("/paystack", async (req, res) => {
//   try {
//     console.log("📲 PAYSTACK USSD REQUEST:", req.body);

//     let payload = req.body || {};

//     // Support cases where the request arrives as text
//     if (typeof payload === "string") {
//       try {
//         payload = JSON.parse(payload);
//       } catch (parseError) {
//         console.error(
//           "❌ PAYSTACK JSON PARSE ERROR:",
//           parseError.message
//         );

//         return res.status(200).json({
//           message: "Invalid request.",
//           type: "end",
//         });
//       }
//     }

//     const session = String(payload.session || "").trim();
//     const message = String(payload.message || "").trim();
//     const phone = String(payload.phone || "").trim();
//     const networkCode = String(
//       payload.network_code || ""
//     )
//       .trim()
//       .toUpperCase();

//     const serviceCode = String(
//       payload.service_code || ""
//     ).trim();

//     console.log("✅ PARSED PAYSTACK REQUEST:", {
//       session,
//       message,
//       phone,
//       networkCode,
//       serviceCode,
//     });

//     // Validate required Paystack fields
//     if (!session || !phone) {
//       console.error("❌ Missing Paystack session or phone");

//       return res.status(200).json({
//         message: "Invalid USSD request.",
//         type: "end",
//       });
//     }

//     const paystackSessionKey = `PAYSTACK_${session}`;

//     // Converts the normal handleSession response to Paystack format
//     const paystackRes = createPaystackResponseAdapter(res);

//     const hasExistingSession = Boolean(
//       sessions[paystackSessionKey]
//     );

//     // Paystack sends an empty message on the first request
//     const isNewSession =
//       !hasExistingSession || message === "";

//     // ==================================================
//     // NEW PAYSTACK SESSION
//     // ==================================================
//     if (isNewSession && !hasExistingSession) {
//       sessions[paystackSessionKey] = {
//         step: "start",

//         // Use AdminData packages
//         vendorId: 1,
//         isPlain: true,

//         // Identifies this as a Paystack session
//         isPaystack: true,
//         ussdProvider: "paystack",

//         brandName: "SandyPay",

//         serviceCode,
//         paystackNetworkCode: networkCode,

//         network: "",
//         selectedPkg: "",
//         recipient: "",
//         packageList: [],
//         packagePage: 0,
//       };

//       console.log("🟦 CREATED PAYSTACK ADMIN SESSION:", {
//         paystackSessionKey,
//         phone,
//         serviceCode,
//         networkCode,
//       });

//       return handleSession(
//         paystackSessionKey,
//         "",
//         phone,
//         paystackRes
//       );
//     }

//     // ==================================================
//     // CONTINUE EXISTING PAYSTACK SESSION
//     // ==================================================

//     /*
//      * Paystack accumulates selections with an asterisk.
//      *
//      * Examples:
//      * 1
//      * 1*2
//      * 1*2*3
//      *
//      * We only send the latest answer to handleSession().
//      */
//     const messageParts = message
//       .split("*")
//       .map((value) => value.trim())
//       .filter(Boolean);

//     const latestInput =
//       messageParts.length > 0
//         ? messageParts[messageParts.length - 1]
//         : "";

//     console.log("➡️ CONTINUING PAYSTACK SESSION:", {
//       paystackSessionKey,
//       fullMessage: message,
//       latestInput,
//       currentStep:
//         sessions[paystackSessionKey]?.step,
//     });

//     return handleSession(
//       paystackSessionKey,
//       latestInput,
//       phone,
//       paystackRes
//     );
//   } catch (error) {
//     console.error("❌ PAYSTACK USSD ROUTE ERROR:", error);

//     return res.status(200).json({
//       message:
//         "Service temporarily unavailable. Please try again later.",
//       type: "end",
//     });
//   }
// });










// ======================================================
// PAYSTACK USSD - KOPORTAL RESULTS CHECKER
//
// CALLBACK URL:
// https://yourdomain.com/paystack
//
// METHOD:
// POST
// ======================================================

router.post("/paystack", (req, res) => {

  console.log("📲 PAYSTACK REQUEST:", req.body);

  const {
    session,
    message,
    phone,
    network_code,
    service_code
  } = req.body;

  // First request
  if (!message || message.trim() === "") {

    return res.json({
      message:
        "Welcome to KOPORTAL\n" +
        "Buy your Results Checker\n\n" +
        "1. Buy Results Checker\n" +
        "2. Help",
      type: "continue"
    });

  }

  // User selected 1
  if (message === "1") {

    return res.json({
      message:
        "Choose Checker\n" +
        "1. BECE Checker - GHS 15\n" +
        "2. WASSCE Checker - GHS 20",
      type: "continue"
    });

  }

  // User selected BECE
  if (message === "1*1") {

    return res.json({
      message:
        "You selected BECE Checker\nConfirm Purchase?",
      type: "continue"
    });

  }

  // User selected WASSCE
  if (message === "1*2") {

    return res.json({
      message:
        "You selected WASSCE Checker\nConfirm Purchase?",
      type: "continue"
    });

  }

  // Confirm BECE payment
  if (message === "1*1*1") {

    return res.json({
      message: "Processing payment...",
      type: "charge",
      data: {
        amount: 15
      }
    });

  }

  // Confirm WASSCE payment
  if (message === "1*2*1") {

    return res.json({
      message: "Processing payment...",
      type: "charge",
      data: {
        amount: 20
      }
    });

  }

  // Help
  if (message === "2") {

    return res.json({
      message:
        "Call 024XXXXXXX for assistance.",
      type: "end"
    });

  }

  return res.json({
    message: "Invalid option.",
    type: "end"
  });

});





/////////////////////////////////////////////////////////////////////////////////////////////////

/////////////////////////////////////////////////////////////////////////////////////////////////

// ======================================================
// UZO USSD ROUTE
//
// SUPPORTED:
//
// *920*142#
//   FASTUPPAGE PAYMENT CODE
//
// *426*87#
//   ADMIN DATA CODE
//
// *426*XXXX#
//   PRIVATE VENDOR UZO CODES
// ======================================================

router.post("/uzo", (req, res) => {
  console.log(
    "📲 NEW UZO USSD REQUEST:",
    req.body
  );

  let payload = {};

  try {
    payload =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;
  } catch (error) {
    console.error(
      "❌ UZO JSON PARSE ERROR:",
      error.message
    );

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

  // ====================================================
  // SESSION ID
  // ====================================================

  const rawSessionId = String(
    sessionID ||
    sessionId ||
    ""
  ).trim();

  if (!rawSessionId) {
    return res.json({
      message: "Invalid session.",
      ussdServiceOp: 17,
    });
  }

  const uzoSessionKey =
    `UZO_${rawSessionId}`;

  // ====================================================
  // PARSE UZO CODE
  // ====================================================

  const fullUssd = String(
    ussdString || ""
  ).trim();

  const baseCode = String(
    code || ""
  ).trim();

  const parts = fullUssd
    .replace(/^#|#$/g, "")
    .split("*")
    .map((item) => item.trim())
    .filter(Boolean);

  const baseParts = baseCode
    .replace(/^#|#$/g, "")
    .split("*")
    .map((item) => item.trim())
    .filter(Boolean);

  const mainCode =
    parts[0] ||
    baseParts[0] ||
    "";

  const uzoCode =
    parts[1] ||
    baseParts[1] ||
    "";

  console.log(
    "🔍 UZO SESSION CHECK:",
    {
      uzoSessionKey,
      fullUssd,
      baseCode,
      mainCode,
      uzoCode,
      msisdn,
      ussdServiceOp,
    }
  );


  // ====================================================
  // STANDARD UZO RESPONSE ADAPTER
  // Used by your existing SandyPay handleSession()
  // ====================================================

  const uzoRes = {
    json: (data) => {
      const msg = String(
        data?.message || ""
      )
        .replace(/^CON\s*/i, "")
        .replace(/^END\s*/i, "")
        .trim();

      return res.json({
        message: msg,

        ussdServiceOp:
          data?.reply === false
            ? 17
            : 2,
      });
    },
  };


  // ##################################################################
  // ##################################################################
  //
  //               FASTUPPAGE *920*142#
  //
  // ##################################################################
  // ##################################################################

  const existingState =
    sessions[uzoSessionKey];


  // ====================================================
  // EXISTING FASTUPPAGE SESSION
  // ====================================================

  if (
    existingState &&
    existingState.isFastuppage142 === true
  ) {

    console.log(
      "🟪 EXISTING FASTUPPAGE SESSION:",
      {
        uzoSessionKey,
        step: existingState.step,
        fullUssd,
        msisdn,
      }
    );

    // UZO can send either:
    //
    // 20
    //
    // OR accumulated data such as:
    //
    // 920*142*20
    //
    // Get the final entered value.

    let latestInput = "";

    if (parts.length > 0) {
      latestInput =
        parts[parts.length - 1];
    }

    // If provider sends only entered amount
    if (
      parts.length === 1 &&
      parts[0] === "920"
    ) {
      latestInput = "";
    }

    latestInput =
      String(latestInput || "")
        .trim();


    // ==================================================
    // FASTUPPAGE STEP: ENTER AMOUNT
    // ==================================================

    if (
      existingState.step ===
      "fastuppage_amount"
    ) {

      // Remove anything that is not number/dot
      const cleanedAmount =
        latestInput.replace(
          /[^0-9.]/g,
          ""
        );

      const amount =
        Number(cleanedAmount);


      // ----------------------------------------------
      // Validate amount
      // ----------------------------------------------

      if (
        !Number.isFinite(amount) ||
        amount <= 0
      ) {

        return res.json({
          message:
            "Invalid amount.\n\n" +
            "Enter amount to purchase:",

          ussdServiceOp: 2,
        });
      }


      // Maximum safety limit.
      // You can change/remove this later if required.
      if (amount > 10000) {

        return res.json({
          message:
            "Amount is too high.\n\n" +
            "Enter another amount:",

          ussdServiceOp: 2,
        });
      }


      // Round to 2 decimal places
      const finalAmount =
        Number(amount.toFixed(2));


      existingState.amount =
        finalAmount;

      existingState.step =
        "fastuppage_processing";


      // Create unique BulkClix transaction ID
      const transactionId =
        `FASTUP${Date.now()}${Math.floor(
          Math.random() * 1000
        )}`.slice(0, 30);


      existingState.transactionId =
        transactionId;


      console.log(
        "💰 FASTUPPAGE AMOUNT RECEIVED:",
        {
          transactionId,
          amount: finalAmount,
          msisdn,
        }
      );


      // ------------------------------------------------
      // Close USSD session immediately.
      //
      // BulkClix MoMo prompt will appear separately.
      // ------------------------------------------------

      res.json({
        message:
          `GHS ${finalAmount.toFixed(2)} payment initiated.\n\n` +
          "Please wait for the MoMo prompt and enter your PIN to approve.",

        ussdServiceOp: 17,
      });


      // ------------------------------------------------
      // Initiate BulkClix payment AFTER sending USSD
      // response.
      // ------------------------------------------------

      sendFastuppageBulkClixPayment({
        amount: finalAmount,

        msisdn:
          String(msisdn || ""),

        transactionId,
      })
        .then((result) => {

          console.log(
            "✅ FASTUPPAGE BULKCLIX PAYMENT INITIATED:",
            {
              transactionId,
              amount: finalAmount,
              msisdn,
              result,
            }
          );

        })
        .catch((error) => {

          console.error(
            "❌ FASTUPPAGE BULKCLIX PAYMENT FAILED:",
            {
              transactionId,
              amount: finalAmount,
              msisdn,

              error:
                error.response?.data ||
                error.message ||
                error,
            }
          );

        });


      // Remove USSD state because session has ended.
      delete sessions[uzoSessionKey];

      return;
    }


    // Any unexpected existing Fastuppage state
    delete sessions[uzoSessionKey];

    return res.json({
      message:
        "Session ended. Please dial *920*142# again.",

      ussdServiceOp: 17,
    });
  }



  // ====================================================
  // NEW FASTUPPAGE SESSION
  //
  // USSD:
  // *920*142#
  // ====================================================

  if (
    mainCode === "920" &&
    uzoCode === "142"
  ) {

    console.log(
      "🟪 NEW FASTUPPAGE *920*142# SESSION:",
      {
        uzoSessionKey,
        msisdn,
      }
    );


    // Validate caller number
    const customerNumber =
      toLocalMsisdn(msisdn);


    if (
      !/^0\d{9}$/.test(
        customerNumber
      )
    ) {

      console.error(
        "❌ Invalid Fastuppage number:",
        {
          received: msisdn,
          converted: customerNumber,
        }
      );

      return res.json({
        message:
          "Invalid mobile number.",

        ussdServiceOp: 17,
      });
    }


    // Create independent Fastuppage session
    sessions[uzoSessionKey] = {

      step:
        "fastuppage_amount",

      isFastuppage142: true,

      ussdProvider: "uzo",

      mainCode: "920",

      uzoCode: "142",

      brandName:
        "Fastuppage",

      customerNumber,

      amount: null,

      transactionId: null,
    };


    console.log(
      "✅ CREATED FASTUPPAGE SESSION:",
      sessions[uzoSessionKey]
    );


    return res.json({
      message:
        "Welcome to Fastuppage\n\n" +
        "Enter amount to purchase:",

      ussdServiceOp: 2,
    });
  }



  // ##################################################################
  // ##################################################################
  //
  //                  EXISTING SANDYPAY UZO
  //
  // ##################################################################
  // ##################################################################


  // ====================================================
  // EXISTING NORMAL UZO SESSION
  // ====================================================

  if (sessions[uzoSessionKey]) {

    const lastInput =
      parts.length > 0
        ? parts[parts.length - 1]
        : String(
            ussdString || ""
          ).trim();


    // ----------------------------------------------
    // EXISTING *426*87# ADMIN SESSION
    // ----------------------------------------------

    if (
      sessions[uzoSessionKey]
        ?.isUzoAdmin87 === true
    ) {

      return handleSession(
        uzoSessionKey,

        lastInput || "",

        String(
          msisdn || ""
        ),

        uzoRes
      );
    }


    // ----------------------------------------------
    // EXISTING VENDOR UZO SESSION
    // ----------------------------------------------

    return checkAccess(
      msisdn,

      (allowed) => {

        if (!allowed) {

          return res.json({
            message:
              "Sorry, you don't have access.",

            ussdServiceOp: 17,
          });
        }


        return handleSession(
          uzoSessionKey,

          lastInput || "",

          String(
            msisdn || ""
          ),

          uzoRes
        );
      }
    );
  }



  // ====================================================
  // UZO ADMIN CODE
  //
  // *426*87#
  //
  // KEEP EXISTING BEHAVIOUR
  // ====================================================

  if (
    mainCode === "426" &&
    uzoCode === "87"
  ) {

    sessions[uzoSessionKey] = {

      step: "start",

      vendorId: 1,

      brandName:
        "SandyPay",

      isPlain: true,

      isUzoAdmin87: true,

      network: "",

      selectedPkg: "",

      recipient: "",

      packageList: [],

      packagePage: 0,

      moolreSessionId:
        uzoSessionKey,

      uzoCode: "87",
    };


    console.log(
      "🟦 CREATED UZO ADMIN 87 SESSION:",
      {
        uzoSessionKey,
        msisdn,
      }
    );


    return handleSession(
      uzoSessionKey,

      "",

      String(
        msisdn || ""
      ),

      uzoRes
    );
  }



  // ====================================================
  // NORMAL VENDOR UZO ENTRY VALIDATION
  //
  // Your vendor UZO codes remain under:
  //
  // *426*CODE#
  // ====================================================

  if (
    mainCode !== "426" ||
    !uzoCode
  ) {

    console.log(
      "❌ INVALID UZO ENTRY POINT:",
      {
        mainCode,
        uzoCode,
      }
    );

    return res.json({
      message:
        "Invalid USSD entry point.",

      ussdServiceOp: 17,
    });
  }



  // ====================================================
  // NEW PRIVATE VENDOR UZO SESSION
  // ====================================================

  checkAccess(
    msisdn,

    (allowed) => {

      if (!allowed) {

        return res.json({
          message:
            "Sorry, you don't have access.",

          ussdServiceOp: 17,
        });
      }


      console.log(
        "🟧 NEW UZO PRIVATE CODE SESSION:",
        {
          uzoCode,
          msisdn,
          uzoSessionKey,
        }
      );


      (async () => {

        // --------------------------------------------
        // Get vendor assigned to UZO code
        // --------------------------------------------

        const [codeRows] =
          await dbp.query(
            `
            SELECT
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

              AND LOWER(
                TRIM(uvc.code_type)
              ) = 'uzo'

              AND LOWER(
                TRIM(uvc.status)
              ) = 'active'

              AND (
                uvc.expiry_date IS NULL
                OR DATE(
                  uvc.expiry_date
                ) >= CURDATE()
              )

              AND u.role = 'vendor'

            LIMIT 1
            `,
            [uzoCode]
          );


        // --------------------------------------------
        // UZO CODE NOT FOUND
        // --------------------------------------------

        if (
          !codeRows ||
          !codeRows.length
        ) {

          console.log(
            "❌ Uzo code not mapped:",
            uzoCode
          );

          return res.json({
            message:
              "APPLICATION UNKNOWN.",

            ussdServiceOp: 17,
          });
        }


        // --------------------------------------------
        // VENDOR LOCK
        // --------------------------------------------

        if (
          Number(
            codeRows[0]
              .ussd_locked
          ) === 1
        ) {

          console.log(
            "❌ Uzo vendor locked:",
            codeRows[0]
              .vendor_id
          );

          return res.json({
            message:
              "This vendor account has been locked. Please contact admin for support.",

            ussdServiceOp: 17,
          });
        }


        const vendorId =
          codeRows[0]
            .vendor_id;


        const brandName =
          codeRows[0]
            .username ||
          "SandyPay";


        // --------------------------------------------
        // CHECK VENDOR HITS
        // --------------------------------------------

        const remaining =
          await getRemainingHits(
            vendorId
          );


        console.log(
          "📊 UZO Remaining hits:",
          {
            vendorId,
            remaining,
          }
        );


        if (remaining <= 0) {

          return res.json({
            message:
              "APPLICATION UNKNOWN.",

            ussdServiceOp: 17,
          });
        }


        // --------------------------------------------
        // CONSUME HIT
        // --------------------------------------------

        const ok =
          await consumeOneHit(
            vendorId
          );


        if (!ok) {

          return res.json({
            message:
              "Sorry, your session has finished.",

            ussdServiceOp: 17,
          });
        }


        // --------------------------------------------
        // UPDATE COUNTERS
        // --------------------------------------------

        await incrementUssdCounter(
          vendorId
        );


        await saveVendorCustomer(
          vendorId,
          msisdn,
          "uzo"
        );


        // --------------------------------------------
        // CREATE VENDOR SESSION
        // --------------------------------------------

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

          moolreSessionId:
            uzoSessionKey,

          uzoCode,
        };


        console.log(
          "🟩 CREATED UZO VENDOR SESSION:",
          sessions[
            uzoSessionKey
          ]
        );


        return handleSession(
          uzoSessionKey,

          "",

          String(
            msisdn || ""
          ),

          uzoRes
        );

      })().catch((error) => {

        console.error(
          "❌ UZO private code session error:",
          error
        );


        return res.json({
          message:
            "Service temporarily unavailable. Please try again later.",

          ussdServiceOp: 17,
        });
      });
    }
  );
});
/////////////////////////////////////////////////////////////////////////////////////////




//////////////////////////////////////////////////Me








// ======================================================
// FASTUPPAGE HELPERS
// ======================================================

// Detect Ghana mobile network from number.
// BulkClix requires a network when initiating MoMo payment.
function detectFastuppageNetwork(msisdn) {
  const local = toLocalMsisdn(msisdn);

  if (!/^0\d{9}$/.test(local)) {
    return null;
  }

  // First 3 digits e.g. 024, 054, 020
  const prefix = local.substring(0, 3);

  const MTN_PREFIXES = [
    "024",
    "025",
    "053",
    "054",
    "055",
    "059",
  ];

  const TELECEL_PREFIXES = [
    "020",
    "050",
  ];

  const AIRTELTIGO_PREFIXES = [
    "026",
    "027",
    "056",
    "057",
  ];

  if (MTN_PREFIXES.includes(prefix)) {
    return "MTN";
  }

  if (TELECEL_PREFIXES.includes(prefix)) {
    return "TELECEL";
  }

  if (AIRTELTIGO_PREFIXES.includes(prefix)) {
    return "AIRTELTIGO";
  }

  return null;
}


// ======================================================
// SEND FASTUPPAGE PAYMENT THROUGH BULKCLIX
// ======================================================

async function sendFastuppageBulkClixPayment({
  amount,
  msisdn,
  transactionId,
}) {
  const phoneNumber = toLocalMsisdn(msisdn);

  if (!/^0\d{9}$/.test(phoneNumber)) {
    throw new Error(
      `Invalid Fastuppage MoMo number: ${phoneNumber}`
    );
  }

  const network = detectFastuppageNetwork(phoneNumber);

  if (!network) {
    throw new Error(
      `Could not detect network for ${phoneNumber}`
    );
  }

  if (!FASTUPPAGE_BULKCLIX.apiKey) {
    throw new Error(
      "FASTUPPAGE_BULKCLIX_API_KEY is not configured."
    );
  }

  const payload = {
    amount: Number(Number(amount).toFixed(2)),

    phone_number: phoneNumber,

    network,

    transaction_id: transactionId,

    callback_url:
      "https://sandipay.co/api/moolre/fastuppage-bulkclix-webhook",

    reference: `FASTUPPAGE GHS ${Number(amount).toFixed(2)}`,
  };

  console.log("📤 FASTUPPAGE → BULKCLIX PAYMENT:", {
    ...payload,
    apiKey: "[HIDDEN]",
  });

  const response = await axios.post(
    FASTUPPAGE_BULKCLIX.url,
    payload,
    {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",

        "x-api-key":
          FASTUPPAGE_BULKCLIX.apiKey,
      },

      timeout: 30000,

      // We inspect BulkClix's response ourselves.
      validateStatus: () => true,
    }
  );

  console.log(
    "📥 FASTUPPAGE BULKCLIX RESPONSE:",
    {
      httpStatus: response.status,
      data: response.data,
    }
  );

  if (
    response.status < 200 ||
    response.status >= 300
  ) {
    throw new Error(
      `BulkClix payment failed. HTTP ${response.status}: ${
        JSON.stringify(response.data)
      }`
    );
  }

  return {
    success: true,
    response: response.data,
  };
}

//////////////////////////////////////////////////Me


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



///////////////////////////////////////////Me

// ======================================================
// FASTUPPAGE BULKCLIX WEBHOOK
//
// CALLBACK:
// https://sandipay.co/api/moolre/fastuppage-bulkclix-webhook
// ======================================================

router.post(
  "/fastuppage-bulkclix-webhook",
  async (req, res) => {

    try {

      console.log(
        "📩 FASTUPPAGE BULKCLIX WEBHOOK:",
        req.body
      );


      let body = req.body || {};


      if (
        typeof body === "string"
      ) {

        try {

          body =
            JSON.parse(body);

        } catch (error) {

          console.error(
            "❌ FASTUPPAGE WEBHOOK JSON ERROR:",
            error.message
          );

          return res
            .status(400)
            .send(
              "Invalid JSON"
            );
        }
      }


      const transactionId =
        String(
          body.transaction_id ||
          ""
        ).trim();


      const status =
        String(
          body.status ||
          ""
        )
          .trim()
          .toLowerCase();


      console.log(
        "💳 FASTUPPAGE PAYMENT STATUS:",
        {
          transactionId,
          status,
          phone:
            body.phone_number,

          amount:
            body.amount,

          extTransactionId:
            body.ext_transaction_id,
        }
      );


      // BulkClix should always have transaction id
      if (!transactionId) {

        return res
          .status(400)
          .send(
            "Missing transaction_id"
          );
      }


      // Make sure this is actually one of
      // our Fastuppage transactions.
      if (
        !transactionId.startsWith(
          "FASTUP"
        )
      ) {

        console.log(
          "⚠️ Non-Fastuppage transaction received:",
          transactionId
        );

        return res
          .status(200)
          .send("OK");
      }


      // ----------------------------------------------
      // SUCCESS
      // ----------------------------------------------

      if (
        status === "success"
      ) {

        console.log(
          "✅ FASTUPPAGE PAYMENT SUCCESS:",
          {
            transactionId,

            phone:
              body.phone_number,

            amount:
              body.amount,

            providerReference:
              body.ext_transaction_id,
          }
        );


        /*
         * Add anything you want to happen
         * after successful payment here.
         *
         * The customer's MoMo has already
         * been charged by BulkClix.
         */


        return res
          .status(200)
          .send("OK");
      }


      // ----------------------------------------------
      // FAILED / CANCELLED / OTHER STATUS
      // ----------------------------------------------

      console.log(
        "⚠️ FASTUPPAGE PAYMENT NOT SUCCESSFUL:",
        {
          transactionId,
          status,
        }
      );


      return res
        .status(200)
        .send("OK");

    } catch (error) {

      console.error(
        "❌ FASTUPPAGE BULKCLIX WEBHOOK ERROR:",
        error.response?.data ||
        error.message ||
        error
      );


      return res
        .status(500)
        .send(
          "Server error"
        );
    }
  }
);


////////////////////////////////////////////Me

module.exports = router;
