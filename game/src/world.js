// The simulation: a seeded procedural city, on-foot and driving movement, traffic,
// pedestrians, police and the wanted system, six story missions, pickups, combat and save.
// No drawing and no browser calls here: render.js paints this state.
import {
  CITY, PLAYER, CAR, TRAFFIC_COUNT, PED_COUNT, POLICE_MAX,
  WANTED_DECAY_SECONDS, BUST_LOSS, WASTED_LOSS, MISSIONS, PALETTE,
} from './core.js';

export const EVENT_NONE = 0;
export const EVENT_PICKUP = 1;
export const EVENT_MISSION = 2;
export const EVENT_BUSTED = 4;
export const EVENT_WASTED = 8;
export const EVENT_CRIME = 16;
export const EVENT_PUNCH = 32;
export const EVENT_CRASH = 64;
export const EVENT_HEAL = 128;

const TAU = Math.PI * 2;

function roadLines() {
  const lines = [];
  for (let i = -3; i <= 3; i += 1) lines.push(i * CITY.pitch);
  return lines;
}

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return a + d * t;
}

export function createWorld(random) {
  const lines = roadLines();
  const state = {
    elapsed: 0,
    clockMinutes: 18 * 60 + 20,
    cash: 0,
    best: 0,
    health: PLAYER.health,
    wanted: 0,
    crimeTimer: 0,
    lastDamage: -99,
    missionIndex: 0,
    missionTimer: 0,
    missionClean: 0,
    storyDone: false,
    player: { x: 0, z: 120, y: 0, vy: 0, heading: Math.PI, speed: 0, onFoot: true, car: null, punchTimer: 0, punchCooldown: 0 },
    buildings: [],
    lamps: [],
    palms: [],
    parked: [],
    traffic: [],
    police: [],
    peds: [],
    pickups: [],
    beacon: { x: 150, z: 218, active: true },
    stats: { stolen: 0, missions: 0, busted: 0, wasted: 0 },
  };

  // ------------------------------------------------------------ city gen ----
  function buildCity() {
    for (let bx = -3; bx < 3; bx += 1) {
      for (let bz = -3; bz < 3; bz += 1) {
        const cx = (bx + 0.5) * CITY.pitch;
        const cz = (bz + 0.5) * CITY.pitch;
        if (cz > 160) continue; // beach blocks stay open
        const count = 1 + Math.floor(random() * 3);
        for (let k = 0; k < count; k += 1) {
          const w = 10 + random() * 9;
          const d = 10 + random() * 9;
          const distC = Math.hypot(cx, cz) / 220;
          const h = 8 + random() * 14 + (1 - distC) * 22;
          const ox = (random() - 0.5) * (CITY.block - w - 6);
          const oz = (random() - 0.5) * (CITY.block - d - 6);
          const color = PALETTE.building[Math.floor(random() * PALETTE.building.length)];
          state.buildings.push({ x: cx + ox, z: cz + oz, w, d, h, color });
        }
      }
    }
    for (const lx of lines) {
      for (let z = -180; z <= 180; z += 29) {
        if (Math.abs(z) < 10) continue;
        state.lamps.push({ x: lx + CITY.roadHalf + 1.5, z });
        state.lamps.push({ x: -lx - CITY.roadHalf - 1.5, z: z + 14 });
      }
    }
    for (let i = 0; i < 26; i += 1) {
      state.palms.push({ x: -200 + random() * 400, z: 178 + random() * 16, s: 0.8 + random() * 0.5 });
    }
    for (let i = 0; i < 10; i += 1) {
      state.palms.push({ x: -200 + random() * 400, z: -200 + random() * 396, s: 0.7 + random() * 0.4 });
    }
  }

  function collideCircle(x, z, r) {
    for (const b of state.buildings) {
      const nx = Math.max(b.x - b.w / 2, Math.min(x, b.x + b.w / 2));
      const nz = Math.max(b.z - b.d / 2, Math.min(z, b.z + b.d / 2));
      const dx = x - nx, dz = z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2);
          return { x: nx + (dx / d) * r, z: nz + (dz / d) * r, hit: true, nx: dx / d, nz: dz / d };
        }
        return { x: x + r, z, hit: true, nx: 1, nz: 0 };
      }
    }
    return { x, z, hit: false, nx: 0, nz: 0 };
  }

  function nearestRoad(x, z) {
    let best = null, bd = 1e9;
    for (const lx of lines) {
      const d = Math.abs(x - lx);
      if (d < bd) { bd = d; best = { axis: 'x', line: lx, d }; }
      const d2 = Math.abs(z - lx);
      if (d2 < bd) { bd = d2; best = { axis: 'z', line: lx, d: d2 }; }
    }
    return best;
  }

  function spawnEntities() {
    const carColors = [...PALETTE.car];
    for (let i = 0; i < 12; i += 1) {
      const lx = lines[Math.floor(random() * lines.length)];
      const along = -180 + random() * 360;
      const side = random() < 0.5 ? 1 : -1;
      const horiz = random() < 0.5;
      state.parked.push({
        id: i, x: horiz ? along : lx + side * (CITY.roadHalf - 2.5), z: horiz ? lx + side * (CITY.roadHalf - 2.5) : along,
        heading: horiz ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI / 2 : -Math.PI / 2),
        color: carColors[i % carColors.length], driven: false, active: true, speed: 0,
      });
    }
    for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
      const lx = lines[Math.floor(random() * lines.length)];
      const horiz = random() < 0.5;
      state.traffic.push({
        id: i, x: horiz ? -180 + random() * 360 : lx + (random() < 0.5 ? 3.5 : -3.5),
        z: horiz ? lx + (random() < 0.5 ? 3.5 : -3.5) : -180 + random() * 360,
        axis: horiz ? 'x' : 'z', dir: random() < 0.5 ? 1 : -1,
        heading: 0, speed: 10 + random() * 3, color: carColors[(i + 3) % carColors.length],
      });
    }
    for (let i = 0; i < POLICE_MAX; i += 1) {
      state.police.push({ id: i, x: 0, z: 0, heading: 0, speed: 0, active: false, ramCooldown: 0, bustTimer: 0 });
    }
    for (let i = 0; i < PED_COUNT; i += 1) {
      const lx = lines[Math.floor(random() * lines.length)];
      state.peds.push({
        id: i, x: lx + (random() < 0.5 ? 10 : -10), z: -180 + random() * 360,
        heading: random() * TAU, speed: 1.4 + random() * 0.5, tx: 0, tz: 0,
        color: PALETTE.pedShirt[i % PALETTE.pedShirt.length], flee: 0, fall: 0,
      });
      pickPedTarget(state.peds[i]);
    }
    const spots = [[-40, -60], [60, 30], [-120, 90], [120, -120], [0, -150], [-170, 20], [170, 150], [30, -30]];
    spots.forEach(([x, z], i) => state.pickups.push({ id: i, x, z, kind: 'cash', active: true, respawn: 0 }));
    [[-90, -100], [90, 60], [140, -60], [-30, 170]].forEach(([x, z], i) => state.pickups.push({ id: 8 + i, x, z, kind: 'health', active: true, respawn: 0 }));
  }

  function pickPedTarget(p) {
    const lx = lines[Math.floor(random() * lines.length)];
    const lz = lines[Math.floor(random() * lines.length)];
    if (random() < 0.5) { p.tx = lx + (random() < 0.5 ? 10 : -10); p.tz = -180 + random() * 360; }
    else { p.tx = -180 + random() * 360; p.tz = lz + (random() < 0.5 ? 10 : -10); }
  }

  function addCrime(level) {
    state.wanted = Math.min(3, state.wanted + level);
    state.crimeTimer = 0;
    return EVENT_CRIME;
  }

  function currentMission() { return MISSIONS[state.missionIndex] || null; }

  function updateBeacon() {
    const m = currentMission();
    if (!m || state.storyDone) { state.beacon.active = false; return; }
    if (m.target) { state.beacon.x = m.target[0]; state.beacon.z = m.target[1]; state.beacon.active = true; }
    else state.beacon.active = false;
  }

  function completeMission() {
    const m = currentMission();
    if (!m) return EVENT_NONE;
    state.cash += m.reward;
    state.best = Math.max(state.best, state.cash);
    state.stats.missions += 1;
    state.missionIndex += 1;
    state.missionTimer = 0;
    state.missionClean = 0;
    if (state.missionIndex >= MISSIONS.length) state.storyDone = true;
    updateBeacon();
    return EVENT_MISSION;
  }

  function respawnHospital() {
    const p = state.player;
    if (p.car) { p.car.driven = false; p.car = null; }
    p.x = 0; p.z = -185; p.y = 0; p.vy = 0; p.heading = 0; p.speed = 0; p.onFoot = true;
    p.health = PLAYER.health;
    state.wanted = 0;
    state.crimeTimer = 0;
    for (const c of state.police) c.active = false;
  }

  function reset(save) {
    state.elapsed = 0;
    state.cash = save?.cash ?? 0;
    state.missionIndex = save?.missionIndex ?? 0;
    state.best = save?.best ?? 0;
    state.health = PLAYER.health;
    state.wanted = 0;
    state.crimeTimer = 0;
    state.storyDone = state.missionIndex >= MISSIONS.length;
    state.missionTimer = 0;
    state.missionClean = 0;
    const p = state.player;
    p.x = 0; p.z = 120; p.y = 0; p.vy = 0; p.heading = Math.PI; p.speed = 0; p.onFoot = true; p.car = null;
    for (const c of state.parked) c.driven = false;
    for (const c of state.police) c.active = false;
    for (const pk of state.pickups) { pk.active = true; pk.respawn = 0; }
    updateBeacon();
  }

  // -------------------------------------------------------------- step ------
  function step(dt, input) {
    let events = EVENT_NONE;
    state.elapsed += dt;
    state.clockMinutes += dt / 2;
    const p = state.player;
    if (p.punchTimer > 0) p.punchTimer -= dt;
    if (p.punchCooldown > 0) p.punchCooldown -= dt;
    if (state.crimeTimer < 999) state.crimeTimer += dt;

    // wanted decay
    if (state.wanted > 0 && state.crimeTimer > WANTED_DECAY_SECONDS) {
      state.wanted -= 1;
      state.crimeTimer = 0;
    }

    // --- player movement ---
    const fwd = input.forward || 0;
    const str = input.strafe || 0;
    if (p.onFoot) {
      const sp = (input.run ? PLAYER.runSpeed : PLAYER.walkSpeed);
      const mx = Math.sin(p.heading) * fwd + Math.cos(p.heading) * str;
      const mz = Math.cos(p.heading) * fwd - Math.sin(p.heading) * str;
      const len = Math.hypot(mx, mz) || 1;
      const moving = fwd !== 0 || str !== 0;
      if (moving) {
        p.x += (mx / len) * sp * dt;
        p.z += (mz / len) * sp * dt;
        p.heading = Math.atan2(mx, mz);
        p.speed = sp;
      } else p.speed = 0;
      p.x = Math.max(-CITY.bound, Math.min(CITY.bound, p.x));
      p.z = Math.max(-CITY.bound, Math.min(CITY.oceanZ - 8, p.z));
      const col = collideCircle(p.x, p.z, PLAYER.radius);
      p.x = col.x; p.z = col.z;
      if (input.actions & 32 && p.y === 0) { p.vy = PLAYER.jumpSpeed; }
      if (p.y > 0 || p.vy !== 0) {
        p.vy -= 26 * dt; p.y += p.vy * dt;
        if (p.y <= 0) { p.y = 0; p.vy = 0; }
      }
    } else if (p.car) {
      const car = p.car;
      const steer = str * CAR.steer * (car.speed >= 0 ? 1 : -1) * Math.min(1, Math.abs(car.speed) / 8 + 0.25);
      car.heading += steer * (car.speed / CAR.maxSpeed) * 2.2 * dt * (car.speed < 0 ? -1 : 1) * (fwd < 0 ? -1 : 1);
      if (fwd > 0) car.speed = Math.min(CAR.maxSpeed, car.speed + CAR.accel * dt);
      else if (fwd < 0) car.speed = Math.max(-CAR.maxReverse, car.speed - CAR.brake * dt);
      else car.speed *= Math.max(0, 1 - 1.6 * dt);
      car.x += Math.sin(car.heading) * car.speed * dt;
      car.z += Math.cos(car.heading) * car.speed * dt;
      car.x = Math.max(-CITY.bound, Math.min(CITY.bound, car.x));
      car.z = Math.max(-CITY.bound, Math.min(CITY.oceanZ - 8, car.z));
      const before = Math.hypot(car.speed, 0);
      const col = collideCircle(car.x, car.z, 2.2);
      if (col.hit) {
        car.x = col.x; car.z = col.z;
        if (Math.abs(car.speed) > 14 && state.elapsed - state.lastDamage > 1) {
          state.health -= (Math.abs(car.speed) - 14) * 0.8;
          state.lastDamage = state.elapsed;
          events |= EVENT_CRASH;
        }
        car.speed *= 0.45;
      }
      p.x = car.x; p.z = car.z; p.heading = car.heading; p.speed = Math.abs(car.speed);
      void before;
    }

    // --- enter / exit car ---
    if (input.actions & 4) {
      if (p.onFoot) {
        let bestCar = null, bd = 4.5;
        for (const c of state.parked) {
          if (!c.active || c.driven) continue;
          const d = Math.hypot(c.x - p.x, c.z - p.z);
          if (d < bd) { bd = d; bestCar = c; }
        }
        const m = currentMission();
        if (m && m.kind === 'pickup' && Math.hypot(m.target[0] - p.x, m.target[1] - p.z) < 6) {
          events |= completeMission();
        } else if (bestCar) {
          bestCar.driven = true;
          p.car = bestCar; p.onFoot = false; p.speed = 0;
          state.stats.stolen += 1;
          events |= addCrime(1);
          if (m && m.kind === 'steal') events |= completeMission();
        }
      } else if (p.car) {
        const car = p.car;
        car.driven = false; car.speed = 0;
        p.car = null; p.onFoot = true;
        p.x = car.x + Math.cos(car.heading) * 3; p.z = car.z - Math.sin(car.heading) * 3;
        p.heading = car.heading;
      }
    }

    // --- punch ---
    if ((input.actions & 8) && p.onFoot && p.punchCooldown <= 0) {
      p.punchTimer = 0.35; p.punchCooldown = 0.6;
      events |= EVENT_PUNCH;
      for (const ped of state.peds) {
        if (ped.fall > 0) continue;
        const d = Math.hypot(ped.x - p.x, ped.z - p.z);
        if (d < 2.6) {
          const ang = Math.atan2(ped.x - p.x, ped.z - p.z);
          let diff = Math.abs(ang - p.heading);
          if (diff > Math.PI) diff = TAU - diff;
          if (diff < 1.3) {
            ped.fall = 3; ped.flee = 5;
            events |= addCrime(1);
            break;
          }
        }
      }
    }

    // --- horn ---
    if (input.actions & 16) { /* sound only, handled by main */ }

    // --- traffic ---
    for (const t of state.traffic) {
      let ahead = false;
      for (const o of state.traffic) {
        if (o === t) continue;
        const dx = o.x - t.x, dz = o.z - t.z;
        const d = Math.hypot(dx, dz);
        if (d < 9 && d > 0.01) {
          const dot = (dx * Math.sin(t.heading) + dz * Math.cos(t.heading)) / d;
          if (dot > 0.7) { ahead = true; break; }
        }
      }
      const sp = ahead ? 0 : t.speed;
      t.x += Math.sin(t.heading) * sp * dt * t.dir;
      t.z += Math.cos(t.heading) * sp * dt * t.dir;
      t.heading = t.axis === 'x' ? (t.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (t.dir > 0 ? 0 : Math.PI);
      const onLine = t.axis === 'x' ? t.z : t.x;
      const along = t.axis === 'x' ? t.x : t.z;
      if (Math.abs(along % CITY.pitch) < 0.6 && random() < 0.012) {
        if (random() < 0.5) { t.axis = t.axis === 'x' ? 'z' : 'x'; }
        else t.dir = -t.dir;
        const nl = nearestRoad(t.x, t.z);
        if (nl) { if (nl.axis === 'x') t.z = nl.line + (random() < 0.5 ? 3.5 : -3.5); else t.x = nl.line + (random() < 0.5 ? 3.5 : -3.5); }
      }
      void onLine;
      if (t.x > CITY.bound - 8 || t.x < -CITY.bound + 8) t.dir = -t.dir;
      if (t.z > CITY.bound - 8 || t.z < -CITY.bound + 8) t.dir = -t.dir;
    }

    // --- pedestrians ---
    for (const ped of state.peds) {
      if (ped.fall > 0) { ped.fall -= dt; continue; }
      let tx = ped.tx, tz = ped.tz, sp = ped.speed;
      const pd = Math.hypot(ped.x - p.x, ped.z - p.z);
      const carNear = p.car && Math.hypot(p.x - p.car.x, p.z - p.car.z) < 7;
      if (ped.flee > 0 || carNear || pd < 3) {
        ped.flee = Math.max(ped.flee, 1.5);
        tx = p.x + (ped.x - p.x) * 2; tz = p.z + (ped.z - p.z) * 2; sp = 4;
        ped.flee -= dt;
      }
      const dx = tx - ped.x, dz = tz - ped.z;
      const d = Math.hypot(dx, dz);
      if (d < 2) { pickPedTarget(ped); continue; }
      ped.heading = angleLerp(ped.heading, Math.atan2(dx, dz), Math.min(1, 6 * dt));
      ped.x += Math.sin(ped.heading) * sp * dt;
      ped.z += Math.cos(ped.heading) * sp * dt;
      // run over by the player's car
      if (p.car && Math.hypot(ped.x - p.car.x, ped.z - p.car.z) < 2.6 && Math.abs(p.car.speed) > 4 && ped.fall === 0) {
        ped.fall = 3; ped.flee = 5;
        events |= addCrime(1);
      }
    }

    // --- police ---
    const wantPolice = state.wanted > 0 ? Math.min(state.wanted + 1, POLICE_MAX) : 0;
    let activePolice = state.police.filter((c) => c.active).length;
    if (activePolice < wantPolice) {
      for (const c of state.police) {
        if (activePolice >= wantPolice) break;
        if (!c.active) {
          const ang = random() * TAU;
          c.x = Math.max(-190, Math.min(190, p.x + Math.cos(ang) * 70));
          c.z = Math.max(-190, Math.min(190, p.z + Math.sin(ang) * 70));
          c.active = true; c.speed = 0; c.bustTimer = 0; c.ramCooldown = 0;
          activePolice += 1;
        }
      }
    }
    for (const c of state.police) {
      if (!c.active) continue;
      if (state.wanted === 0) { c.active = false; continue; }
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      const targetHeading = Math.atan2(dx, dz);
      c.heading = angleLerp(c.heading, targetHeading, Math.min(1, 3.2 * dt));
      const wantSpeed = 16 + state.wanted * 2;
      c.speed = Math.min(wantSpeed, c.speed + 8 * dt);
      c.x += Math.sin(c.heading) * c.speed * dt;
      c.z += Math.cos(c.heading) * c.speed * dt;
      const col = collideCircle(c.x, c.z, 2.2);
      c.x = col.x; c.z = col.z;
      if (c.ramCooldown > 0) c.ramCooldown -= dt;
      if (d < 3.2) {
        if (p.onFoot) {
          c.bustTimer += dt;
          if (c.bustTimer > 1.2) {
            state.cash = Math.floor(state.cash * (1 - BUST_LOSS));
            state.stats.busted += 1;
            respawnHospital();
            events |= EVENT_BUSTED;
            break;
          }
        } else if (c.ramCooldown <= 0) {
          c.ramCooldown = 1;
          state.health -= 8;
          state.lastDamage = state.elapsed;
          events |= EVENT_CRASH;
          if (p.car) p.car.speed *= 0.7;
        }
      } else c.bustTimer = 0;
    }

    // --- pickups ---
    for (const pk of state.pickups) {
      if (!pk.active) {
        pk.respawn -= dt;
        if (pk.respawn <= 0) pk.active = true;
        continue;
      }
      const d = Math.hypot(pk.x - p.x, pk.z - p.z);
      if (d < 2.8) {
        pk.active = false; pk.respawn = 60;
        if (pk.kind === 'cash') { state.cash += 25; state.best = Math.max(state.best, state.cash); events |= EVENT_PICKUP; }
        else { state.health = Math.min(PLAYER.health, state.health + 50); events |= EVENT_HEAL; }
      }
    }

    // --- health regen / wasted ---
    if (state.elapsed - state.lastDamage > 8 && state.health < PLAYER.health) {
      state.health = Math.min(PLAYER.health, state.health + 2 * dt);
    }
    if (state.health <= 0) {
      state.cash = Math.floor(state.cash * (1 - WASTED_LOSS));
      state.stats.wasted += 1;
      respawnHospital();
      events |= EVENT_WASTED;
    }

    // --- missions ---
    const m = currentMission();
    if (m && !state.storyDone) {
      if (m.kind === 'goto' && m.target) {
        if (Math.hypot(m.target[0] - p.x, m.target[1] - p.z) < 7) events |= completeMission();
      } else if (m.kind === 'clean') {
        if (state.wanted === 0) {
          state.missionClean += dt;
          if (state.missionClean > 5) events |= completeMission();
        } else state.missionClean = 0;
      } else if (m.kind === 'timed' && m.target) {
        if (state.missionTimer === 0) state.missionTimer = m.time;
        state.missionTimer -= dt;
        if (Math.hypot(m.target[0] - p.x, m.target[1] - p.z) < 7) events |= completeMission();
        else if (state.missionTimer <= 0) { state.missionTimer = m.time; state.missionClean = 0; }
      }
    }

    return events;
  }

  // Autopilot input for screenshot staging: steer toward the mission beacon.
  function autoInput() {
    const p = state.player;
    const m = currentMission();
    const t = m && m.target ? m.target : [0, 0];
    const dx = t[0] - p.x, dz = t[1] - p.z;
    const want = Math.atan2(dx, dz);
    let diff = want - p.heading;
    while (diff > Math.PI) diff -= TAU;
    while (diff < -Math.PI) diff += TAU;
    return { forward: 1, strafe: Math.max(-1, Math.min(1, diff * 1.5)), run: false, actions: 0 };
  }

  buildCity();
  spawnEntities();
  reset(null);

  return {
    state, reset, step, autoInput,
    currentMission,
    save() { return { cash: state.cash, missionIndex: state.missionIndex, best: state.best }; },
  };
}
