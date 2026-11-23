// VICE SHORES — boot and the one loop: fixed 1/60 s steps, four screens
// (title, play, paused, over), a mission-complete overlay, save/continue,
// synthesized sound, and the ?shot= staging the screenshot scenes use
// (start / play / end, seeded, window.__shotReady when the scene is set).
import { STEP, SAVE_KEY, BEST_KEY, MISSIONS, formatCash } from './core.js';
import { createRandom } from './core.js';
import { createWorld, EVENT_PICKUP, EVENT_MISSION, EVENT_BUSTED, EVENT_WASTED, EVENT_CRIME, EVENT_PUNCH, EVENT_CRASH, EVENT_HEAL } from './world.js';
import { ACTION_CONFIRM, ACTION_PAUSE, ACTION_HORN, ACTION_MUTE, createInput, createAudio } from './core.js';
import { createRenderer } from './render.js';

const MAX_FRAME = 0.25;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas, world);
const audio = createAudio();

const screens = {
  title: document.getElementById('titleScreen'),
  pause: document.getElementById('pauseScreen'),
  over: document.getElementById('overScreen'),
  done: document.getElementById('doneScreen'),
};
const toastEl = document.getElementById('toast');
let toastTimer = null;

function show(name) {
  for (const [key, el] of Object.entries(screens)) el.classList.toggle('hidden', key !== name);
  if (!name) for (const el of Object.values(screens)) el.classList.add('hidden');
}
function announce(message) { statusEl.textContent = message; }
function toast(message, ms = 2600) {
  toastEl.textContent = message;
  toastEl.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, ms);
}

// An input with no keys held, used by the title screen and the shot scenes.
// camYaw always rides along: on-foot movement is relative to the camera.
function idleInput() {
  return { forward: 0, strafe: 0, run: false, actions: 0, camYaw: world.state.player.heading };
}

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function readBest() {
  try { return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0; }
  catch { return 0; }
}
function writeSave() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(world.save()));
    window.localStorage.setItem(BEST_KEY, String(Math.max(readBest(), world.state.best)));
  } catch { /* private mode: the save lasts this visit only */ }
}

// Translate a step's event bits into sounds, toasts and screen changes.
// Returns the screen to switch to ('done' / 'over'), or null to keep playing.
function handleEvents(events) {
  const st = world.state;
  if (events & EVENT_PICKUP) { audio.blip(); toast('+$25 cash bag'); }
  if (events & EVENT_HEAL) { audio.blip(); toast('+50 health'); }
  if (events & EVENT_CRIME) { toast(st.wanted >= 3 ? '★ ★ ★ MAXIMUM HEAT' : 'The cops saw that! Wanted up.', 1800); }
  if (events & EVENT_PUNCH) audio.thud();
  if (events & EVENT_CRASH) audio.crash();
  if (events & EVENT_MISSION) {
    audio.jingle();
    const next = world.currentMission();
    const finished = st.storyDone;
    document.getElementById('doneTitle').textContent = finished ? 'STORY COMPLETE' : 'MISSION COMPLETE';
    document.getElementById('doneText').textContent = finished
      ? `You ran every job Rico had. Vice Shores is yours — total cash ${formatCash(st.cash)}. Free roam: grab cash bags, dodge the PD.`
      : `Nice work, Jax. Next: ${next ? next.title : 'free roam'}.`;
    writeSave();
    return 'done';
  }
  if (events & EVENT_BUSTED) {
    audio.busted();
    document.getElementById('overTitle').textContent = 'BUSTED';
    document.getElementById('overStats').textContent =
      `The Vice Shores PD caught you. You lost 15% of your cash. Missions done: ${st.stats.missions} · Cash: ${formatCash(st.cash)}.`;
    writeSave();
    return 'over';
  }
  if (events & EVENT_WASTED) {
    audio.busted();
    document.getElementById('overTitle').textContent = 'WASTED';
    document.getElementById('overStats').textContent =
      `You got wrecked and woke up at the hospital. Missions done: ${st.stats.missions} · Cash: ${formatCash(st.cash)}.`;
    writeSave();
    return 'over';
  }
  return null;
}

