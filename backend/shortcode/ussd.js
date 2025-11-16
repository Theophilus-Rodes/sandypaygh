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
    : { rejectUnauthorized: false }, // last-resort fallback (not recommended long-term)
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

// ✅ TheTeller config (NEW MERCHANT: Louis Acheamp Enterprise)
const THETELLER = {
  url: "https://prod.theteller.net/v1.1/transaction/process",
  merchant_id: "TTM-00009388",
  tokenBase64: Buffer.from(
    "louis66a20ac942e74:ZmVjZWZlZDc2MzA4OWU0YmZhOTk5MDBmMDAxNDhmOWY="
  ).toString("base64"),
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

const dbp = db.promise(); // 👈 for async/await helper queries

// ====== SESSION STATE ======
const sessions = {};

// ====== HELPERS ======
function getSwitchCode(network) {
  switch ((network || "").toLowerCase()) {
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

function normalizeMsisdn(msisdn) {
  const digits = String(msisdn || "").replace(/[^\d]/g, "");
  if (digits.startsWith("233")) return digits; // 233XXXXXXXXX
  if (digits.startsWith("0")) return "233" + digits.slice(1); // 0XXXXXXXXX -> 233XXXXXXXXX
  return digits;
}
function msisdnVariants(msisdn) {
  const intl = normalizeMsisdn(msisdn); // 233XXXXXXXXX
  const local = "0" + intl.slice(3); // 0XXXXXXXXX
  const plusIntl = "+" + intl; // +233XXXXXXXXX
  return [intl, local, plusIntl];
}

// Access control
function checkAccess(msisdn, cb) {
  db.query(
    "SELECT `value` AS v FROM app_settings WHERE setting='access_mode' LIMIT 1",
    (e, rows) => {
      if (e && e.errno === 1054) {
        // legacy single-column schema
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
        // 🔹 Plain code or no vendor ID → use default contact
        if (!state.vendorId || state.isPlain) {
          return end("Contact us:\n0559126985\nsupport@sandypaygh.com");
        }

        // 🔹 DIALLED WITH ID → use vendor's phone from users table
        db.query(
          "SELECT phone FROM users WHERE id = ? LIMIT 1",
          [state.vendorId],
          (err, rows) => {
            if (err) {
              console.error("❌ MySQL error (Contact vendor):", err);
              // fallback to default contact
              return end("Contact us:\n0559126985\nsupport@sandypaygh.com");
            }

            if (!rows || !rows.length || !rows[0].phone) {
              // if no phone set, also fallback
              return end("Contact us:\n0559126985\nsupport@sandypaygh.com");
            }

            const phone = rows[0].phone;
            // You can change the email part if you like – only phone is dynamic
            return end(`Contact us:\n${phone}`);
          }
        );
        return; // important: stop here, response will be sent in the callback
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

      // 🔹 Plain mode → AdminData table
      if (state.isPlain) {
        db.query(
          `SELECT package_name AS data_package, price AS amount
           FROM AdminData
           WHERE status='active'`,
          (err, rows) => {
            if (err) {
              console.error("❌ MySQL error (AdminData):", err);
              return end("Service temporarily unavailable. Try again later.");
            }
            if (!rows || !rows.length)
              return end("No data packages available.");

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

      // 🔹 Vendor mode → data_packages table
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
          state.packagePage = 0;
          state.step = "package";
          return reply(renderPackages(state));
        }
      );
      return;

    case "package":
      if (input === "0") {
        state.step = "network";
        return reply(
          "Choose network:\n1) MTN\n2) AirtelTigo\n3) Telecel"
        );
      }
      if (input === "#") {
        const totalPages = Math.ceil(state.packageList.length / 5);
        state.packagePage = (state.packagePage + 1) % Math.max(totalPages, 1);
        return reply(renderPackages(state));
      }
      {
        const index = parseInt(input, 10) - 1 + state.packagePage * 5;
        if (state.packageList[index]) {
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
        const m = state.selectedPkg.match(/@ GHS\s*(\d+(\.\d+)?)/);
        const amount = m ? parseFloat(m[1]) : 0;
        if (!amount) return end("Invalid amount in package.");

        const network = state.network.toLowerCase();
        const recipient_number = state.recipient;
        const momo_number = msisdn;
        const vendor_id = state.vendorId;
        const data_package = state.selectedPkg.split(" @")[0];
        const package_id = new Date()
          .toISOString()
          .slice(0, 16)
          .replace("T", " ");

        // Close USSD immediately, then fire payment + DB in background
        end(
          "✅ Please wait while the prompt loads...\nEnter your MoMo PIN to approve."
        );

        const rSwitch = getSwitchCode(network);
        if (!rSwitch) {
          console.error("❌ Unsupported network:", network);
          return;
        }

        const transactionId = `TRX${Date.now()}`.slice(0, 30); // max 30 chars
        const amountFormatted = String(Math.round(amount * 100)).padStart(
          12,
          "0"
        ); // pesewas padded
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
          redirect_url: "https://example.com/callback",
        };

        console.log("📤 Sending to TheTeller:", payload);

        axios
          .post(THETELLER.url, payload, {
            headers: {
              Authorization: `Basic ${THETELLER.tokenBase64}`,
              "Content-Type": "application/json",
            },
            timeout: 15000,
          })
          .then((response) => {
            console.log("🟩 THETELLER RAW RESPONSE:", response.data || {});
            const resp = response.data || {};
            const code = String(resp.code || "").toUpperCase();
            const statusText = String(resp.status || "").toLowerCase();

            const success =
              code.startsWith("000") ||
              statusText === "success" ||
              statusText === "approved";

            if (!success) {
              console.log("❌ THETELLER PAYMENT NOT APPROVED:", resp);
              return;
            }

            console.log("✅ THETELLER PAYMENT APPROVED.");

            // --- DB INSERTS (same logic as your previous MOOLRE success) ---
            // PLAIN (*203*717#)
            if (state.isPlain) {
              db.query(
                `INSERT INTO admin_orders
                   (vendor_id, recipient_number, data_package, amount, network, status, sent_at, package_id)
                 VALUES (?, ?, ?, ?, ?, 'pending', NOW(), ?)`,
                [1, recipient_number, data_package, amount, network, package_id]
              );

              db.query(
                `INSERT INTO total_revenue (vendor_id, source, amount, date_received)
                 VALUES (?, ?, ?, NOW())`,
                [1, "AdminData USSD sale", amount]
              );
            }
            // VENDOR MODE
            else {
              db.query(
                `SELECT amount FROM admin_data_packages WHERE data_package = ? LIMIT 1`,
                [data_package],
                (err, rows) => {
                  if (err || !rows || !rows.length) return;

                  const baseAmount = parseFloat(rows[0].amount);
                  const revenueAmount = baseAmount;
                  const vendorAmount = parseFloat(
                    (amount - baseAmount).toFixed(2)
                  );

                  db.query(
                    `INSERT INTO admin_orders
                       (vendor_id, recipient_number, data_package, amount, network, status, sent_at, package_id)
                     VALUES (?, ?, ?, ?, ?, 'pending', NOW(), ?)`,
                    [
                      vendor_id,
                      recipient_number,
                      data_package,
                      amount,
                      network,
                      package_id,
                    ]
                  );

                  db.query(
                    `INSERT INTO wallet_loads (vendor_id, momo, amount, date_loaded)
                     VALUES (?, ?, ?, NOW())`,
                    [vendor_id, momo_number, vendorAmount]
                  );

                  db.query(
                    `INSERT INTO total_revenue (vendor_id, source, amount, date_received)
                     VALUES (?, ?, ?, NOW())`,
                    [
                      vendor_id,
                      `Admin base for ${network} ${data_package}`,
                      revenueAmount,
                    ]
                  );
                }
              );
            }
          })
          .catch((err) => {
            console.error(
              "❌ THETELLER ERROR:",
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

  // 🔹 CASE 1: NEW PLAIN MODE SESSION → *203*717# (no ID)
  if (isNewSession && !inputFromUser) {
    console.log(
      "🟦 NEW PLAIN MODE SESSION DETECTED (*203*717#) for:",
      msisdn
    );

    // Check telephone_numbers table first
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

        // Allowed: create plain session
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
        };

        console.log(
          "🟦 CREATED PLAIN SESSION OBJECT:",
          sessions[sessionId]
        );

        // First screen – show welcome/menu
        return handleSession(sessionId, "", String(msisdn || ""), res);
      }
    );

    return; // important: don't fall through to vendor logic
  }

  // 🔹 All other cases (vendor ID mode & existing sessions)
  checkAccess(msisdn, (allowed) => {
    if (!allowed) {
      return res.json({
        message: "Sorry, you don't have access.",
        reply: false,
      });
    }

    const isNewSessionInner = isNew === true || !sessions[sessionId];
    const inputInner = inputFromUser;

    // 🔹 CASE 2: New vendor session → *203*717*ID#
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

        // ✅ 1. Check remaining hits
        const remaining = await getRemainingHits(vendorId);
        console.log("📊 Remaining hits for vendor", vendorId, "=", remaining);
        if (remaining <= 0) {
          return res.json({
            message: "APPLICATION UNKNOWN.",
            reply: false,
          });
        }

        // ✅ 2. Deduct exactly 1 hit
        const ok = await consumeOneHit(vendorId);
        if (!ok) {
          return res.json({
            message: "END Sorry, your session has finished.",
            reply: false,
          });
        }

        // ✅ 3. Increment USSD counter for dashboard
        await incrementUssdCounter(vendorId);

        // ✅ 4. Fetch vendor username for brand name
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
            };

            console.log(
              "🟩 CREATED SESSION OBJECT FOR ID MODE (WITH HIT DEDUCTION):",
              sessions[sessionId]
            );

            // First screen – ignore the ID as input, just show menu
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

    // 🔹 CASE 3: Existing session → continue as normal
    return handleSession(
      sessionId,
      inputInner,
      String(msisdn || ""),
      res
    );
  });
});

// --- HIT HELPERS ---

// Total remaining hits for a vendor (only 'completed' rows count)
async function getRemainingHits(vendorId) {
  const [rows] = await dbp.query(
    `SELECT COALESCE(SUM(CASE WHEN status='completed' THEN hits ELSE 0 END), 0) AS total_hits
     FROM session_purchases
     WHERE vendor_id = ?`,
    [vendorId]
  );
  return Number(rows?.[0]?.total_hits || 0);
}

// Deduct 1 hit from the most recent row with hits > 0
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
    `UPDATE session_purchases
       SET hits = ?
     WHERE id = ?`,
    [newHits, row.id]
  );
  return true;
}

// Increment visible USSD session counter for dashboard
async function incrementUssdCounter(vendorId) {
  await dbp.query(
    `INSERT INTO ussd_session_counters (vendor_id, hits_used)
     VALUES (?, 1)
     ON DUPLICATE KEY UPDATE hits_used = hits_used + 1`,
    [vendorId]
  );
}

module.exports = router;
