const socket = io();

const roomInput = document.querySelector("#roomInput");
const startButton = document.querySelector("#startButton");
const copyButton = document.querySelector("#copyButton");
const connectionStatus = document.querySelector("#connectionStatus");
const userCount = document.querySelector("#userCount");
const message = document.querySelector("#message");
const pads = [...document.querySelectorAll(".pad")];

let audioStarted = false;
let joinedRoom = "";
let instruments;

const roomFromUrl = new URLSearchParams(window.location.search).get("room");
if (roomFromUrl) roomInput.value = roomFromUrl;

function createInstruments() {
  const limiter = new Tone.Limiter(-2).toDestination();
  const reverb = new Tone.Reverb({
    decay: 2.2,
    wet: 0.22,
  }).connect(limiter);

  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.04,
    octaves: 7,
    envelope: {
      attack: 0.001,
      decay: 0.32,
      sustain: 0,
      release: 0.08,
    },
  }).connect(limiter);
  kick.volume.value = -2;

  const snare = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: {
      attack: 0.001,
      decay: 0.16,
      sustain: 0,
      release: 0.05,
    },
  }).connect(limiter);
  snare.volume.value = -9;

  const hat = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: {
      attack: 0.001,
      decay: 0.045,
      sustain: 0,
      release: 0.02,
    },
  }).connect(limiter);
  hat.volume.value = -15;

  const bass = new Tone.MonoSynth({
    oscillator: { type: "square" },
    filter: { Q: 2, type: "lowpass", rolloff: -24 },
    envelope: {
      attack: 0.01,
      decay: 0.18,
      sustain: 0.2,
      release: 0.3,
    },
    filterEnvelope: {
      attack: 0.01,
      decay: 0.18,
      sustain: 0.15,
      release: 0.4,
      baseFrequency: 80,
      octaves: 3,
    },
  }).connect(limiter);
  bass.volume.value = -9;

  const chord = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: {
      attack: 0.02,
      decay: 0.25,
      sustain: 0.25,
      release: 1.1,
    },
  }).connect(reverb);
  chord.volume.value = -13;

  const bell = new Tone.FMSynth({
    harmonicity: 3.01,
    modulationIndex: 12,
    envelope: {
      attack: 0.01,
      decay: 0.25,
      sustain: 0.05,
      release: 1.2,
    },
    modulationEnvelope: {
      attack: 0.01,
      decay: 0.2,
      sustain: 0,
      release: 0.8,
    },
  }).connect(reverb);
  bell.volume.value = -12;

  const pluck = new Tone.PluckSynth({
    attackNoise: 1,
    dampening: 3600,
    resonance: 0.92,
  }).connect(reverb);
  pluck.volume.value = -8;

  const pulse = new Tone.Synth({
    oscillator: { type: "pulse", width: 0.35 },
    envelope: {
      attack: 0.005,
      decay: 0.1,
      sustain: 0.1,
      release: 0.25,
    },
  }).connect(limiter);
  pulse.volume.value = -11;

  return { kick, snare, hat, bass, chord, bell, pluck, pulse };
}

function cleanRoomName(value) {
  const cleaned = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 30);

  return cleaned || "main";
}

function roomUrl(room) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", room);
  return url.toString();
}

function enablePads(enabled) {
  pads.forEach((pad) => {
    pad.disabled = !enabled;
  });
}

function flashPad(padName) {
  const button = document.querySelector(`[data-pad="${padName}"]`);
  if (!button) return;

  button.classList.remove("active");
  void button.offsetWidth;
  button.classList.add("active");

  window.setTimeout(() => button.classList.remove("active"), 150);
}

function playSound(padName) {
  if (!audioStarted || !instruments) return;

  const now = Tone.now();

  switch (padName) {
    case "kick":
      instruments.kick.triggerAttackRelease("C1", "8n", now);
      break;
    case "snare":
      instruments.snare.triggerAttackRelease("16n", now);
      break;
    case "hat":
      instruments.hat.triggerAttackRelease("32n", now);
      break;
    case "bass":
      instruments.bass.triggerAttackRelease("C2", "8n", now);
      break;
    case "chord":
      instruments.chord.triggerAttackRelease(
        ["C4", "Eb4", "G4", "Bb4"],
        "2n",
        now,
      );
      break;
    case "bell":
      instruments.bell.triggerAttackRelease("G5", "8n", now);
      break;
    case "pluck":
      instruments.pluck.triggerAttackRelease("Eb4", "8n", now);
      break;
    case "pulse":
      instruments.pulse.triggerAttackRelease("G3", "16n", now);
      break;
  }

  flashPad(padName);
}

startButton.addEventListener("click", async () => {
  try {
    await Tone.start();

    if (!instruments) {
      instruments = createInstruments();
    }

    audioStarted = true;
    joinedRoom = cleanRoomName(roomInput.value);
    roomInput.value = joinedRoom;

    socket.emit("join-room", joinedRoom);

    const newUrl = roomUrl(joinedRoom);
    window.history.replaceState({}, "", newUrl);

    enablePads(true);
    copyButton.disabled = false;
    roomInput.disabled = true;
    startButton.disabled = true;
    startButton.textContent = "Audio started";

    message.textContent = `You are in room “${joinedRoom}”.`;
  } catch (error) {
    console.error(error);
    message.textContent = "Audio could not start. Try clicking the button again.";
  }
});

pads.forEach((button) => {
  button.addEventListener("click", () => {
    if (!audioStarted || !joinedRoom) return;
    socket.emit("play-pad", { pad: button.dataset.pad });
  });
});

copyButton.addEventListener("click", async () => {
  const link = roomUrl(joinedRoom || cleanRoomName(roomInput.value));

  try {
    await navigator.clipboard.writeText(link);
    copyButton.textContent = "Copied!";
    window.setTimeout(() => {
      copyButton.textContent = "Copy room link";
    }, 1200);
  } catch {
    window.prompt("Copy this room link:", link);
  }
});

socket.on("connect", () => {
  connectionStatus.textContent = "Server connected";
  connectionStatus.classList.add("connected");

  if (audioStarted && joinedRoom) {
    socket.emit("join-room", joinedRoom);
  }
});

socket.on("disconnect", () => {
  connectionStatus.textContent = "Reconnecting…";
  connectionStatus.classList.remove("connected");
  userCount.textContent = "0";
});

socket.on("room-joined", (room) => {
  message.textContent = `Joined room “${room}”. Press any pad.`;
});

socket.on("room-count", (count) => {
  userCount.textContent = String(count);
});

socket.on("play-pad", ({ pad }) => {
  playSound(pad);
});
