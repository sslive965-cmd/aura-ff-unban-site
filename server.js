const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "20kb" }));

const sessions = new Map();
const loginAttempts = new Map();

const SESSION_TTL = 6 * 60 * 60 * 1000;

/* ---------------- COOKIES ---------------- */

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

/* ---------------- ADMIN SESSION ---------------- */

function signToken(token) {
  const secret = process.env.ADMIN_PASSWORD || "";

  return crypto
    .createHmac("sha256", secret)
    .update(token)
    .digest("hex");
}

function validAdminSession(req) {
  const cookie = parseCookies(req).aura_admin || "";
  const [token, signature] = cookie.split(".");

  if (!token || !signature) return false;

  const expected = signToken(token);

  if (signature.length !== expected.length) return false;

  const valid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );

  if (!valid) return false;

  const session = sessions.get(token);

  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }

  session.expiresAt = Date.now() + SESSION_TTL;

  return true;
}

function requireAdmin(req, res, next) {
  if (!validAdminSession(req)) {
    return res.status(401).json({
      error: "Admin authentication required."
    });
  }

  next();
}

function clientIp(req) {
  return String(
    req.ip ||
    req.headers["x-forwarded-for"] ||
    "unknown"
  )
    .split(",")[0]
    .trim();
}
async function sendTelegramNotification(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
  const chatId = process.env.TELEGRAM_CHAT_ID || "";

  if (!botToken || !chatId) {
    console.error("Telegram notification is not configured.");
    return;
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message
        })
      }
    );

    if (!response.ok) {
      console.error("Telegram notification failed:", await response.text());
    }
  } catch (error) {
    console.error("Telegram notification error:", error);
  }
}
/* ---------------- UID CHECK ---------------- */

app.get("/api/player", (req, res) => {
  const uid = String(req.query.uid || "").trim();
  const region = String(
    req.query.region || "ind"
  ).trim().toLowerCase();

  if (!/^\d{5,15}$/.test(uid)) {
    return res.status(400).json({
      error: "Enter a valid 5–15 digit Free Fire UID."
    });
  }

  if (!["ind", "sg", "br"].includes(region)) {
    return res.status(400).json({
      error: "Unsupported region."
    });
  }

  return res.json({
    uid,
    region: region.toUpperCase(),
    valid: true,
    message:
      "UID format is valid. Player details and ban status cannot be verified from this website."
  });
});

/* ---------------- PAYMENT START ---------------- */

