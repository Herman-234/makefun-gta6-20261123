// Shared tuning, seeded random, keyboard/mouse input and synthesized WebAudio sound.
// No assets: every sound is generated with oscillators and noise at run time.
import * as THREE from 'three';

export const STEP = 1 / 60;

export const CITY = {
  pitch: 58,          // road centreline spacing
  roads: 7,           // road centrelines per axis (-3..3)
  roadHalf: 7,        // half width of the road surface
  block: 44,          // block size between roads
  bound: 210,         // playable half-extent (city + beach strip)
  beachZ: 196,        // sand starts here (south edge)
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
export const WASTED_LOSS = 0.10;

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

export function createRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- input ----
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER = 4;
export const ACTION_PUNCH = 8;
export const ACTION_HORN = 16;
export const ACTION_JUMP = 32;
export const ACTION_MUTE = 64;

export function createInput(canvas) {
  const keys = new Set();
  let actions = 0;
  let lookDX = 0, lookDY = 0;
  let dragging = false;
  let lastX = 0, lastY = 0;

  const CONFIRM = new Set(['Space', 'Enter']);
  window.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
    if (event.repeat) { keys.add(event.code); return; }
    keys.add(event.code);
    if (CONFIRM.has(event.code)) actions |= ACTION_CONFIRM;
    if (event.code === 'KeyP' || event.code === 'Escape') actions |= ACTION_PAUSE;
    if (event.code === 'KeyE') actions |= ACTION_ENTER;
    if (event.code === 'KeyF') actions |= ACTION_PUNCH;
    if (event.code === 'KeyH') actions |= ACTION_HORN;
    if (event.code === 'KeyM') actions |= ACTION_MUTE;
    if (event.code === 'Space') actions |= ACTION_JUMP;
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true; lastX = event.clientX; lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    lookDX += event.clientX - lastX;
    lookDY += event.clientY - lastY;
    lastX = event.clientX; lastY = event.clientY;
  });
  const endDrag = () => { dragging = false; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  return {
    forward() { return (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0); },
    strafe() { return (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0); },
    run() { return keys.has('ShiftLeft') || keys.has('ShiftRight'); },
    takeLook() { const dx = lookDX, dy = lookDY; lookDX = 0; lookDY = 0; return { dx, dy }; },
    takeActions() { const taken = actions; actions = 0; return taken; },
  };
}

// ---------------------------------------------------------------- audio ----
export function createAudio() {
  let ctx = null;
  let muted = false;
  let engineOsc = null, engineOsc2 = null, engineGain = null;
  let sirenOsc = null, sirenGain = null, sirenPhase = 0;
  let musicGain = null;
  let musicTimer = 0;
  let musicStep = 0;
  const BASS = [55, 55, 65.41, 49, 55, 55, 65.41, 82.41]; // A A C G pattern, Hz

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      engineGain = ctx.createGain(); engineGain.gain.value = 0; engineGain.connect(ctx.destination);
      engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 50;
      engineOsc2 = ctx.createOscillator(); engineOsc2.type = 'square'; engineOsc2.frequency.value = 100;
      const eg2 = ctx.createGain(); eg2.gain.value = 0.4; eg2.connect(engineGain);
      engineOsc.connect(engineGain); engineOsc2.connect(eg2);
      engineOsc.start(); engineOsc2.start();
      sirenGain = ctx.createGain(); sirenGain.gain.value = 0; sirenGain.connect(ctx.destination);
      sirenOsc = ctx.createOscillator(); sirenOsc.type = 'sine'; sirenOsc.frequency.value = 750; sirenOsc.start(); sirenOsc.connect(sirenGain);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.05; musicGain.connect(ctx.destination);
    } catch { return false; }
    return true;
  }

  function tone(freq, dur, type, vol, when = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  return {
    unlock() { ensure(); },
    setMuted(m) { muted = m; if (engineGain) engineGain.gain.value = 0; if (sirenGain) sirenGain.gain.value = 0; },
    isMuted() { return muted; },
    update(dt, speed01, wanted) {
      if (!ctx || muted) return;
      if (engineOsc) {
        engineOsc.frequency.value = 45 + speed01 * 130;
        engineOsc2.frequency.value = 90 + speed01 * 260;
        engineGain.gain.value = speed01 > 0.02 ? 0.05 + speed01 * 0.05 : 0.0;
      }
      if (sirenOsc) {
        sirenPhase += dt;
        sirenOsc.frequency.value = (Math.floor(sirenPhase * 2) % 2 === 0) ? 720 : 980;
        sirenGain.gain.value = wanted > 0 ? 0.035 : 0;
      }
      musicTimer -= dt;
      if (musicTimer <= 0) {
        musicTimer = 0.42;
        const f = BASS[musicStep % BASS.length]; musicStep += 1;
        tone(f, 0.4, 'triangle', 0.12);
        if (musicStep % 4 === 0) tone(f * 2, 0.2, 'sine', 0.05);
      }
    },
    blip() { tone(880, 0.12, 'sine', 0.18); tone(1320, 0.14, 'sine', 0.12, 0.07); },
    thud() { tone(120, 0.15, 'square', 0.2); tone(70, 0.2, 'sine', 0.22); },
    crash() { tone(90, 0.25, 'sawtooth', 0.2); tone(55, 0.3, 'square', 0.15, 0.05); },
    horn() { tone(233, 0.3, 'square', 0.12); tone(294, 0.3, 'square', 0.1); },
    jingle() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.18, i * 0.09)); },
    busted() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.12, i * 0.13)); },
  };
}

export { THREE };
