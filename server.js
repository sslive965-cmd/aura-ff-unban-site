const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* -----------------------------
   UID CHECK
----------------------------- */
app.get("/api/player", (req, res) => {
  const uid = String(req.query.uid || "").trim();
  const region = String(req.query.region || "ind").trim().toLowerCase();

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

/* -----------------------------
   HEALTH CHECK
----------------------------- */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

/* -----------------------------
   ADMIN LOGIN
   Password is kept on Render,
   not inside the public website.
----------------------------- */
app.post("/admin/login", (req, res) => {
  const password = String(req.body.password || "");
  const adminPassword = process.env.ADMIN_PASSWORD || "";

  if (!adminPassword) {
    return res.status(503).json({
      error: "Admin password is not configured."
    });
  }

  if (password !== adminPassword) {
    return res.status(401).json({
      error: "Invalid admin password."
    });
  }

  res.json({
    success: true,
    message: "Admin authentication successful."
  });
});

/* -----------------------------
   PUBLIC SITE
----------------------------- */
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`AURA FF Support running on port ${PORT}`);
});
