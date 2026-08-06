import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = globalThis.process?.env?.PORT || 3000;
const SOUND_COOLDOWN_MS = 4000;
const BACKGROUND_SOUNDS = new Set();
const ONE_SHOT_SOUNDS = new Set([
  "sneaky-mischief",
  "suspense",
  "romantic-moment",
  "love-theme",
  "rewind",
  "bruh",
  "well-be-right-back",
  "faah",
]);
const ALLOWED_SOUNDS = new Set([...BACKGROUND_SOUNDS, ...ONE_SHOT_SOUNDS]);
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));
app.get("/host", (_request, response) => {
  response.sendFile(path.join(__dirname, "public", "host.html"));
});

function cleanRoomName(value) {
  const room = String(value || "main")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 30);

  return room || "main";
}

function getRoomState(room) {
  if (!rooms.has(room)) {
    rooms.set(room, {
      locked: false,
      activeBackground: null,
      cooldownUntil: 0,
    });
  }

  return rooms.get(room);
}

function socketsInRoom(room) {
  const ids = io.sockets.adapter.rooms.get(room) || new Set();
  return [...ids]
    .map((id) => io.sockets.sockets.get(id))
    .filter(Boolean);
}

function roomSnapshot(room) {
  const members = socketsInRoom(room);
  const state = getRoomState(room);

  return {
    room,
    heroesOnline: members.filter((member) => member.data.role === "audience").length,
    hostOnline: members.some((member) => member.data.role === "host"),
    locked: state.locked,
    activeBackground: state.activeBackground,
    cooldownUntil: state.cooldownUntil,
  };
}

function broadcastState(room) {
  io.to(room).emit("room-state", roomSnapshot(room));
}

function sendToHosts(room, eventName, payload) {
  socketsInRoom(room)
    .filter((member) => member.data.role === "host")
    .forEach((host) => host.emit(eventName, payload));
}

function leaveCurrentRoom(socket) {
  const oldRoom = socket.data.room;
  if (!oldRoom) return;

  socket.leave(oldRoom);
  socket.data.room = null;
  socket.data.role = null;
  broadcastState(oldRoom);
}

function joinRoom(socket, requestedRoom, role) {
  const room = cleanRoomName(requestedRoom);
  if (socket.data.room && socket.data.room !== room) leaveCurrentRoom(socket);

  socket.join(room);
  socket.data.room = room;
  socket.data.role = role;
  socket.emit("room-joined", roomSnapshot(room));
  broadcastState(room);
}

io.on("connection", (socket) => {
  socket.on("join-audience", (requestedRoom) => {
    joinRoom(socket, requestedRoom, "audience");
  });

  socket.on("register-host", (requestedRoom) => {
    joinRoom(socket, requestedRoom, "host");
    socket.emit("background-state", {
      activeBackground: getRoomState(socket.data.room).activeBackground,
    });
  });

  socket.on("set-lock", (shouldLock) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== "host") return;

    getRoomState(room).locked = Boolean(shouldLock);
    broadcastState(room);
  });

  socket.on("stop-background", () => {
    const room = socket.data.room;
    if (!room || socket.data.role !== "host") return;

    const state = getRoomState(room);
    state.activeBackground = null;
    sendToHosts(room, "background-state", { activeBackground: null });
    io.to(room).emit("sound-accepted", {
      sound: null,
      kind: "background",
      reaction: "THWIP!",
      sentAt: Date.now(),
    });
    broadcastState(room);
  });

  socket.on("trigger-sound", (payload, acknowledge = () => {}) => {
    const room = socket.data.room;
    const sound = String(payload?.sound || "");

    if (!room || socket.data.role !== "audience" || !ALLOWED_SOUNDS.has(sound)) {
      acknowledge({ ok: false, reason: "invalid" });
      return;
    }

    const state = getRoomState(room);
    if (state.locked) {
      acknowledge({ ok: false, reason: "locked" });
      return;
    }

    if (!roomSnapshot(room).hostOnline) {
      acknowledge({ ok: false, reason: "no-host" });
      return;
    }

    const now = Date.now();
    const remainingMs = state.cooldownUntil - now;
    if (remainingMs > 0) {
      acknowledge({ ok: false, reason: "cooldown", remainingMs, cooldownUntil: state.cooldownUntil });
      return;
    }

    state.cooldownUntil = now + SOUND_COOLDOWN_MS;

    if (BACKGROUND_SOUNDS.has(sound)) {
      state.activeBackground = state.activeBackground === sound ? null : sound;
      const event = {
        activeBackground: state.activeBackground,
        requestedSound: sound,
        sentAt: now,
      };
      sendToHosts(room, "background-state", event);
      io.to(room).emit("sound-accepted", {
        sound,
        activeBackground: state.activeBackground,
        kind: "background",
        reaction: "THWIP!",
        sentAt: event.sentAt,
      });
      broadcastState(room);
      acknowledge({ ok: true, activeBackground: state.activeBackground, cooldownUntil: state.cooldownUntil });
      return;
    }

    const event = { sound, kind: "one-shot", sentAt: now };
    sendToHosts(room, "play-one-shot", event);
    io.to(room).emit("sound-accepted", {
      ...event,
      reaction: ["POW!", "BAM!", "THWIP!"][Math.floor(Math.random() * 3)],
    });
    broadcastState(room);
    acknowledge({ ok: true, cooldownUntil: state.cooldownUntil });
  });

  socket.on("disconnect", () => {
    const room = socket.data.room;
    if (!room) return;

    setTimeout(() => {
      if (io.sockets.adapter.rooms.has(room)) {
        broadcastState(room);
      } else {
        rooms.delete(room);
      }
    }, 0);
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Collaborative soundboard running on port ${PORT}`);
});
