const socket = io();

const SOUND_NAMES = {
  punch: "Punch",
  bruh: "Bruh",
  faah: "Faah!",
  "modi-ji-bkl": "Modi Ji BKL",
  kick: "Kick",
  slap: "Slap",
  kamehameha: "Kamehameha",
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

const secretKeyInput = document.querySelector("#secretKeyInput");
const unlockSecretButton = document.querySelector("#unlockSecretButton");
const secretEffectButton = document.querySelector("#secretEffectButton");
const secretEffectStatus = document.querySelector("#secretEffectStatus");
const battleModeButton = document.querySelector("#battleModeButton");
const nextTurnButton = document.querySelector("#nextTurnButton");
const unlockKamehamehaButton = document.querySelector("#unlockKamehamehaButton");
const battleStatus = document.querySelector("#battleStatus");
const battleHelp = document.querySelector("#battleHelp");

let armed = false;
let joinedRoom = "";
let locked = false;
let activeBackground = null;
let audioPlayers = {};
let secretEffectUnlocked = false;
let secretEffectBusy = false;
let battleMode = false;
let battleTurn = null;
let kamehamehaUnlocked = false;
let battleEnded = false;

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
      audio.loop = false;
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
    const turnName = battleTurn === "spider-woman" ? "Spider-Woman" : "Spider-Man";
    logActivity(`${SOUND_NAMES[sound]} fired${battleMode ? ` for ${turnName}` : ""}`);
  } catch (error) {
    console.error(error);
    message.textContent = "The browser blocked playback. Click the page, then arm the sound system again.";
  }
}

