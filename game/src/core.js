// VICE SHORES — shared tuning, deterministic random, keyboard/mouse input,
// and synthesized WebAudio sound. No audio files: every sound is built live
// from oscillators. This module owns no game rules, only the numbers and the
// plumbing the simulation (world.js) and the presentation (render.js) share.
import * as THREE from 'three';

export const STEP = 1 / 60;

// The city is a grid: roads every 58 m, seven centrelines per axis, blocks of
// 44 m between them. South of z = 196 the roads give way to sand, then sea.
export const CITY = {
  pitch: 58,
  roads: 7,
  roadHalf: 7,
  block: 44,
  bound: 210,
  beachZ: 196,
  oceanZ: 250,
};

export const PLAYER = {
  walkSpeed: 7,
  runSpeed: 11,
  accel: 60,
  jumpSpeed: 9,
  radius: 0.9,
  health: 100,
};

export const CAR = {
  accel: 16,
  brake: 26,
  maxSpeed: 30,
  maxReverse: 9,
  steer: 0.55,
  grip: 6,
};

export const TRAFFIC_COUNT = 10;
export const PED_COUNT = 16;
export const POLICE_MAX = 4;

export const WANTED_DECAY_SECONDS = 18;
export const BUST_LOSS = 0.15;
export const WASTED_LOSS = 0.1;

// Rico's six jobs, in story order. `target` is an [x, z] map point;
// `time` is the limit in seconds for timed jobs.
export const MISSIONS = [
  { title: '1 · Meet Rico at the Pier', text: 'Rico is waiting at the pier, south beach. Get there any way you can.', kind: 'goto', target: [150, 218], reward: 100 },
  { title: '2 · Borrow a Ride', text: 'A job needs wheels. Walk up to any parked car and press E to take it. The owner will not mind. Probably.', kind: 'steal', target: null, reward: 50 },
  { title: '3 · Pick Up the Package', text: 'Rico stashed a package behind the north docks. Drive there and press E to grab it.', kind: 'pickup', target: [-160, -180], reward: 150 },
  { title: '4 · Lose the Heat', text: 'The PD is on you. Lay low — no new crimes — until your wanted level drops to zero.', kind: 'clean', target: null, reward: 100 },
  { title: '5 · Beach Sprint', text: 'Rico bets you cannot reach the beach marker in 75 seconds. Prove him wrong.', kind: 'timed', target: [150, 218], time: 75, reward: 200 },
  { title: '6 · The Big Delivery', text: 'Final job: deliver the package to the north docks in 90 seconds. $500 if you make it.', kind: 'timed', target: [-160, -180], time: 90, reward: 500 },
];

export const SAVE_KEY = 'vice-shores-save-v1';
export const BEST_KEY = 'vice-shores-best-v1';

export const PALETTE = {
  sky: 0x8ec3ee,
  fog: 0xcfe0f2,
  sun: 0xfff1cf,
  asphalt: 0x2b2f38,
  sidewalk: 0x9aa0ab,
  sand: 0xe8cf9a,
  ocean: 0x2e7fc2,
  building: [0xd96a5f, 0xe8a34c, 0x5f8fd9, 0x7bc47f, 0xc9a86a, 0x9a7fd0, 0x6fb3d8, 0xe07f9a],
  car: [0xd94f3d, 0x3d7bd9, 0xe8c33d, 0x37b268, 0xe8e8e8, 0x22242a, 0xd97b2f, 0x7a4fd0],
  pedShirt: [0xe85d5d, 0x4f8de8, 0x58c96b, 0xe8c33d, 0xb678e8, 0xe8e8e8, 0x2fae9e],
};

// ------------------------------------------------------------- helpers ----
// Small pure helpers the simulation and the HUD share, so the same math is
// never written twice in two files.
export function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Shortest signed turn from angle `a` to angle `b`, in (-PI, PI].
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

