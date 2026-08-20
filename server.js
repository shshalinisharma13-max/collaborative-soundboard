import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { scryptSync, timingSafeEqual } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const PORT = globalThis.process?.env?.PORT || 3000;

const SOUND_COOLDOWN_MS = 4000;
const PUNCH_COOLDOWN_MS = 1000;
const BATTLE_COOLDOWN_MS = 1000;
const SECRET_EFFECT_COOLDOWN_MS = 1000;
const SECRET_EFFECT_MAX_STAGGER_MS = 500;

// Fixed show password without a Render environment variable.
// Only a slow scrypt hash is stored in the source; the plaintext password is
// not present in the deployed code.
const HOST_EFFECT_KEY_SALT = "collab-soundboard-v2";
const HOST_EFFECT_KEY_HASH = "b72c2d527720149c106274db164f3afcc52e6b1e9157bcef8df6103be307b1af";

function secretEffectKeyMatches(providedKey) {
  const candidate = scryptSync(String(providedKey || ""), HOST_EFFECT_KEY_SALT, 32);
  const expected = Buffer.from(HOST_EFFECT_KEY_HASH, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const BACKGROUND_SOUNDS = new Set();
const ONE_SHOT_SOUNDS = new Set([
  "punch",
  "bruh",
  "faah",
  "modi-ji-bkl",
  "kick",
  "slap",
  "kamehameha",
]);

const BATTLE_SOUNDS = new Set(["kick", "slap", "punch", "kamehameha"]);
const BATTLE_TURNS = new Set(["spider-man", "spider-woman"]);

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
      cooldownSound: null,
      cooldownDurationMs: 0,
      secretEffectCooldownUntil: 0,
      battleMode: false,
      battleTurn: null,
      kamehamehaUnlocked: false,
      battleEnded: false,
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
    cooldownSound: state.cooldownSound,
    cooldownDurationMs: state.cooldownDurationMs,
    battleMode: state.battleMode,
    battleTurn: state.battleTurn,
    kamehamehaUnlocked: state.kamehamehaUnlocked,
    battleEnded: state.battleEnded,
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

function sendToAudience(room, eventName, payload) {
  socketsInRoom(room)
    .filter((member) => member.data.role === "audience")
    .forEach((audience) => audience.emit(eventName, payload));
}

function leaveCurrentRoom(socket) {
  const oldRoom = socket.data.room;
  if (!oldRoom) return;

  socket.leave(oldRoom);
  socket.data.room = null;
  socket.data.role = null;
  socket.data.secretEffectUnlocked = false;
  broadcastState(oldRoom);
}

function joinRoom(socket, requestedRoom, role) {
  const room = cleanRoomName(requestedRoom);
  if (socket.data.room && socket.data.room !== room) leaveCurrentRoom(socket);

  socket.join(room);
  socket.data.room = room;
  socket.data.role = role;
  socket.data.secretEffectUnlocked = false;
  socket.emit("room-joined", roomSnapshot(room));
  broadcastState(room);
}

io.on("connection", (socket) => {
  socket.data.secretEffectUnlocked = false;

  socket.on("join-audience", (requestedRoom) => {
    joinRoom(socket, requestedRoom, "audience");
  });

  socket.on("register-host", (requestedRoom) => {
    joinRoom(socket, requestedRoom, "host");
    socket.emit("background-state", {
      activeBackground: getRoomState(socket.data.room).activeBackground,
    });
  });

  socket.on("unlock-secret-effect", (providedKey, acknowledge = () => {}) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== "host") {
      acknowledge({ ok: false, reason: "host-required" });
      return;
    }

    if (!secretEffectKeyMatches(providedKey)) {
      socket.data.secretEffectUnlocked = false;
      acknowledge({ ok: false, reason: "wrong-key" });
      return;
    }

    socket.data.secretEffectUnlocked = true;
    acknowledge({ ok: true });
  });

  socket.on("trigger-secret-audience-effect", (_payload, acknowledge = () => {}) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== "host" || !socket.data.secretEffectUnlocked) {
      acknowledge({ ok: false, reason: "not-authorized" });
      return;
    }

    const state = getRoomState(room);
    const now = Date.now();
    if (state.secretEffectCooldownUntil > now) {
      acknowledge({
        ok: false,
        reason: "cooldown",
        remainingMs: state.secretEffectCooldownUntil - now,
      });
      return;
    }

    state.secretEffectCooldownUntil = now + SECRET_EFFECT_COOLDOWN_MS;

    const audienceSockets = socketsInRoom(room).filter((member) => member.data.role === "audience");
    const cueId = `${now}-${Math.random().toString(36).slice(2, 8)}`;

    audienceSockets.forEach((audience) => {
      const delayMs = Math.floor(Math.random() * (SECRET_EFFECT_MAX_STAGGER_MS + 1));
      audience.emit("play-secret-audience-effect", {
        sound: "dhongibabaaudience",
        sentAt: now,
        cueId,
        delayMs,
      });
    });

    acknowledge({
      ok: true,
      audienceCount: audienceSockets.length,
      maxStaggerMs: SECRET_EFFECT_MAX_STAGGER_MS,
    });
  });

  socket.on("disarm-host", (_payload, acknowledge = () => {}) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== "host") {
      acknowledge({ ok: false, reason: "host-required" });
      return;
    }

    const state = getRoomState(room);
    state.activeBackground = null;
    state.locked = false;
    state.secretEffectCooldownUntil = 0;
    state.battleMode = false;
    state.battleTurn = null;
    state.kamehamehaUnlocked = false;
    state.battleEnded = false;
    state.cooldownUntil = 0;
    state.cooldownSound = null;
    state.cooldownDurationMs = 0;

    // Cancel both already-playing and not-yet-started staggered phone cues.
    sendToAudience(room, "stop-secret-audience-effect", { sentAt: Date.now() });
    sendToHosts(room, "background-state", { activeBackground: null });

    leaveCurrentRoom(socket);
    acknowledge({ ok: true });
  });

  socket.on("set-lock", (shouldLock) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== "host") return;

    getRoomState(room).locked = Boolean(shouldLock);
    broadcastState(room);
  });

  socket.on("set-battle-mode", (shouldStart, acknowledge = () => {}) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== "host") {
      acknowledge({ ok: false, reason: "host-required" });
      return;
    }

    const state = getRoomState(room);
    state.battleMode = Boolean(shouldStart);
    state.battleTurn = state.battleMode ? "spider-man" : null;
    state.kamehamehaUnlocked = false;
    state.battleEnded = false;
    state.cooldownUntil = 0;
    state.cooldownSound = null;
    state.cooldownDurationMs = 0;
    broadcastState(room);
    acknowledge({ ok: true, battleMode: state.battleMode, battleTurn: state.battleTurn });
  });

  socket.on("set-battle-turn", (requestedTurn, acknowledge = () => {}) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== "host") {
      acknowledge({ ok: false, reason: "host-required" });
      return;
    }

    const state = getRoomState(room);
    const battleTurn = String(requestedTurn || "");
    if (!state.battleMode || state.battleEnded || !BATTLE_TURNS.has(battleTurn)) {
      acknowledge({ ok: false, reason: "battle-not-active" });
      return;
    }

    state.battleTurn = battleTurn;
    broadcastState(room);
    acknowledge({ ok: true, battleTurn });
  });

  socket.on("unlock-kamehameha", (_payload, acknowledge = () => {}) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== "host") {
      acknowledge({ ok: false, reason: "host-required" });
      return;
    }

    const state = getRoomState(room);
    if (!state.battleMode || state.battleEnded) {
      acknowledge({ ok: false, reason: "battle-not-active" });
      return;
    }

    state.kamehamehaUnlocked = true;
    broadcastState(room);
    acknowledge({ ok: true });
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

    if (state.battleMode) {
      if (state.battleEnded || !BATTLE_SOUNDS.has(sound)) {
        acknowledge({ ok: false, reason: "battle-unavailable" });
        return;
      }

      if (sound === "kamehameha" && !state.kamehamehaUnlocked) {
        acknowledge({ ok: false, reason: "kamehameha-locked" });
        return;
      }
    } else if (BATTLE_SOUNDS.has(sound) && sound !== "punch") {
      acknowledge({ ok: false, reason: "battle-only" });
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

    const cooldownDurationMs = state.battleMode
      ? BATTLE_COOLDOWN_MS
      : sound === "punch" ? PUNCH_COOLDOWN_MS : SOUND_COOLDOWN_MS;
    state.cooldownUntil = now + cooldownDurationMs;
    state.cooldownSound = sound;
    state.cooldownDurationMs = cooldownDurationMs;

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

    const event = {
      sound,
      kind: "one-shot",
      sentAt: now,
      battleTurn: state.battleMode ? state.battleTurn : null,
    };
    sendToHosts(room, "play-one-shot", event);
    io.to(room).emit("sound-accepted", {
      ...event,
      reaction: ["POW!", "BAM!", "THWIP!"][Math.floor(Math.random() * 3)],
    });

    if (state.battleMode && sound === "kamehameha") {
      state.battleEnded = true;
    }

    broadcastState(room);
    acknowledge({
      ok: true,
      cooldownUntil: state.cooldownUntil,
      battleEnded: state.battleEnded,
    });
  });

  socket.on("disconnecting", () => {
    const room = socket.data.room;
    if (room && socket.data.role === "host") {
      sendToAudience(room, "stop-secret-audience-effect", { sentAt: Date.now() });
    }
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
