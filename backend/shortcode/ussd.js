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
const EXTENSION_EXPECTED = "717";

// ✅ Moolre config (from your account)
const MOOLRE = {
  url: "https://api.moolre.com/open/transact/payment",
  user: "acheamp", // Moolre username
  pubkey:
    "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyaWQiOjEwNjU0OSwiZXhwIjoxOTI1MDA5OTk5fQ.YNoLN19xWWZRyr2Gdy_2DexpGLZv4V9yATnyYSFef2M",
  wallet: "10654906056819", // GHS wallet number
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
  return `Confirm Purchase
Recipient: ${state.recipient}
Network: ${state.network}
Package: ${packageName}
Price: ${price}

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

  const reply = (msg) => res.json({ message: msg, reply: true });
  const end = (msg) => res.json({ message: msg, reply: false });

  switch (state.step) {
    case "start": {
      state.step = "menu";
      const brand = state.brandName || "SandyPay";
      return reply(
        `${brand}.\nNB: The Data Is NOT INSTANT.\n It takes between 5min to 24hrs to deliver\n0. Cancel\n\n1. Buy Data\n2. Contact Us`
      );
    }

    case "menu": {
      if (input === "1") {
        state.step = "network";
        return reply("Network\n1) MTN\n2) AirtelTigo\n3) Telecel\n0) Back");
      }

      if (input === "2") {
        if (!state.vendorId || state.isPlain) {
          return end("Contact us:\n0559126985\nsupport@sandypaygh.com");
        }

        db.query(
          "SELECT phone FROM users WHERE id = ? LIMIT 1",
          [state.vendorId],
          (err, rows) => {
            if (err) {
              console.error("❌ MySQL error (Contact vendor):", err);
              return end("Contact us:\n0559126985\nsupport@sandypaygh.com");
            }

            if (!rows || !rows.length || !rows[0].phone) {
              return end("Contact us:\n0559126985\nsupport@sandypaygh.com");
            }

            const phone = rows[0].phone;
            return end(`Contact us:\n${phone}`);
          }
        );
        return;
      }

      if (input === "0") {
        state.step = "start";
        return reply("Cancelled.\n1. Buy Data\n2. Contact Us");
      }

      return reply("Invalid option. Choose:\n1) Buy Data\n2) Contact Us");
    }

    case "network":
      if (input === "1") state.network = "MTN";
      else if (input === "2") state.network = "AirtelTigo";
      else if (input === "3") state.network = "Telecel";
      else if (input === "0") {
        state.step = "menu";
        return reply("Back to menu:\n1. Buy Data\n2. Contact Us");
      } else
        return reply(
          "Invalid network. Choose:\n1) MTN\n2) AirtelTigo\n3) Telecel"
        );

      // PLAIN MODE → AdminData
  if (state.isPlain) {
  db.query(
    `SELECT 
        package_name AS data_package, 
        price AS amount,
        network
     FROM AdminData
     WHERE status = 'active' AND network = ?
     ORDER BY FIELD(network, 'mtn', 'airteltigo', 'telecel'), id DESC`,
    [state.network],   // <-- filter by selected network
    (err, rows) => {
      if (err) {
        console.error("❌ MySQL error (AdminData):", err);
        return end("Service temporarily unavailable. Try again later.");
      }

      if (!rows || !rows.length) {
        return end("No data packages available for this network.");
      }

      // Format packages: "1GB @ GHS6"
      state.packageList = rows.map(
        (r) => `${r.data_package} @ GHS${r.amount}`
      );

      state.packagePage = 0;
      state.step = "package";
      return reply(renderPackages(state));
    }
  );


        return;
      }

      // VENDOR MODE → data_packages
      db.query(
  `SELECT data_package, amount
   FROM data_packages
   WHERE vendor_id = ? AND network = ? AND status = 'available'`,
  [state.vendorId, state.network],
  (err, rows) => {
    if (err) {
      console.error("❌ MySQL error:", err);
      return end("Service temporarily unavailable. Try again later.");
    }
    if (!rows || !rows.length) return end("No data packages available.");

    state.packageList = rows.map(
      (r) => `${r.data_package} @ GHS${r.amount}`
    );
    state.packagePage = 0;          // ✅ always start at page 0
    state.step = "package";
    return reply(renderPackages(state));
  }
);
return;

// ================== PACKAGE STEP ==================
case "package":
  if (input === "0") {
    state.step = "network";
    return reply("Choose network:\n1) MTN\n2) AirtelTigo\n3) Telecel");
  }

  if (input === "#") {
    // ✅ make sure packageList exists
    if (!state.packageList || !state.packageList.length) {
      return end("No data packages available.");
    }

    const totalPages = Math.ceil(state.packageList.length / 5);
    const safeCurrentPage =
      Number.isInteger(state.packagePage) && state.packagePage >= 0
        ? state.packagePage
        : 0;

    state.packagePage =
      (safeCurrentPage + 1) % Math.max(totalPages, 1);

    return reply(renderPackages(state));
  }

  // normal numeric selection
  {
    const page = Number.isInteger(state.packagePage) && state.packagePage >= 0
      ? state.packagePage
      : 0;

    const index = parseInt(input, 10) - 1 + page * 5;

    if (state.packageList && state.packageList[index]) {
      state.selectedPkg = state.packageList[index];
      state.step = "recipient";
      return reply(
        "Recipient\n1) Buy for self\n2) Buy for others\n0) Back"
      );
    }

    return reply(
      "Invalid selection. Choose a valid number or type # for more."
    );
  }

// ================== RECIPIENT STEP ==================
case "recipient":
  if (input === "1") {
    state.recipient = msisdn;
    state.step = "confirm";
    return reply(confirmMessage(state));
  }
  if (input === "2") {
    state.step = "other_number";
    return reply("Enter recipient number:");
  }
  if (input === "0") {
    state.step = "package";
    return reply(renderPackages(state));
  }
  return reply(
    "Invalid option. Choose:\n1) Buy for self\n2) Buy for others\n0) Back"
  );


    case "other_number":
      state.recipient = input;
      state.step = "confirm";
      return reply(confirmMessage(state));

    case "confirm":
      if (input === "1") {
        // ====== INITIATE PAYMENT VIA MOOLRE (NO DB INSERT HERE) ======
        const m = state.selectedPkg.match(/@ GHS\s*(\d+(\.\d+)?)/);
        const amount = m ? parseFloat(m[1]) : 0;
        if (!amount) return end("Invalid amount in package.");

        const network = state.network.toLowerCase();
        const recipient_number = state.recipient;
        const momo_number = msisdn;
        const vendor_id = state.vendorId;
        const data_package = state.selectedPkg.split(" @")[0];

        const transactionId = `TRX${Date.now()}`.slice(0, 30);

        // Close USSD first
        end(
          "✅ Please wait while the prompt loads...\nEnter your MoMo PIN to approve."
        );

        const channelId = getChannelId(network);
        if (!channelId) {
          console.error("❌ Unsupported network for Moolre channel:", network);
          return;
        }

        const payerLocal = toLocalMsisdn(momo_number);

        const payload = {
          type: 1,
          channel: channelId,
          currency: "GHS",
          payer: payerLocal,
          amount: Number(amount.toFixed(2)),
          externalref: transactionId,
          reference: `Purchase of ${data_package}`,
          accountnumber: MOOLRE.wallet,
          sessionid: state.moolreSessionId,

          // 🔹 This goes back in webhook as "thirdpartyref"
          thirdpartyref: JSON.stringify({
            mode: state.isPlain ? "plain" : "vendor",
            vendor_id,
            data_package,
            network,
            recipient_number,
            momo_number,
          }),
        };

        console.log("🟡 Using Moolre auth:", {
          user: MOOLRE.user,
          pubkeyStart: MOOLRE.pubkey.slice(0, 20) + "...",
          wallet: MOOLRE.wallet,
        });
        console.log("📤 Sending to MOOLRE:", payload);

        axios
          .post(MOOLRE.url, payload, {
            headers: {
              "Content-Type": "application/json",
              "X-API-USER": MOOLRE.user,
              "X-API-PUBKEY": MOOLRE.pubkey,
            },
          })
          .then((response) => {
            const resp = response.data || {};
            console.log("✅ MOOLRE payment INIT response:", resp);
            console.log(
              "⏳ Payment request sent. Waiting for webhook (txstatus=1) to log the order."
            );
          })
          .catch((err) => {
            console.error(
              "❌ MOOLRE error:",
              err.response?.data || err.message
            );
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
  if (String(extension || "") !== EXTENSION_EXPECTED) {
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
  if (isNewSession && !inputFromUser) {
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
