const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));
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

/* ---------------- SUPPORT REQUEST ---------------- */

app.post("/api/support-request", async (req, res) => {
  const uid = String(req.body.uid || "").trim();
  const region = String(req.body.region || "")
    .trim()
    .toLowerCase();

  const issue = String(req.body.issue || "").trim();
  const contact = String(req.body.contact || "").trim();

  if (!/^\d{5,15}$/.test(uid)) {
    return res.status(400).json({
      error: "Invalid UID."
    });
  }

  if (!["ind", "sg", "br"].includes(region)) {
    return res.status(400).json({
      error: "Unsupported region."
    });
  }

  if (!issue || issue.length > 1000) {
    return res.status(400).json({
      error: "Please describe the issue."
    });
  }

  if (contact.length > 200) {
    return res.status(400).json({
      error: "Contact information is too long."
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL || "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({
      error:
        "Support request storage is not configured yet."
    });
  }

  try {
    const response = await fetch(
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
          uid,
          region,
          issue,
          contact: contact || null
        })
      }
    );

    if (!response.ok) {
      console.error(
        "Supabase insert failed:",
        await response.text()
      );

      return res.status(502).json({
        error: "Could not save the request."
      });
    }

    const rows = await response.json();

    return res.status(201).json({
      success: true,
      request: rows[0] || null
    });
  } catch (error) {
    console.error(
      "Support request error:",
      error
    );

    return res.status(502).json({
      error: "Could not save the request."
    });
  }
});

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

/* ---------------- PROTECT ADMIN PAGE ---------------- */

app.get(
  ["/admin", "/admin.html"],
  (req, res) => {
    if (!validAdminSession(req)) {
      return res.status(404).send("Not found");
    }

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
