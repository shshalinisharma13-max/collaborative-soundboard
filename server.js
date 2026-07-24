const path = require("path");
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;
const allowedPads = new Set([
  "kick",
  "snare",
  "hat",
  "bass",
  "chord",
  "bell",
  "pluck",
  "pulse",
]);

app.use(express.static(path.join(__dirname, "public")));

function cleanRoomName(value) {
  const room = String(value || "main")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 30);

  return room || "main";
}

function updateRoomCount(room) {
  const count = io.sockets.adapter.rooms.get(room)?.size ?? 0;
  io.to(room).emit("room-count", count);
}

io.on("connection", (socket) => {
  socket.on("join-room", (requestedRoom) => {
    const room = cleanRoomName(requestedRoom);

    // Leave an earlier room if the same browser changes rooms.
    if (socket.data.room && socket.data.room !== room) {
      const oldRoom = socket.data.room;
      socket.leave(oldRoom);
      updateRoomCount(oldRoom);
    }

    socket.join(room);
    socket.data.room = room;

    socket.emit("room-joined", room);
    updateRoomCount(room);
  });

  socket.on("play-pad", (payload) => {
    const room = socket.data.room;
    const pad = String(payload?.pad || "");

    if (!room || !allowedPads.has(pad)) return;

    // Send the event to everyone in the room, including the player.
    io.to(room).emit("play-pad", {
      pad,
      playerId: socket.id,
      sentAt: Date.now(),
    });
  });

  socket.on("disconnect", () => {
    const room = socket.data.room;
    if (!room) return;

    // Socket.IO removes the disconnected socket from its rooms automatically.
    setTimeout(() => updateRoomCount(room), 0);
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Collaborative soundboard running on port ${PORT}`);
});
