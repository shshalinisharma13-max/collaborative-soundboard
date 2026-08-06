const socket = io();

const SOUND_NAMES = {
  "sneaky-mischief": "Sneaky Mischief",
  "romantic-moment": "Romantic Moment",
  "love-theme": "Love Theme",
  suspense: "Suspense",
  rewind: "Rewind",
  bruh: "Bruh",
  "well-be-right-back": "We’ll Be Right Back",
  faah: "Faah!",
};

const AUDIO_FILES = Object.fromEntries(
  Object.keys(SOUND_NAMES).map((sound) => [sound, `/sounds/${sound}.mp3`]),
);

const roomInput = document.querySelector("#roomInput");
const armButton = document.querySelector("#armButton");
const lockButton = document.querySelector("#lockButton");
const stopButton = document.querySelector("#stopButton");
const copyButton = document.querySelector("#copyButton");
const connectionStatus = document.querySelector("#connectionStatus");
const userCount = document.querySelector("#userCount");
const audioStatus = document.querySelector("#audioStatus");
const lockStatus = document.querySelector("#lockStatus");
const nowPlaying = document.querySelector("#nowPlaying");
const activityLog = document.querySelector("#activityLog");
const message = document.querySelector("#message");
const audienceLink = document.querySelector("#audienceLink");

let armed = false;
let joinedRoom = "";
let locked = false;
let activeBackground = null;
let audioPlayers = {};

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

function createAudioPlayers() {
  return Object.fromEntries(
    Object.entries(AUDIO_FILES).map(([sound, source]) => {
      const audio = new Audio(source);
      audio.preload = "auto";
      audio.loop = sound === "sneaky-mischief" || sound === "suspense";
      return [sound, audio];
    }),
  );
}

function logActivity(text) {
  if (activityLog.children.length === 1 && activityLog.firstElementChild.textContent.includes("Waiting")) {
    activityLog.innerHTML = "";
  }
  const item = document.createElement("li");
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  item.append(time, document.createTextNode(text));
  activityLog.prepend(item);
  while (activityLog.children.length > 8) activityLog.lastElementChild.remove();
}

async function playOneShot(sound) {
  const player = audioPlayers[sound];
  if (!armed || !player) return;
  try {
    player.currentTime = 0;
    await player.play();
    logActivity(`${SOUND_NAMES[sound]} fired`);
  } catch (error) {
    console.error(error);
    message.textContent = "The browser blocked playback. Click the page, then arm the sound system again.";
  }
}

async function setBackground(sound) {
  ["sneaky-mischief", "suspense"].forEach((name) => {
    const player = audioPlayers[name];
    if (name !== sound && player) {
      player.pause();
      player.currentTime = 0;
    }
  });

  activeBackground = sound || null;
  stopButton.disabled = !armed || !activeBackground;
  nowPlaying.textContent = activeBackground
    ? `${SOUND_NAMES[activeBackground]} playing`
    : "No background track playing";

  if (!sound || !armed) return;
  const player = audioPlayers[sound];
  player.currentTime = 0;
  try {
    await player.play();
    logActivity(`${SOUND_NAMES[sound]} background started`);
  } catch (error) {
    console.error(error);
    message.textContent = "The browser blocked playback. Re-arm the sound system.";
  }
}

function updateLockUi() {
  lockStatus.textContent = locked ? "Web shooters disabled" : "Web shooters active";
  lockButton.textContent = locked ? "Enable Web Shooters" : "Disable Web Shooters";
  lockButton.classList.toggle("danger", !locked);
  document.body.classList.toggle("shooters-locked", locked);
}

async function armHost() {
  audioPlayers = createAudioPlayers();
  try {
    await Promise.all(Object.values(audioPlayers).map((audio) => audio.load()));
  } catch {
    // Browsers may not resolve load(); playback remains available after the click.
  }

  armed = true;
  joinedRoom = cleanRoomName(roomInput.value);
  roomInput.value = joinedRoom;
  roomInput.disabled = true;
  armButton.disabled = true;
  armButton.textContent = "Sound system armed";
  audioStatus.textContent = "Armed and listening";
  lockButton.disabled = false;
  copyButton.disabled = false;
  message.textContent = "Ready. Audience requests will play through this device.";
  audienceLink.href = roomUrl("/", joinedRoom);
  window.history.replaceState({}, "", roomUrl("/host", joinedRoom));
  socket.emit("register-host", joinedRoom);
}

armButton.addEventListener("click", armHost);
lockButton.addEventListener("click", () => socket.emit("set-lock", !locked));
stopButton.addEventListener("click", () => socket.emit("stop-background"));

copyButton.addEventListener("click", async () => {
  const link = roomUrl("/", joinedRoom || cleanRoomName(roomInput.value));
  try {
    await navigator.clipboard.writeText(link);
    copyButton.textContent = "Copied!";
    window.setTimeout(() => { copyButton.textContent = "Copy audience link"; }, 1200);
  } catch {
    window.prompt("Copy this audience link:", link);
  }
});

socket.on("connect", () => {
  connectionStatus.textContent = "Server connected";
  connectionStatus.classList.add("connected");
  if (armed && joinedRoom) socket.emit("register-host", joinedRoom);
});

socket.on("disconnect", () => {
  connectionStatus.textContent = "Reconnecting…";
  connectionStatus.classList.remove("connected");
});

socket.on("room-state", (state) => {
  userCount.textContent = String(state.heroesOnline);
  locked = state.locked;
  updateLockUi();
});

socket.on("play-one-shot", ({ sound }) => playOneShot(sound));
socket.on("background-state", ({ activeBackground: sound }) => {
  if (sound !== activeBackground) setBackground(sound);
});