app.post("/api/payment-start", async (req, res) => {
  const uid = String(req.body.uid || "").trim();
  const nickname = String(req.body.nickname || "").trim();
  const device = String(req.body.device || "").trim();
  const region = String(req.body.region || "").trim().toLowerCase();
  const banReason = String(req.body.banReason || "").trim();
  const idLevel = String(req.body.idLevel || "").trim();
  const contact = String(req.body.contact || "").trim();
  const evidence = String(req.body.evidence || "");

  if (!/^\d{5,15}$/.test(uid)) {
    return res.status(400).json({ error: "Invalid UID." });
  }

  if (!nickname || nickname.length > 100) {
    return res.status(400).json({ error: "Invalid nickname." });
  }

  if (!device || device.length > 100) {
    return res.status(400).json({ error: "Invalid device." });
  }

  if (!["ind", "sg", "br"].includes(region)) {
    return res.status(400).json({ error: "Unsupported region." });
  }

  if (!banReason || banReason.length > 1000) {
    return res.status(400).json({ error: "Please describe the ban reason." });
  }

  if (!idLevel || idLevel.length > 20) {
    return res.status(400).json({ error: "Invalid ID level." });
  }

  if (contact.length > 200) {
    return res.status(400).json({ error: "Contact information is too long." });
  }

  if (evidence && evidence.length > 1500000) {
    return res.status(400).json({
      error: "Screenshot is too large."
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL || "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({
      error: "Payment system is not configured."
    });
  }

  const verificationToken =
    crypto.randomBytes(32).toString("hex");

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/payment_verifications`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          uid,
          region,
          amount: 500,
          contact: contact || null,
          status: "pending",
          request_token: verificationToken,
          nickname: nickname || null,
          device: device || null,
          ban_reason: banReason || null,
          id_level: idLevel || null
        })
      }
    );

    if (!response.ok) {
      console.error(
        "Payment request insert failed:",
        await response.text()
      );

      return res.status(502).json({
        error: "Could not start the request."
      });
    }

    await sendTelegramNotification(
      `🔔 New AURA FF support request started\n\n` +
      `UID: ${uid}\n` +
      `Nickname: ${nickname}\n` +
      `Device: ${device}\n` +
      `Region: ${region.toUpperCase()}\n` +
      `ID Level: ${idLevel}\n` +
      `Status: Payment Pending\n\n` +
      `Customer has reached the ₹500 assistance payment step.`
    );

    return res.status(201).json({
      success: true,
      verificationToken
    });

  } catch (error) {
    console.error(
      "Payment start error:",
      error
    );

    return res.status(502).json({
      error: "Could not start the request."
    });
  }
});


/* ---------------- PAYMENT REQUEST ---------------- */

app.post("/api/payment-request", async (req, res) => {
  const verificationToken =
    String(req.body.verificationToken || "").trim();

  const paymentReference =
    String(req.body.paymentReference || "").trim();

  if (!verificationToken) {
    return res.status(400).json({
      error: "Invalid verification token."
    });
  }

  if (!paymentReference || paymentReference.length > 100) {
    return res.status(400).json({
      error: "Please enter a valid payment reference."
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL || "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({
      error: "Payment system is not configured."
    });
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/payment_verifications?verification_token=eq.${encodeURIComponent(verificationToken)}`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          payment_reference: paymentReference,
          status: "pending",
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!response.ok) {
      console.error(
        "Payment reference update failed:",
        await response.text()
      );

      return res.status(502).json({
        error: "Could not submit payment verification."
      });
    }

    const rows = await response.json();

    if (!rows.length) {
      return res.status(404).json({
        error: "Payment request not found."
      });
    }

    const request = rows[0];

    await sendTelegramNotification(
      `💳 Payment verification requested\n\n` +
      `UID: ${request.uid}\n` +
      `Region: ${String(request.region).toUpperCase()}\n` +
      `Amount: ₹${request.amount}\n` +
      `Payment Reference: ${paymentReference}\n\n` +
      `⚠️ Please manually verify the actual payment before approving.`
    );

    return res.json({
      success: true,
      status: "pending"
    });

  } catch (error) {
    console.error(
      "Payment verification request error:",
      error
    );

    return res.status(502).json({
      error: "Could not submit payment verification."
    });
  }
});


/* ---------------- PAYMENT STATUS ---------------- */

app.get("/api/payment-status", async (req, res) => {
  const token =
    String(req.query.token || "").trim();

  if (!token) {
    return res.status(400).json({
      error: "Missing verification token."
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL || "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({
      error: "Payment system is not configured."
    });
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/payment_verifications?verification_token=eq.${encodeURIComponent(token)}&select=status`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`
        }
      }
    );

    if (!response.ok) {
      return res.status(502).json({
        error: "Could not check payment status."
      });
    }

    const rows = await response.json();

    if (!rows.length) {
      return res.status(404).json({
        error: "Payment request not found."
      });
    }

    return res.json({
      status: rows[0].status
    });

  } catch (error) {
    console.error(
      "Payment status error:",
      error
    );

    return res.status(502).json({
      error: "Could not check payment status."
    });
  }
});


/* ---------------- FINAL SUPPORT REQUEST ---------------- */

