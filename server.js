// backend/server.js

const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const QRCode = require("qrcode");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(cors());
app.set("trust proxy", 1);

const PORT = process.env.PORT || 5000;
const FRONTEND = path.join(__dirname, "../frontend");
const dataPath = path.join(__dirname, "rooms.json");

// Serve frontend assets
app.use("/frontend", express.static(FRONTEND));
// Allow /room/:id page to load CSS/JS/images via /room/*
app.use("/room", express.static(FRONTEND));

function readRooms() {
  try {
    return JSON.parse(fs.readFileSync(dataPath, "utf8"));
  } catch {
    return [];
  }
}

function writeRooms(rooms) {
  fs.writeFileSync(dataPath, JSON.stringify(rooms, null, 2));
}

function expireRoomsIfNeeded(rooms) {
  const now = Date.now();
  let changed = false;
  for (const r of rooms) {
    if (r.endTime && now >= r.endTime) {
      r.status = "Available";
      delete r.bookedBy;
      delete r.purpose;
      delete r.endTime;
      delete r.bookingCode;
      changed = true;
    }
  }
  if (changed) writeRooms(rooms);
  return rooms;
}

function sanitizeRoom(room) {
  if (!room) return room;
  const { bookingCode, ...rest } = room;
  return rest;
}

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return process.env.PUBLIC_URL || `${proto}://${host}`;
}

// Track auto-release timers so we can reschedule on extend/cancel
const autoReleaseTimers = new Map();

function scheduleAutoRelease(roomId) {
  if (autoReleaseTimers.has(roomId)) {
    clearTimeout(autoReleaseTimers.get(roomId));
    autoReleaseTimers.delete(roomId);
  }
  const rooms = readRooms();
  const r = rooms.find((x) => x.id === roomId);
  if (!r || r.status !== "Occupied" || !r.endTime) return;

  const delay = r.endTime - Date.now();
  if (delay <= 0) {
    r.status = "Available";
    delete r.bookedBy;
    delete r.purpose;
    delete r.endTime;
    delete r.bookingCode;
    writeRooms(rooms);
    return;
  }
  const handle = setTimeout(() => {
    const currentRooms = readRooms();
    const current = currentRooms.find((x) => x.id === roomId);
    if (current && current.status === "Occupied" && current.endTime) {
      if (Date.now() >= current.endTime) {
        current.status = "Available";
        delete current.bookedBy;
        delete current.purpose;
        delete current.endTime;
        delete current.bookingCode;
        writeRooms(currentRooms);
      } else {
        // Extended while waiting; reschedule
        scheduleAutoRelease(roomId);
      }
    }
    autoReleaseTimers.delete(roomId);
  }, delay);
  autoReleaseTimers.set(roomId, handle);
}

// On server start, reschedule timers for any occupied rooms
(() => {
  const rooms = readRooms();
  rooms.forEach((r) => {
    if (r.status === "Occupied" && r.endTime) scheduleAutoRelease(r.id);
  });
})();

// GET all rooms (public): adds QR, hides bookingCode
app.get("/api/rooms", async (req, res) => {
  try {
    let rooms = readRooms();
    rooms = expireRoomsIfNeeded(rooms);
    const base = getBaseUrl(req);

    const publicRooms = await Promise.all(
      rooms.map(async (r) => {
        // QR to room landing page; room.html supports both /room/:id and ?id=
        const qrUrl = `${base}/room/${r.id}`;
        const qr = await QRCode.toDataURL(qrUrl);
        return { ...sanitizeRoom(r), qr };
      })
    );

    res.json(publicRooms); // FE expects an array
  } catch (e) {
    console.error("GET /api/rooms error:", e);
    res.status(500).json({ message: "Failed to load rooms" });
  }
});

