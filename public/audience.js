const socket = io();

const roomInput = document.querySelector("#roomInput");
const joinButton = document.querySelector("#joinButton");
const connectionStatus = document.querySelector("#connectionStatus");
const userCount = document.querySelector("#userCount");
const message = document.querySelector("#message");
const reaction = document.querySelector("#reaction");
const pads = [...document.querySelectorAll(".pad")];
const standardPadGrid = document.querySelector("#standardPadGrid");
const battlePanel = document.querySelector("#battlePanel");
const battleTurn = document.querySelector("#battleTurn");
const battleInstruction = document.querySelector("#battleInstruction");
const kamehamehaLabel = document.querySelector("#kamehamehaLabel");

let joinedRoom = "";
let roomState = {
  locked: false,
  hostOnline: false,
  activeBackground: null,
  cooldownUntil: 0,
  cooldownSound: null,
  cooldownDurationMs: 0,
  battleMode: false,
  battleTurn: null,
  kamehamehaUnlocked: false,
  battleEnded: false,
};
let cooldownTimer = null;

// Reuse ONE audio element. On iOS/Safari, unlocking the same element during
// the user's Join Mission tap makes later Socket.IO-triggered playback much
// more reliable than creating a fresh Audio() at cue time.
const secretAudienceEffect = new Audio("/sounds/dhongibabaaudience.mp3");
secretAudienceEffect.preload = "auto";
secretAudienceEffect.loop = false;
secretAudienceEffect.playsInline = true;
let secretAudioUnlocked = false;
let secretEffectTimer = null;

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
  const inBattle = Boolean(roomState.battleMode);
  const turnName = roomState.battleTurn === "spider-woman" ? "Spider-Woman" : "Spider-Man";

  standardPadGrid.hidden = inBattle;
  battlePanel.hidden = !inBattle;
  battlePanel.classList.toggle("battle-ended", Boolean(roomState.battleEnded));
  battleTurn.textContent = roomState.battleEnded ? "Battle finished!" : `${turnName}'s turn`;
  battleInstruction.textContent = roomState.battleEnded
    ? "Kamehameha landed. The host can reset the battle."
    : "Audience, choose the attack!";
  kamehamehaLabel.textContent = roomState.kamehamehaUnlocked ? "Final attack ready" : "Locked by host";

  pads.forEach((pad) => {
    const isBattlePad = pad.classList.contains("battle-pad");
    const isKamehameha = pad.dataset.sound === "kamehameha";
    const correctMode = inBattle ? isBattlePad : !isBattlePad;
    const finaleLocked = isKamehameha && !roomState.kamehamehaUnlocked;
    pad.disabled = !enabled || !correctMode || coolingDown || finaleLocked || Boolean(roomState.battleEnded);
    pad.classList.toggle("cooling-down", coolingDown);
    pad.classList.toggle("unlocked", isKamehameha && Boolean(roomState.kamehamehaUnlocked));
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
  } else if (roomState.battleEnded) {
    message.textContent = "Final attack complete. Battle over!";
  } else if (coolingDown) {
    const seconds = Math.max(1, Math.ceil(((roomState.cooldownUntil || 0) - Date.now()) / 1000));
    const soundName = inBattle ? "Attack" : roomState.cooldownSound === "punch" ? "Punch" : "Soundboard";
    message.textContent = `${soundName} recharging - ready in ${seconds} second${seconds === 1 ? "" : "s"}.`;
  } else if (inBattle) {
    message.textContent = `${turnName}'s turn. Choose Kick, Slap, or Punch${roomState.kamehamehaUnlocked ? " - Kamehameha is unlocked!" : "."}`;
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

async function unlockSecretAudienceAudio() {
  if (secretAudioUnlocked) return true;

  try {
    secretAudienceEffect.volume = 0;
    secretAudienceEffect.currentTime = 0;
    await secretAudienceEffect.play();
    secretAudienceEffect.pause();
    secretAudienceEffect.currentTime = 0;
    secretAudienceEffect.volume = 1;
    secretAudioUnlocked = true;
    return true;
  } catch (error) {
    console.warn("Audience-phone audio could not be pre-unlocked.", error);
    secretAudienceEffect.volume = 1;
    return false;
  }
}

function stopSecretAudienceEffect() {
  window.clearTimeout(secretEffectTimer);
  secretEffectTimer = null;
  secretAudienceEffect.pause();
  secretAudienceEffect.currentTime = 0;
}

function scheduleSecretAudienceEffect(delayMs = 0) {
  stopSecretAudienceEffect();

  const safeDelay = Math.max(0, Math.min(500, Number(delayMs) || 0));
  secretEffectTimer = window.setTimeout(async () => {
    secretEffectTimer = null;
    try {
      secretAudienceEffect.currentTime = 0;
      secretAudienceEffect.volume = 1;
      await secretAudienceEffect.play();
    } catch (error) {
      console.warn("The special audience-phone effect was blocked on this device.", error);
    }
  }, safeDelay);
}

async function joinRoom() {
  // This happens directly inside the user's tap, which is the best moment to
  // satisfy mobile-browser audio/autoplay restrictions.
  await unlockSecretAudienceAudio();

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
      if (response?.reason === "kamehameha-locked") message.textContent = "Kamehameha is still locked by the host.";
      if (response?.reason === "battle-unavailable") message.textContent = "That battle action is no longer available.";
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
  const button = event.sound
    ? [...document.querySelectorAll(`[data-sound="${event.sound}"]`)].find((candidate) => !candidate.closest("[hidden]"))
    : null;
  showReaction(event.reaction || "THWIP!", button);
});

socket.on("play-secret-audience-effect", ({ delayMs = 0 } = {}) => {
  scheduleSecretAudienceEffect(delayMs);
});

socket.on("stop-secret-audience-effect", () => {
  stopSecretAudienceEffect();
});