app.post("/api/support-request", async (req, res) => {
  const verificationToken =
    String(req.body.verificationToken || "").trim();

  if (!verificationToken) {
    return res.status(400).json({
      error: "Payment verification is required."
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL || "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({
      error: "Support system is not configured."
    });
  }

  try {

    const paymentResponse = await fetch(
      `${supabaseUrl}/rest/v1/payment_verifications?verification_token=eq.${encodeURIComponent(verificationToken)}&select=*`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`
        }
      }
    );

    if (!paymentResponse.ok) {
      return res.status(502).json({
        error: "Could not verify payment status."
      });
    }

    const payments = await paymentResponse.json();

    if (!payments.length) {
      return res.status(404).json({
        error: "Payment request not found."
      });
    }

    const payment = payments[0];

    if (payment.status !== "verified") {
      return res.status(403).json({
        error: "Payment has not been verified by admin yet."
      });
    }

    const evidence =
      String(req.body.evidence || "");

    if (evidence && evidence.length > 1500000) {
      return res.status(400).json({
        error: "Screenshot is too large."
      });
    }

    const supportResponse = await fetch(
      `${supabaseUrl}/rest/v1/support_requests`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          uid: payment.uid,
          region: payment.region,
          issue: payment.ban_reason,
          contact: payment.contact || null,
          nickname: payment.nickname || null,
          device: payment.device || null,
          ban_reason: payment.ban_reason || null,
          id_level: payment.id_level || null,
          evidence_data: evidence || null,
          status: "pending"
        })
      }
    );

    if (!supportResponse.ok) {
      console.error(
        "Final support request failed:",
        await supportResponse.text()
      );

      return res.status(502).json({
        error: "Could not submit support request."
      });
    }

    const rows = await supportResponse.json();

    await sendTelegramNotification(
      `📨 Final AURA FF support request submitted\n\n` +
      `UID: ${payment.uid}\n` +
      `Region: ${String(payment.region).toUpperCase()}\n` +
      `Payment: Verified\n` +
      `Status: Support Request Pending`
    );

    return res.status(201).json({
      success: true,
      request: rows[0] || null
    });

  } catch (error) {
    console.error(
      "Final support request error:",
      error
    );

    return res.status(502).json({
      error: "Could not submit support request."
    });
  }
});


/* ---------------- ADMIN PAYMENT VERIFICATIONS ---------------- */

app.get(
  "/admin/api/payment-verifications",
  requireAdmin,
  async (_req, res) => {

    const supabaseUrl = process.env.SUPABASE_URL || "";
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    try {

      const response = await fetch(
        `${supabaseUrl}/rest/v1/payment_verifications?select=*&order=created_at.desc&limit=100`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`
          }
        }
      );

      if (!response.ok) {
        return res.status(502).json({
          error: "Could not load payment verifications."
        });
      }

      res.json({
        payments: await response.json()
      });

    } catch (error) {

      console.error(
        "Admin payment fetch error:",
        error
      );

      res.status(502).json({
        error: "Could not load payment verifications."
      });
    }
  }
);


/* ---------------- ADMIN VERIFY / REJECT PAYMENT ---------------- */

