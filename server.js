const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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
    uid: uid,
    region: region.toUpperCase(),
    valid: true,
    message: "UID format is valid. Player details and ban status cannot be verified from this website."
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`AURA FF Unban Assist running on ${PORT}`);
});