// "$1,250" with a thousands separator, for the cash readout.
export function formatCash(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

// The in-game clock starts at sunset: 18:20, and runs 1 game-minute per
// real second while the city is live.
export const START_CLOCK_MINUTES = 18 * 60 + 20;

// Deterministic xorshift32 generator: the same seed always deals the same city,
// so a screenshot seed reproduces its scene exactly.
export function createRandom(seed) {
  let s = (seed >>> 0) || 1;
  return function random() {
    s ^= (s << 13) >>> 0; s >>>= 0;
    s ^= s >>> 17;
    s ^= (s << 5) >>> 0; s >>>= 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------- input ----
// One-shot actions are delivered as a bitmask the loop drains once per step;
// held keys are read live through forward()/strafe()/run().
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER = 4;
export const ACTION_PUNCH = 8;
export const ACTION_HORN = 16;
export const ACTION_JUMP = 32;
export const ACTION_MUTE = 64;

export function createInput(canvas) {
  const down = new Set();
  let queued = 0;
  let dragDX = 0, dragDY = 0;
  let dragging = false, px = 0, py = 0;

  const CONFIRM_KEYS = ['Space', 'Enter'];
  const PREVENT = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

  window.addEventListener('keydown', (ev) => {
    if (PREVENT.includes(ev.code)) ev.preventDefault();
    if (ev.repeat) { down.add(ev.code); return; }
    down.add(ev.code);
    if (CONFIRM_KEYS.includes(ev.code)) queued |= ACTION_CONFIRM;
    if (ev.code === 'KeyP' || ev.code === 'Escape') queued |= ACTION_PAUSE;
    if (ev.code === 'KeyE') queued |= ACTION_ENTER;
    if (ev.code === 'KeyF') queued |= ACTION_PUNCH;
    if (ev.code === 'KeyH') queued |= ACTION_HORN;
    if (ev.code === 'KeyM') queued |= ACTION_MUTE;
    if (ev.code === 'Space') queued |= ACTION_JUMP;
  });
  window.addEventListener('keyup', (ev) => down.delete(ev.code));
  window.addEventListener('blur', () => down.clear());

  canvas.addEventListener('pointerdown', (ev) => {
    dragging = true; px = ev.clientX; py = ev.clientY;
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    dragDX += ev.clientX - px; dragDY += ev.clientY - py;
    px = ev.clientX; py = ev.clientY;
  });
  const release = () => { dragging = false; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  const held = (...codes) => codes.some((c) => down.has(c));
  return {
    forward() { return (held('KeyW', 'ArrowUp') ? 1 : 0) - (held('KeyS', 'ArrowDown') ? 1 : 0); },
    strafe() { return (held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0); },
    run() { return held('ShiftLeft', 'ShiftRight'); },
    takeLook() { const out = { dx: dragDX, dy: dragDY }; dragDX = 0; dragDY = 0; return out; },
    takeActions() { const out = queued; queued = 0; return out; },
  };
}

// ---------------------------------------------------------------- audio ----
// Everything is synthesized: a two-oscillator engine hum, a two-tone siren,
// a looping bass line, and one-shot blips. Nothing is loaded from disk.
export function createAudio() {
  let ac = null;
  let muted = false;
  let eng = null, engSub = null, engBus = null;
  let siren = null, sirenBus = null, sirenClock = 0;
  let bassBus = null, bassClock = 0, bassStep = 0;
  const BASS_LINE = [55, 55, 65.41, 49, 55, 55, 65.41, 82.41];

  function ensure() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return true; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ac = new AC();
      engBus = ac.createGain(); engBus.gain.value = 0; engBus.connect(ac.destination);
      eng = ac.createOscillator(); eng.type = 'sawtooth'; eng.frequency.value = 50;
      engSub = ac.createOscillator(); engSub.type = 'square'; engSub.frequency.value = 100;
      const subBus = ac.createGain(); subBus.gain.value = 0.4; subBus.connect(engBus);
      eng.connect(engBus); engSub.connect(subBus);
      eng.start(); engSub.start();
      sirenBus = ac.createGain(); sirenBus.gain.value = 0; sirenBus.connect(ac.destination);
      siren = ac.createOscillator(); siren.type = 'sine'; siren.frequency.value = 750;
      siren.connect(sirenBus); siren.start();
      bassBus = ac.createGain(); bassBus.gain.value = 0.05; bassBus.connect(ac.destination);
    } catch { return false; }
    return true;
  }

  function note(freq, dur, type, vol, delay = 0) {
    if (!ac || muted) return;
    const t0 = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  return {
    unlock() { ensure(); },
    setMuted(m) { muted = m; if (engBus) engBus.gain.value = 0; if (sirenBus) sirenBus.gain.value = 0; },
    isMuted() { return muted; },
    update(dt, speed01, wanted) {
      if (!ac || muted) return;
      if (eng) {
        eng.frequency.value = 45 + speed01 * 130;
        engSub.frequency.value = 90 + speed01 * 260;
        engBus.gain.value = speed01 > 0.02 ? 0.05 + speed01 * 0.05 : 0;
      }
      if (siren) {
        sirenClock += dt;
        siren.frequency.value = (Math.floor(sirenClock * 2) % 2 === 0) ? 720 : 980;
        sirenBus.gain.value = wanted > 0 ? 0.035 : 0;
      }
      bassClock -= dt;
      if (bassClock <= 0) {
        bassClock = 0.42;
        const f = BASS_LINE[bassStep % BASS_LINE.length]; bassStep += 1;
        note(f, 0.4, 'triangle', 0.12);
        if (bassStep % 4 === 0) note(f * 2, 0.2, 'sine', 0.05);
      }
    },
    blip() { note(880, 0.12, 'sine', 0.18); note(1320, 0.14, 'sine', 0.12, 0.07); },
    thud() { note(120, 0.15, 'square', 0.2); note(70, 0.2, 'sine', 0.22); },
    crash() { note(90, 0.25, 'sawtooth', 0.2); note(55, 0.3, 'square', 0.15, 0.05); },
    horn() { note(233, 0.3, 'square', 0.12); note(294, 0.3, 'square', 0.1); },
    jingle() { [523, 659, 784, 1047].forEach((f, i) => note(f, 0.22, 'triangle', 0.18, i * 0.09)); },
    busted() { [392, 330, 262, 196].forEach((f, i) => note(f, 0.3, 'sawtooth', 0.12, i * 0.13)); },
  };
}

export { THREE };