app.patch(
  "/admin/api/payment-verifications/:id",
  requireAdmin,
  async (req, res) => {

    const id = String(req.params.id || "");
    const status = String(req.body.status || "");

    if (
      !/^\d+$/.test(id) ||
      !["verified", "rejected"].includes(status)
    ) {
      return res.status(400).json({
        error: "Invalid payment update."
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL || "";
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    try {

      const response = await fetch(
        `${supabaseUrl}/rest/v1/payment_verifications?id=eq.${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            Prefer: "return=representation"
          },
          body: JSON.stringify({
            status,
            updated_at: new Date().toISOString()
          })
        }
      );

      if (!response.ok) {
        return res.status(502).json({
          error: "Could not update payment status."
        });
      }

      const rows = await response.json();

      return res.json({
        success: true,
        payment: rows[0] || null
      });

    } catch (error) {

      console.error(
        "Admin payment update error:",
        error
      );

      return res.status(502).json({
        error: "Could not update payment status."
      });
    }
  }
);

/* ---------------- ADMIN LOGIN ---------------- */

app.post("/admin/login", (req, res) => {
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");

  const adminUsername =
    process.env.ADMIN_USERNAME || "";

  const adminPassword =
    process.env.ADMIN_PASSWORD || "";

  const ip = clientIp(req);
  const now = Date.now();

  const attempt =
    loginAttempts.get(ip) || {
      count: 0,
      resetAt: now + 15 * 60 * 1000
    };

  if (attempt.resetAt <= now) {
    attempt.count = 0;
    attempt.resetAt =
      now + 15 * 60 * 1000;
  }

  if (attempt.count >= 8) {
    return res.status(429).json({
      error:
        "Too many login attempts. Try again later."
    });
  }

  if (!adminUsername || !adminPassword) {
    return res.status(503).json({
      error:
        "Admin credentials are not configured."
    });
  }

  if (
    username !== adminUsername ||
    password !== adminPassword
  ) {
    attempt.count += 1;
    loginAttempts.set(ip, attempt);

    return res.status(401).json({
      error: "Invalid admin credentials."
    });
  }

  loginAttempts.delete(ip);

  const token = crypto
    .randomBytes(32)
    .toString("hex");

  sessions.set(token, {
    expiresAt: now + SESSION_TTL
  });

  const cookieValue =
    `${token}.${signToken(token)}`;

  res.setHeader(
    "Set-Cookie",
    `aura_admin=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`
  );

  res.json({
    success: true
  });
});

/* ---------------- ADMIN LOGOUT ---------------- */

app.post("/admin/logout", (req, res) => {
  const cookie =
    parseCookies(req).aura_admin || "";

  const token = cookie.split(".")[0];

  if (token) {
    sessions.delete(token);
  }

  res.setHeader(
    "Set-Cookie",
    "aura_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
  );

  res.json({
    success: true
  });
});

/* ---------------- CHECK LOGIN ---------------- */

app.get(
  "/admin/api/me",
  requireAdmin,
  (_req, res) => {
    res.json({
      authenticated: true
    });
  }
);

/* ---------------- ADMIN REQUESTS ---------------- */

app.get(
  "/admin/api/requests",
  requireAdmin,
  async (_req, res) => {
    const supabaseUrl =
      process.env.SUPABASE_URL || "";

    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    if (!supabaseUrl || !serviceKey) {
      return res.status(503).json({
        error:
          "Request storage is not configured."
      });
    }

    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/support_requests?select=*&order=created_at.desc&limit=100`,
        {
          headers: {
            apikey: serviceKey,
            Authorization:
              `Bearer ${serviceKey}`
          }
        }
      );

      if (!response.ok) {
        console.error(
          "Supabase request fetch failed:",
          await response.text()
        );

        return res.status(502).json({
          error: "Could not load requests."
        });
      }

      res.json({
        requests: await response.json()
      });
    } catch (error) {
      console.error(
        "Admin request fetch error:",
        error
      );

      res.status(502).json({
        error: "Could not load requests."
      });
    }
  }
);

/* ---------------- UPDATE REQUEST STATUS ---------------- */

app.patch(
  "/admin/api/requests/:id",
  requireAdmin,
  async (req, res) => {
    const id = String(req.params.id || "");
    const status = String(
      req.body.status || ""
    );

    const allowed = [
      "pending",
      "reviewing",
      "resolved",
      "rejected"
    ];

    if (
      !/^\d+$/.test(id) ||
      !allowed.includes(status)
    ) {
      return res.status(400).json({
        error: "Invalid request update."
      });
    }

    const supabaseUrl =
      process.env.SUPABASE_URL || "";

    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    if (!supabaseUrl || !serviceKey) {
      return res.status(503).json({
        error:
          "Request storage is not configured."
      });
    }

    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/support_requests?id=eq.${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: {
            apikey: serviceKey,
            Authorization:
              `Bearer ${serviceKey}`,
            "Content-Type":
              "application/json",
            Prefer:
              "return=representation"
          },
          body: JSON.stringify({
            status,
            updated_at:
              new Date().toISOString()
          })
        }
      );

      if (!response.ok) {
        console.error(
          "Supabase request update failed:",
          await response.text()
        );

        return res.status(502).json({
          error:
            "Could not update request."
        });
      }

      const rows =
        await response.json();

      res.json({
        success: true,
        request: rows[0] || null
      });
    } catch (error) {
      console.error(
        "Admin request update error:",
        error
      );

      res.status(502).json({
        error:
          "Could not update request."
      });
    }
  }
);

/* ---------------- HEALTH CHECK ---------------- */

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true
  });
});
/* ---------------- ADMIN PAGE ---------------- */

app.get(
  ["/admin", "/admin.html"],
  (_req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin.html"
      )
    );
  }
);

/* ---------------- PUBLIC SITE ---------------- */

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

app.get("*", (_req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

/* ---------------- START ---------------- */

app.listen(PORT, () => {
  console.log(
    `AURA FF Support running on ${PORT}`
  );
});
