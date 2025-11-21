// shortcode/ussd.js  (ROUTER VERSION - THETELLER NOW)
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

// Your short code extension (still 717)
const EXTENSION_EXPECTED = "881";

// ========================================================
//          THETELLER CONFIG (REPLACES MOOLRE)
// ========================================================
const THETELLER = {
  endpoint: "https://prod.theteller.net/v1.1/transaction/process",

  // 👇 your new merchant ID from the screenshot (top-left)
  merchantId: process.env.THETELLER_MERCHANT_ID || "TTM-00009388",

  // 👇 Production API credentials from the right-hand side of the screenshot
  username: process.env.THETELLER_USERNAME || "louis66a20ac942e74",
  apiKey: process.env.THETELLER_API_KEY || "ZmVjZWZlZDc2MzA4OWU0YmZhOTk5MDBmMDAxNDhmOWY=",
};

// Build the Basic Auth token correctly: base64("username:apikey")
THETELLER.basicToken = Buffer.from(
  `${THETELLER.username}:${THETELLER.apiKey}`
).toString("base64");


// Map network to TheTeller r-switch
function getSwitchCode(net) {
  switch (String(net || "").toLowerCase()) {
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

// Format MSISDN for TheTeller (233XXXXXXXXX)
function formatMsisdnForTheTeller(number) {
  if (!number) return "";
  let msisdn = String(number).replace(/\D/g, "");

  if (msisdn.startsWith("233") && msisdn.length === 12) return msisdn;
  if (msisdn.startsWith("0") && msisdn.length === 10) {
    return "233" + msisdn.slice(1);
  }
  if (msisdn.length === 9 && !msisdn.startsWith("0")) {
    return "233" + msisdn;
  }
  return msisdn;
}

// ====== MIDDLEWARE (scoped to this router) ======
router.use(express.json({ type: "application/json" })); // for JSON
router.use(bodyParser.text({ type: "*/*" })); // gateway may send text/plain
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
          `${brand}.\nNB: The Data Is NOT INSTANT.\n It takes between 5min to 24hrs to deliver\n0. Cancel\n\n1. Buy Data\n2. Contact Us`
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
        const endIndex = Math.min(start + PAGE_SIZE, total);

        // 0 = "More" if there is another page, otherwise "Back"
        if (trimmed === "0") {
          if (endIndex < total) {
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

      // ================== CONFIRM (PAYMENT VIA THETELLER) ==================
      case "confirm": {
        const choice = (input || "").trim();

        if (choice === "1") {
          // ====== INITIATE PAYMENT VIA THETELLER (AND LOG ORDER) ======
          const m = String(state.selectedPkg || "").match(
            /@ GHS\s*(\d+(\.\d+)?)/i
          );
          const amount = m ? parseFloat(m[1]) : 0;
          if (!amount) return end("Invalid amount in package.");

          const network = (state.network || "").toLowerCase();
          const recipient_number = state.recipient;
          const momo_number = msisdn; // payer is the one dialing
          const vendor_id = state.vendorId;
          const data_package = String(state.selectedPkg || "").split(" @")[0];
          const mode = state.isPlain ? "plain" : "vendor";

          const transactionId = `TRX${Date.now()}`.slice(0, 30);
          const package_id = new Date()
            .toISOString()
            .slice(0, 16)
            .replace("T", " ");

          // Respond to user FIRST (USSD must end quickly)
          end(
            "✅ Please wait while the prompt loads...\nEnter your MoMo PIN to approve."
          );

          // Fire TheTeller + DB logging in the background
          (async () => {
            try {
              const rSwitch = getSwitchCode(network);
              if (!rSwitch) {
                console.error(
                  "❌ Unsupported network for TheTeller r-switch:",
                  network
                );
                return;
              }

              const formattedMoMo = formatMsisdnForTheTeller(momo_number);
              const amountFormatted = String(Math.round(amount * 100)).padStart(
                12,
                "0"
              );

              const payload = {
                amount: amountFormatted,
                processing_code: "000200",
                transaction_id: transactionId,
                desc: `USSD Data Purchase - ${data_package}`,
                merchant_id: THETELLER.merchantId,
                subscriber_number: formattedMoMo,
                "r-switch": rSwitch,
                redirect_url: "https://example.com/ussd-data-callback",
              };

              console.log("📤 Sending USSD data payment to TheTeller:", payload);

              const response = await axios.post(
                THETELLER.endpoint,
                payload,
                {
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Basic ${THETELLER.basicToken}`,
                    "Cache-Control": "no-cache",
                  },
                }
              );

              console.log("📥 TheTeller USSD response:", response.data);

              const status = String(response.data.status || "").toLowerCase();
              const code = response.data.code;

              if (
                !(status === "approved" || status === "successful" || code === "000")
              ) {
                console.error(
                  "❌ TheTeller USSD payment declined or pending:",
                  response.data
                );
                return;
              }

              // ✅ Payment accepted – now log orders (same logic as old webhook)

              if (mode === "plain") {
                // PLAIN MODE (*203*717#): vendor_id is 1
                db.query(
                  `INSERT INTO admin_orders
                     (vendor_id, recipient_number, data_package, amount, network, status, sent_at, package_id)
                   VALUES (?, ?, ?, ?, ?, 'pending', NOW(), ?)`,
                  [1, recipient_number, data_package, amount, network, package_id],
                  (err1) => {
                    if (err1) {
                      console.error(
                        "❌ Error inserting plain admin_order (TheTeller):",
                        err1
                      );
                    } else {
                      console.log("✅ Plain-mode admin_order logged (TheTeller).");
                    }

                    db.query(
                      `INSERT INTO total_revenue (vendor_id, source, amount, date_received)
                       VALUES (?, ?, ?, NOW())`,
                      [1, "AdminData USSD sale", amount],
                      (err2) => {
                        if (err2) {
                          console.error(
                            "❌ Error inserting plain total_revenue (TheTeller):",
                            err2
                          );
                        } else {
                          console.log(
                            "✅ Plain-mode revenue logged (TheTeller)."
                          );
                        }
                      }
                    );
                  }
                );
                return;
              }

              // VENDOR MODE (*203*717*ID#)
              db.query(
                `SELECT amount FROM admin_data_packages WHERE data_package = ? LIMIT 1`,
                [data_package],
                (err3, rows2) => {
                  if (err3 || !rows2 || !rows2.length) {
                    console.error(
                      "❌ admin_data_packages lookup error (TheTeller):",
                      err3 || "no rows"
                    );
                    return;
                  }

                  const baseAmount = parseFloat(rows2[0].amount); // admin cost
                  const revenueAmount = baseAmount;
                  const vendorAmount = parseFloat(
                    (amount - baseAmount).toFixed(2)
                  );

                  if (vendorAmount < 0) {
                    console.warn(
                      "⚠️ Vendor amount is negative. Check pricing.",
                      {
                        data_package,
                        amountPaid: amount,
                        baseAmount,
                      }
                    );
                  }

                  // admin_orders
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
                    ],
                    (err4) => {
                      if (err4) {
                        console.error(
                          "❌ Error inserting vendor admin_order (TheTeller):",
                          err4
                        );
                      } else {
                        console.log(
                          "✅ Vendor admin_order logged (TheTeller)."
                        );
                      }

                      // wallet_loads (vendor share)
                      db.query(
                        `INSERT INTO wallet_loads (vendor_id, momo, amount, date_loaded)
                         VALUES (?, ?, ?, NOW())`,
                        [vendor_id, momo_number, vendorAmount],
                        (err5) => {
                          if (err5) {
                            console.error(
                              "❌ Error inserting wallet_loads (TheTeller):",
                              err5
                            );
                          } else {
                            console.log(
                              "✅ Vendor wallet share logged (TheTeller)."
                            );
                          }

                          // total_revenue (admin base)
                          db.query(
                            `INSERT INTO total_revenue (vendor_id, source, amount, date_received)
                             VALUES (?, ?, ?, NOW())`,
                            [
                              vendor_id,
                              `Admin base for ${network} ${data_package}`,
                              revenueAmount,
                            ],
                            (err6) => {
                              if (err6) {
                                console.error(
                                  "❌ Error inserting vendor total_revenue (TheTeller):",
                                  err6
                                );
                              } else {
                                console.log(
                                  "✅ Vendor revenue logged (TheTeller)."
                                );
                              }
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            } catch (err) {
              console.error(
                "❌ TheTeller USSD payment error:",
                err.response?.data || err.message
              );
            }
          })();

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

// ====== USSD ROUTE ======
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
