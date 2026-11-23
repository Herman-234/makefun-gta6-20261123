// Boot and the one loop: fixed 1/60 s steps, four screens (title, play, paused, over),
// a mission-complete overlay, save/continue, synthesized sound, and the ?shot= staging
// the screenshot scenes use (start / play / end, seeded, window.__shotReady when done).
import { STEP, SAVE_KEY, BEST_KEY, MISSIONS } from './core.js';
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
const status = document.getElementById('status');
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
function announce(message) { status.textContent = message; }
function toast(message, ms = 2600) {
  toastEl.textContent = message;
  toastEl.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, ms);
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

function handleEvents(events) {
  const st = world.state;
  if (events & EVENT_PICKUP) { audio.blip(); toast('+$25 cash bag'); }
  if (events & EVENT_HEAL) { audio.blip(); toast('+50 health'); }
  if (events & EVENT_CRIME) { toast(st.wanted >= 3 ? '★ ★ ★ MAXIMUM HEAT' : 'The cops saw that! Wanted up.', 1800); }
  if (events & EVENT_PUNCH) audio.thud();
  if (events & EVENT_CRASH) audio.crash();
  if (events & EVENT_MISSION) {
    audio.jingle();
    const done = world.currentMission();
    const finished = st.storyDone;
    document.getElementById('doneTitle').textContent = finished ? 'STORY COMPLETE' : 'MISSION COMPLETE';
    document.getElementById('doneText').textContent = finished
      ? `You ran every job Rico had. Vice Shores is yours — total cash $${st.cash.toLocaleString('en-US')}. Free roam: grab cash bags, dodge the PD.`
      : `Nice work, Jax. Next: ${done ? done.title : 'free roam'}.`;
    writeSave();
    return 'done';
  }
  if (events & EVENT_BUSTED) {
    audio.busted();
    document.getElementById('overTitle').textContent = 'BUSTED';
    document.getElementById('overStats').textContent =
      `The Vice Shores PD caught you. You lost 15% of your cash. Missions done: ${st.stats.missions} · Cash: $${st.cash.toLocaleString('en-US')}.`;
    writeSave();
    return 'over';
  }
  if (events & EVENT_WASTED) {
    audio.busted();
    document.getElementById('overTitle').textContent = 'WASTED';
    document.getElementById('overStats').textContent =
      `You got wrecked and woke up at the hospital. Missions done: ${st.stats.missions} · Cash: $${st.cash.toLocaleString('en-US')}.`;
    writeSave();
    return 'over';
  }
  return null;
}

// ------------------------------------------------------------ shot mode -----
function runShot(name) {
  const input = { forward: 0, strafe: 0, run: false, actions: 0 };
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
      const auto = world.autoInput();
      const ev = world.step(STEP, auto);
      if (name === 'end' && (ev & EVENT_MISSION)) break;
    }
    if (name === 'end') {
      document.getElementById('doneTitle').textContent = 'MISSION COMPLETE';
      document.getElementById('doneText').textContent = 'Nice work, Jax. Rico paid $100. Next: Borrow a Ride.';
      show('done');
    }
  } else {
    show('title');
    for (let i = 0; i < 5 / STEP; i += 1) world.step(STEP, input);
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
  else continueBtn.textContent = `CONTINUE — $${(save.cash || 0).toLocaleString('en-US')} · Mission ${(save.missionIndex || 0) + 1}/${MISSIONS.length}`;

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
      let pending = actions;
      while (accumulator >= STEP) {
        const ev = world.step(STEP, { forward: input.forward(), strafe: input.strafe(), run: input.run(), actions: pending });
        pending = 0;
        accumulator -= STEP;
        if (pending === 0 && (actions & ACTION_HORN)) audio.horn();
        const next = handleEvents(ev);
        if (next) { screen = next; show(next); accumulator = 0; break; }
      }
      saveTimer += 1 / 60;
      if (saveTimer > 5) { saveTimer = 0; writeSave(); }
      const p = world.state.player;
      audio.update(1 / 60, p.onFoot ? 0 : Math.abs(p.car?.speed || 0) / 30, world.state.wanted);
    } else if (screen === 'title') {
      while (accumulator >= STEP) {
        world.step(STEP, { forward: 0, strafe: 0, run: false, actions: 0 });
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
