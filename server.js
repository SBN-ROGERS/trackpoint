const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "";   // required from the phones (x-api-key header)
const VIEW_KEY = process.env.VIEW_KEY || ""; // required to view the map (x-view-key header)
const MAX_TRAIL = 500;                       // points kept per device
const ONLINE_MS = 30 * 1000;                 // device counts as online if it reported in the last 30 s

// In-memory store. Render's free tier has no persistent disk, so data resets on restart.
const devices = new Map();

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Great-circle distance in metres between two [lat, lng] pairs
function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

app.get("/health", (_req, res) => res.send("ok"));

// Called by the Android app
app.post("/api/location", (req, res) => {
  if (API_KEY && req.get("x-api-key") !== API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const b = req.body || {};
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!b.deviceId || !Number.isFinite(lat) || !Number.isFinite(lng) ||
      Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: "deviceId, lat and lng are required" });
  }
  const id = String(b.deviceId).slice(0, 64);
  const d = devices.get(id) || { id, trail: [], distance: 0, points: 0 };
  const point = [lat, lng];
  const prev = d.trail[d.trail.length - 1];
  if (prev) d.distance += haversine(prev, point);
  d.trail.push(point);
  if (d.trail.length > MAX_TRAIL) d.trail.shift();
  d.points += 1;
  d.name = String(b.name || "Phone").slice(0, 40);
  d.lat = lat;
  d.lng = lng;
  d.accuracy = Number(b.accuracy) || 0;
  d.speed = Number(b.speed) || 0;           // km/h
  d.provider = String(b.provider || "").slice(0, 12);
  d.updated = Date.now();
  devices.set(id, d);
  res.json({ ok: true });
});

// Called by the web map
app.get("/api/devices", (req, res) => {
  if (VIEW_KEY && req.get("x-view-key") !== VIEW_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const now = Date.now();
  res.json([...devices.values()].map(d => ({ ...d, online: now - d.updated < ONLINE_MS })));
});

// Remove a device and its history
app.delete("/api/devices/:id", (req, res) => {
  if (VIEW_KEY && req.get("x-view-key") !== VIEW_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  devices.delete(req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log("TrackPoint backend listening on " + PORT));