async function setBackground(sound) {
  Object.entries(audioPlayers).forEach(([name, player]) => {
    if (name !== sound && player.loop) {
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

function updateSecretEffectUi() {
  secretEffectButton.disabled = !armed || !secretEffectUnlocked || secretEffectBusy;
  unlockSecretButton.disabled = !armed || secretEffectUnlocked;
  secretKeyInput.disabled = !armed || secretEffectUnlocked;

  if (!armed) {
    secretEffectStatus.textContent = "Arm the host first";
  } else if (!secretEffectUnlocked) {
    secretEffectStatus.textContent = "Locked · host key required";
  } else if (secretEffectBusy) {
    secretEffectStatus.textContent = "Cue sent…";
  } else {
    secretEffectStatus.textContent = "Unlocked · audience phones ready";
  }
}

function updateBattleUi() {
  const turnName = battleTurn === "spider-woman" ? "Spider-Woman" : "Spider-Man";
  battleModeButton.disabled = !armed;
  battleModeButton.textContent = battleMode ? "End / Reset Battle" : "Start Battle";
  battleModeButton.classList.toggle("danger", battleMode);
  nextTurnButton.disabled = !armed || !battleMode || battleEnded;
  nextTurnButton.textContent = battleTurn === "spider-woman"
    ? "Switch to Spider-Man"
    : "Switch to Spider-Woman";
  unlockKamehamehaButton.disabled = !armed || !battleMode || kamehamehaUnlocked || battleEnded;
  unlockKamehamehaButton.textContent = kamehamehaUnlocked ? "Kamehameha Unlocked" : "Unlock Kamehameha";
  unlockKamehamehaButton.classList.toggle("unlocked", kamehamehaUnlocked);

  if (!battleMode) {
    battleStatus.textContent = "Battle mode is off";
    battleHelp.textContent = "Start the battle to show Kick, Slap, and Punch on audience phones.";
  } else if (battleEnded) {
    battleStatus.textContent = "Battle finished - Kamehameha landed!";
    battleHelp.textContent = "End / Reset Battle when you are ready to return to the soundboard.";
  } else {
    battleStatus.textContent = `${turnName}'s turn`;
    battleHelp.textContent = kamehamehaUnlocked
      ? "The final Kamehameha attack is unlocked on audience phones."
      : "Kick, Slap, and Punch are live with a shared one-second cooldown.";
  }
}

async function armHost() {
  audioPlayers = createAudioPlayers();

  // Prime every player during this host click so later audience-triggered
  // playback is allowed by autoplay-restricted browsers.
  await Promise.allSettled(Object.values(audioPlayers).map(async (audio) => {
    audio.volume = 0;
    try {
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
    } finally {
      audio.volume = 1;
    }
  }));

  armed = true;
  joinedRoom = cleanRoomName(roomInput.value);
  roomInput.value = joinedRoom;
  roomInput.disabled = true;
  armButton.disabled = false;
  armButton.textContent = "Disarm sound system";
  armButton.classList.add("danger");
  audioStatus.textContent = "Armed and listening";
  lockButton.disabled = false;
  copyButton.disabled = false;
  message.textContent = "Ready. Audience requests will play through this device.";
  audienceLink.href = roomUrl("/", joinedRoom);
  window.history.replaceState({}, "", roomUrl("/host", joinedRoom));
  socket.emit("register-host", joinedRoom);
  updateSecretEffectUi();
  updateBattleUi();
}

function stopAllHostAudio() {
  Object.values(audioPlayers).forEach((player) => {
    player.pause();
    player.currentTime = 0;
  });
  activeBackground = null;
}

function disarmHost() {
  if (!armed) return;

  stopAllHostAudio();
  socket.emit("disarm-host", {}, () => {});

  armed = false;
  secretEffectUnlocked = false;
  secretEffectBusy = false;
  locked = false;
  battleMode = false;
  battleTurn = null;
  kamehamehaUnlocked = false;
  battleEnded = false;
  audioPlayers = {};

  roomInput.disabled = false;
  armButton.disabled = false;
  armButton.textContent = "Arm sound system";
  armButton.classList.remove("danger");
  audioStatus.textContent = "Not armed";
  nowPlaying.textContent = "No background track playing";
  lockButton.disabled = true;
  stopButton.disabled = true;
  copyButton.disabled = true;
  message.textContent = "Sound system disarmed. Any Dhongi Baba cue on audience phones has been stopped.";

  updateLockUi();
  updateSecretEffectUi();
  updateBattleUi();
  logActivity("Sound system disarmed · audience-phone cue stopped");
}

function unlockSecretEffect() {
  if (!armed || secretEffectUnlocked) return;

  const key = secretKeyInput.value;
  unlockSecretButton.disabled = true;
  secretEffectStatus.textContent = "Checking key…";

  socket.emit("unlock-secret-effect", key, (response) => {
    if (response?.ok) {
      secretEffectUnlocked = true;
      secretKeyInput.value = "";
      secretEffectStatus.textContent = "Unlocked · audience phones ready";
      logActivity("Secret audience-phone effect unlocked");
      updateSecretEffectUi();
      return;
    }

    if (response?.reason === "wrong-key") {
      secretEffectStatus.textContent = "Wrong key";
      secretKeyInput.select();
    } else {
      secretEffectStatus.textContent = "Unlock failed";
    }

    unlockSecretButton.disabled = false;
  });
}

function triggerSecretEffect() {
  if (!secretEffectUnlocked || secretEffectBusy) return;

  secretEffectBusy = true;
  updateSecretEffectUi();

  socket.emit("trigger-secret-audience-effect", {}, (response) => {
    if (response?.ok) {
      const count = Number(response.audienceCount || 0);
      const maxStagger = Number(response.maxStaggerMs || 500);
      secretEffectStatus.textContent = `FIRED · ${count} phones · random 0–${maxStagger} ms ripple`;
      logActivity(`DHONGI BABA fired to ${count} audience phone${count === 1 ? "" : "s"} with 0–${maxStagger} ms random stagger`);
    } else if (response?.reason === "not-authorized") {
      secretEffectUnlocked = false;
      secretEffectStatus.textContent = "Authorization lost · unlock again";
    } else if (response?.reason === "cooldown") {
      secretEffectStatus.textContent = "Cue is re-arming…";
    } else {
      secretEffectStatus.textContent = "Cue failed";
    }

    window.setTimeout(() => {
      secretEffectBusy = false;
      updateSecretEffectUi();
    }, 1000);
  });
}

armButton.addEventListener("click", () => armed ? disarmHost() : armHost());
lockButton.addEventListener("click", () => socket.emit("set-lock", !locked));
stopButton.addEventListener("click", () => socket.emit("stop-background"));
unlockSecretButton.addEventListener("click", unlockSecretEffect);
secretKeyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") unlockSecretEffect();
});
secretEffectButton.addEventListener("click", triggerSecretEffect);
battleModeButton.addEventListener("click", () => {
  if (!armed) return;
  socket.emit("set-battle-mode", !battleMode, (response) => {
    if (!response?.ok) return;
    logActivity(response.battleMode ? "Battle mode started - Spider-Man's turn" : "Battle mode ended and reset");
  });
});
nextTurnButton.addEventListener("click", () => {
  if (!battleMode || battleEnded) return;
  const nextTurn = battleTurn === "spider-woman" ? "spider-man" : "spider-woman";
  socket.emit("set-battle-turn", nextTurn, (response) => {
    if (response?.ok) logActivity(`Turn switched to ${nextTurn === "spider-woman" ? "Spider-Woman" : "Spider-Man"}`);
  });
});
unlockKamehamehaButton.addEventListener("click", () => {
  if (!battleMode || battleEnded || kamehamehaUnlocked) return;
  socket.emit("unlock-kamehameha", {}, (response) => {
    if (response?.ok) logActivity("Kamehameha finale unlocked for the audience");
  });
});

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

  // Socket auth is intentionally not persistent across reconnects. This is
  // safer: the special cue re-locks and must be authenticated again.
  if (armed && joinedRoom) {
    secretEffectUnlocked = false;
    socket.emit("register-host", joinedRoom);
    updateSecretEffectUi();
  }
});

socket.on("disconnect", () => {
  connectionStatus.textContent = "Reconnecting…";
  connectionStatus.classList.remove("connected");
  secretEffectUnlocked = false;
  updateSecretEffectUi();
});

socket.on("room-state", (state) => {
  userCount.textContent = String(state.heroesOnline);
  locked = state.locked;
  battleMode = Boolean(state.battleMode);
  battleTurn = state.battleTurn;
  kamehamehaUnlocked = Boolean(state.kamehamehaUnlocked);
  battleEnded = Boolean(state.battleEnded);
  updateLockUi();
  updateBattleUi();
});

socket.on("play-one-shot", ({ sound }) => playOneShot(sound));
socket.on("background-state", ({ activeBackground: sound }) => {
  if (sound !== activeBackground) setBackground(sound);
});

updateSecretEffectUi();
updateBattleUi();