// Book a room (returns bookingCode)
app.post("/api/book", (req, res) => {
  let { roomId, studentName, purpose, duration } = req.body;
  roomId = parseInt(roomId, 10);
  duration = parseInt(duration, 10);

  if (!Number.isInteger(roomId) || !Number.isInteger(duration) || duration <= 0) {
    return res.status(400).json({ message: "Invalid roomId or duration" });
  }
  if (typeof studentName !== "string" || !studentName.trim() ||
      typeof purpose !== "string" || !purpose.trim()) {
    return res.status(400).json({ message: "Invalid studentName or purpose" });
  }

  let rooms = expireRoomsIfNeeded(readRooms());
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return res.status(404).json({ message: "Room not found" });
  if (room.status === "Occupied") return res.status(400).json({ message: "Room already booked" });

  const endTime = Date.now() + duration * 60 * 1000;
  const bookingCode = crypto.randomBytes(4).toString("hex"); // 8 hex chars

  room.status = "Occupied";
  room.bookedBy = studentName.trim();
  room.purpose = purpose.trim();
  room.endTime = endTime;
  room.bookingCode = bookingCode;

  writeRooms(rooms);
  scheduleAutoRelease(roomId);

  console.log(`[Booking] Room ${roomId} code: ${bookingCode}`);

  res.json({
    message: "Room booked successfully! Save your booking code.",
    room: sanitizeRoom(room),
    bookingCode
  });
});

// Room landing page (for QR)
app.get("/room/:id", (req, res) => {
  res.sendFile(path.join(FRONTEND, "room.html"));
});

// Get single room (public)
app.get("/api/room/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  let rooms = readRooms();
  rooms = expireRoomsIfNeeded(rooms);
  const room = rooms.find((r) => r.id === id);
  if (!room) return res.status(404).json({ message: "Room not found" });
  res.json(sanitizeRoom(room));
});

// Release a room early
app.post("/api/room/:id/release", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { bookingCode } = req.body || {};
  if (!bookingCode) return res.status(400).json({ message: "bookingCode required" });

  const rooms = readRooms();
  const room = rooms.find((r) => r.id === id);
  if (!room) return res.status(404).json({ message: "Room not found" });
  if (room.status !== "Occupied") return res.status(400).json({ message: "Room is not occupied" });
  if (room.bookingCode !== bookingCode) return res.status(403).json({ message: "Invalid booking code" });

  room.status = "Available";
  delete room.bookedBy;
  delete room.purpose;
  delete room.endTime;
  delete room.bookingCode;

  writeRooms(rooms);

  if (autoReleaseTimers.has(id)) {
    clearTimeout(autoReleaseTimers.get(id));
    autoReleaseTimers.delete(id);
  }

  res.json({ message: "Room released successfully", room: sanitizeRoom(room) });
});

// Extend a booking
app.post("/api/room/:id/extend", (req, res) => {
  const id = parseInt(req.params.id, 10);
  let { bookingCode, extraMinutes } = req.body || {};
  extraMinutes = parseInt(extraMinutes, 10);

  if (!bookingCode) return res.status(400).json({ message: "bookingCode required" });
  if (!Number.isInteger(extraMinutes) || extraMinutes <= 0) {
    return res.status(400).json({ message: "extraMinutes must be a positive integer" });
  }

  let rooms = expireRoomsIfNeeded(readRooms());
  const room = rooms.find((r) => r.id === id);
  if (!room) return res.status(404).json({ message: "Room not found" });
  if (room.status !== "Occupied" || !room.endTime) {
    return res.status(400).json({ message: "Room is not currently occupied" });
  }
  if (room.bookingCode !== bookingCode) {
    return res.status(403).json({ message: "Invalid booking code" });
  }

  room.endTime += extraMinutes * 60 * 1000;
  writeRooms(rooms);
  scheduleAutoRelease(id);

  res.json({
    message: `Extended by ${extraMinutes} minutes`,
    room: sanitizeRoom(room)
  });
});

// Root -> index
app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND, "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}/`);
  console.log(`API:      http://localhost:${PORT}/api/rooms`);
});