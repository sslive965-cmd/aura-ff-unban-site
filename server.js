const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.FF_API_KEY || "";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/player", async (req, res) => {
  const uid = String(req.query.uid || "").trim();
  const region = String(req.query.region || "ind").trim().toLowerCase();

  if (!/^\d{5,15}$/.test(uid)) {
    return res.status(400).json({ error: "Enter a valid 5-15 digit Free Fire UID." });
  }
  if (!["ind", "sg", "br"].includes(region)) {
    return res.status(400).json({ error: "Unsupported region." });
  }
  if (!API_KEY) {
    return res.status(503).json({
      error: "Player lookup is not configured yet. Add FF_API_KEY in the hosting environment."
    });
  }

  try {
    const url = new URL("https://developers.freefirecommunity.com/api/v1/info");
    url.searchParams.set("region", region);
    url.searchParams.set("uid", uid);

    const r = await fetch(url, { headers: { "x-api-key": API_KEY } });
    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({ error: data?.message || "Player lookup failed." });
    }

    const b = data.basicInfo || {};
    return res.json({
      uid: b.accountId || uid,
      nickname: b.nickname || "Unknown",
      level: b.level ?? "—",
      rank: b.rank ?? "—",
      region: b.region || region.toUpperCase(),
      likes: b.liked ?? "—",
      clan: data.clanBasicInfo?.clanName || "—",
      avatarId: data.profileInfo?.avatarId || null
    });
  } catch (e) {
    return res.status(502).json({ error: "Unable to reach the player-data service." });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`AURA FF Unban Assist running on ${PORT}`));