// ------------------------------------------------------------ shot mode -----
// The three staged scenes screenshots use: the title over a living city,
// a drive through town, and the first mission's pay-off.
function runShot(name) {
  const save0 = readSave();
  document.getElementById('continueBtn').classList.toggle('hidden', !save0 || (save0.missionIndex === 0 && save0.cash === 0));
  if (name === 'play' || name === 'end') {
    show(null);
    const p = world.state.player;
    const car = world.state.parked[0];
    car.driven = true;
    p.car = car; p.onFoot = false;
    p.x = car.x; p.z = car.z; p.heading = car.heading;
    const seconds = name === 'play' ? 22 : 150;
    for (let i = 0; i < seconds / STEP; i += 1) {
      const ev = world.step(STEP, world.autoInput());
      if (name === 'end' && (ev & EVENT_MISSION)) break;
    }
    if (name === 'end') {
      document.getElementById('doneTitle').textContent = 'MISSION COMPLETE';
      document.getElementById('doneText').textContent = 'Nice work, Jax. Rico paid $100. Next: Borrow a Ride.';
      show('done');
    }
  } else {
    show('title');
    for (let i = 0; i < 5 / STEP; i += 1) world.step(STEP, idleInput());
  }
  let painted = 0;
  function paint() {
    renderer.draw(name === 'start');
    painted += 1;
    if (painted < 40) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

// ------------------------------------------------------------ live game -----
function runGame() {
  const input = createInput(canvas);
  let screen = 'title';
  let save = readSave();
  let accumulator = 0;
  let last = performance.now();
  let saveTimer = 0;

  const continueBtn = document.getElementById('continueBtn');
  if (!save || (save.missionIndex === 0 && save.cash === 0)) continueBtn.classList.add('hidden');
  else continueBtn.textContent = `CONTINUE — ${formatCash(save.cash || 0)} · Mission ${(save.missionIndex || 0) + 1}/${MISSIONS.length}`;

  audio.setMuted(false);
  show('title');
  announce('Vice Shores. Press Enter or tap New Game to start.');

  document.getElementById('newBtn').addEventListener('click', () => { audio.unlock(); startGame(null); });
  continueBtn.addEventListener('click', () => { audio.unlock(); startGame(readSave()); });
  document.getElementById('resumeBtn').addEventListener('click', () => { screen = 'play'; show(null); announce('Playing.'); });
  document.getElementById('restartBtn').addEventListener('click', () => { startGame(null); });
  document.getElementById('quitBtn').addEventListener('click', () => { screen = 'title'; show('title'); writeSave(); });
  document.getElementById('againBtn').addEventListener('click', () => { startGame(null); });
  document.getElementById('overTitleBtn').addEventListener('click', () => { screen = 'title'; show('title'); });
  document.getElementById('doneBtn').addEventListener('click', () => { screen = 'play'; show(null); });
  canvas.addEventListener('pointerdown', () => { if (screen === 'title') audio.unlock(); });
  // R restarts the current job from the spawn. It is not part of the shared
  // input map, so it gets its own listener here instead of a new action bit.
  window.addEventListener('keydown', (ev) => {
    if (ev.code === 'KeyR' && screen === 'play') {
      world.resetMission();
      renderer.resetCamera();
      toast('Mission restarted — back to the start.', 1800);
      announce(`Mission restarted: ${world.currentMission()?.title ?? 'free roam'}.`);
    }
  });

  function startGame(saveData) {
    world.reset(saveData);
    renderer.resetCamera();
    accumulator = 0;
    screen = 'play';
    show(null);
    save = saveData;
    announce(`Playing. Mission 1: ${world.currentMission()?.title ?? 'free roam'}.`);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const look = input.takeLook();
    if (look.dx || look.dy) renderer.addLook(look.dx, look.dy);
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) {
      audio.setMuted(!audio.isMuted());
      toast(audio.isMuted() ? 'Sound off' : 'Sound on', 1200);
    }
    if (screen === 'title' && (actions & ACTION_CONFIRM)) { audio.unlock(); startGame(save && (save.missionIndex > 0 || save.cash > 0) ? save : null); }
    else if (screen === 'play' && (actions & ACTION_PAUSE)) { screen = 'pause'; show('pause'); announce('Paused.'); }
    else if (screen === 'pause' && (actions & (ACTION_PAUSE | ACTION_CONFIRM))) { screen = 'play'; show(null); announce('Playing.'); }
    else if (screen === 'over' && (actions & ACTION_CONFIRM)) startGame(null);
    else if (screen === 'done' && (actions & ACTION_CONFIRM)) { screen = 'play'; show(null); }

    if (screen === 'play') {
      if (actions & ACTION_HORN) audio.horn();
      let pending = actions;
      while (accumulator >= STEP) {
        const ev = world.step(STEP, { forward: input.forward(), strafe: input.strafe(), run: input.run(), actions: pending, camYaw: renderer.yaw() });
        pending = 0;
        accumulator -= STEP;
        const next = handleEvents(ev);
        if (next) { screen = next; show(next); accumulator = 0; break; }
      }
      if (world.state.notice) { toast(world.state.notice); world.state.notice = ''; }
      saveTimer += 1 / 60;
      if (saveTimer > 5) { saveTimer = 0; writeSave(); }
      const p = world.state.player;
      audio.update(1 / 60, p.onFoot ? 0 : Math.abs(p.car?.speed || 0) / 30, world.state.wanted);
    } else if (screen === 'title') {
      while (accumulator >= STEP) {
        world.step(STEP, idleInput());
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(screen === 'title');
  }
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
