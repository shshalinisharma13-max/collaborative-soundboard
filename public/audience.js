const socket = io();

const roomInput = document.querySelector("#roomInput");
const joinButton = document.querySelector("#joinButton");
const connectionStatus = document.querySelector("#connectionStatus");
const userCount = document.querySelector("#userCount");
const message = document.querySelector("#message");
const reaction = document.querySelector("#reaction");
const pads = [...document.querySelectorAll(".pad")];

let joinedRoom = "";
let roomState = { locked: false, hostOnline: false, activeBackground: null, cooldownUntil: 0 };
let cooldownTimer = null;

const roomFromUrl = new URLSearchParams(window.location.search).get("room");
if (roomFromUrl) roomInput.value = roomFromUrl;

function cleanRoomName(value) {
  return String(value || "main")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 30) || "main";
}

function roomUrl(pathname, room) {
  const url = new URL(pathname, window.location.origin);
  url.searchParams.set("room", room);
  return url.toString();
}

function updateControls() {
  const enabled = Boolean(joinedRoom && socket.connected && roomState.hostOnline && !roomState.locked);
  const coolingDown = (roomState.cooldownUntil || 0) > Date.now();
  pads.forEach((pad) => {
    pad.disabled = !enabled || coolingDown;
    pad.classList.toggle("cooling-down", coolingDown);
    pad.classList.toggle("playing", pad.dataset.sound === roomState.activeBackground);
    pad.setAttribute("aria-pressed", String(pad.dataset.sound === roomState.activeBackground));
  });

  document.body.classList.toggle("shooters-locked", roomState.locked);
  if (!joinedRoom) {
    message.textContent = "Join the mission to activate your web shooters.";
  } else if (!roomState.hostOnline) {
    message.textContent = "Waiting for the host sound system to come online…";
  } else if (roomState.locked) {
    message.textContent = "Web shooters disabled by the host.";
  } else if (coolingDown) {
    message.textContent = "Soundboard recharging - all sounds unlock in four seconds.";
  } else if (roomState.activeBackground) {
    const active = document.querySelector(`[data-sound="${roomState.activeBackground}"] span:nth-of-type(2)`)?.textContent;
    message.textContent = `${active || "Background track"} is playing. Tap it again to stop.`;
  } else {
    message.textContent = "Web shooters ready. Choose your moment!";
  }
}

function showReaction(word, button) {
  if (button) {
    const rect = button.getBoundingClientRect();
    reaction.style.left = `${Math.min(window.innerWidth - 100, Math.max(12, rect.left + rect.width / 2 - 55))}px`;
    reaction.style.top = `${Math.max(70, rect.top - 30)}px`;
  }
  reaction.textContent = word;
  reaction.classList.remove("burst");
  void reaction.offsetWidth;
  reaction.classList.add("burst");
}

function joinRoom() {
  joinedRoom = cleanRoomName(roomInput.value);
  roomInput.value = joinedRoom;
  roomInput.disabled = true;
  joinButton.disabled = true;
  joinButton.textContent = "Mission joined";
  window.history.replaceState({}, "", roomUrl("/", joinedRoom));
  socket.emit("join-audience", joinedRoom);
  updateControls();
}

function scheduleCooldownEnd() {
  window.clearTimeout(cooldownTimer);
  updateControls();

  const remainingMs = (roomState.cooldownUntil || 0) - Date.now();
  if (remainingMs <= 0) return;

  cooldownTimer = window.setTimeout(updateControls, remainingMs + 25);
}

joinButton.addEventListener("click", joinRoom);
roomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinRoom();
});

pads.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.disabled) return;
    const sound = button.dataset.sound;

    socket.emit("trigger-sound", { sound }, (response) => {
      if (response?.ok) {
        roomState.cooldownUntil = response.cooldownUntil;
        scheduleCooldownEnd();
        return;
      }

      if (response?.reason === "cooldown") message.textContent = "Easy, hero—this sound is recharging.";
      if (response?.reason === "cooldown") {
        roomState.cooldownUntil = response.cooldownUntil;
        scheduleCooldownEnd();
      }
      if (response?.reason === "locked") message.textContent = "Web shooters disabled by the host.";
      if (response?.reason === "no-host") message.textContent = "Waiting for the host sound system…";
    });
  });
});

socket.on("connect", () => {
  connectionStatus.textContent = "Server connected";
  connectionStatus.classList.add("connected");
  if (joinedRoom) socket.emit("join-audience", joinedRoom);
});

socket.on("disconnect", () => {
  connectionStatus.textContent = "Reconnecting…";
  connectionStatus.classList.remove("connected");
  roomState.hostOnline = false;
  updateControls();
});

socket.on("room-state", (state) => {
  roomState = state;
  userCount.textContent = String(state.heroesOnline);
  scheduleCooldownEnd();
});

socket.on("sound-accepted", (event) => {
  const button = event.sound ? document.querySelector(`[data-sound="${event.sound}"]`) : null;
  showReaction(event.reaction || "THWIP!", button);
});
