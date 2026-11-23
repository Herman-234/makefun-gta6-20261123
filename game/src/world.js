// VICE SHORES — the simulation: a procedural coastal city, traffic and
// pedestrians, police AI, the wanted system, six story missions, pickups,
// combat, and the save. Owns every rule; render.js only paints state.
import {
  CITY, PLAYER, CAR, TRAFFIC_COUNT, PED_COUNT, POLICE_MAX,
  WANTED_DECAY_SECONDS, BUST_LOSS, WASTED_LOSS, MISSIONS,
  clamp, angleDiff, dist2d, START_CLOCK_MINUTES,
  ACTION_ENTER, ACTION_PUNCH,
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

const SPAWN = { x: 0, z: 170 };
const ROAD_AT = (i) => i * CITY.pitch;
const BLOCK_AT = (i) => (i + 0.5) * CITY.pitch;

export function createWorld(random) {
  // ---------------------------------------------------------- city layout ----
  // Seeded once: the same seed always builds the same streets.
  const buildings = []; // { x, z, hw, hd, h, color }
  const palms = []; // { x, z, lean }
  const carColors = [0xd94f3d, 0x3d7bd9, 0xe8c33d, 0x37b268, 0xe8e8e8, 0x22242a, 0xd97b2f, 0x7a4fd0];
  const shirtColors = [0xe85d5d, 0x4f8de8, 0x58c96b, 0xe8c33d, 0xb678e8, 0xe8e8e8, 0x2fae9e];

  function buildCity() {
    for (let bx = -3; bx <= 2; bx += 1) {
      for (let bz = -3; bz <= 2; bz += 1) {
        const cx = BLOCK_AT(bx), cz = BLOCK_AT(bz);
        if (cz > 170) continue; // the last row is beach, not towers
        const roll = random();
        if (roll < 0.62) {
          buildings.push({
            x: cx, z: cz,
            hw: 13 + random() * 5, hd: 13 + random() * 5,
            h: 10 + random() * 28,
            color: [0xd96a5f, 0xe8a34c, 0x5f8fd9, 0x7bc47f, 0xc9a86a, 0x9a7fd0, 0x6fb3d8, 0xe07f9a][Math.floor(random() * 8)],
          });
        } else if (roll < 0.8) {
          for (let k = 0; k < 3; k += 1) {
            palms.push({ x: cx + (random() - 0.5) * 30, z: cz + (random() - 0.5) * 30, lean: (random() - 0.5) * 0.4 });
          }
        }
      }
    }
    // A palm line along the sand so the beach reads as a beach.
    for (let x = -180; x <= 180; x += 24) {
      palms.push({ x: x + (random() - 0.5) * 8, z: 202 + random() * 10, lean: (random() - 0.5) * 0.3 });
    }
  }

  // ---------------------------------------------------------------- state ----
  const state = {
    player: { x: SPAWN.x, z: SPAWN.z, y: 0, vy: 0, heading: Math.PI, speed: 0, onFoot: true, car: null, health: PLAYER.health },
    parked: [], // { x, z, heading, color, driven, owned, speed }
    traffic: [], // { x, z, heading, speed, color, axis, line, dir }
    peds: [], // { x, z, heading, speed, shirt, down, seed }
    police: [], // { x, z, heading, speed }
    pickups: [], // { x, z, kind }
    package: { x: -160, z: -180, taken: false, visible: false },
    missionIndex: 0,
    cash: 0,
    wanted: 0,
    wantedTimer: 0,
    missionTime: 0,
    storyDone: false,
    best: 0,
    stats: { missions: 0, stolen: 0, busted: 0 },
    clockMinutes: START_CLOCK_MINUTES,
    crashCooldown: 0,
    bustTimer: 0,
  };

  function scatterPickup(kind) {
    const onRoad = random() < 0.6;
    let x, z;
    if (onRoad) {
      const horizontal = random() < 0.5;
      const line = ROAD_AT(Math.floor(random() * 7) - 3);
      const along = (random() * 2 - 1) * 180;
      x = horizontal ? along : line + (random() - 0.5) * 8;
      z = horizontal ? line + (random() - 0.5) * 8 : along;
    } else {
      x = (random() * 2 - 1) * 180;
      z = (random() * 2 - 1) * 180;
    }
    return { x, z: clamp(z, -195, 205), kind };
  }

  function spawnEntities() {
    state.parked = [];
    for (let i = 0; i < 8; i += 1) {
      const horizontal = random() < 0.5;
      const line = ROAD_AT(Math.floor(random() * 7) - 3);
      const along = (random() * 2 - 1) * 170;
      state.parked.push({
        x: horizontal ? along : line + (random() < 0.5 ? -5 : 5),
        z: horizontal ? line + (random() < 0.5 ? -5 : 5) : along,
        heading: horizontal ? (random() < 0.5 ? 0 : Math.PI) : (random() < 0.5 ? Math.PI / 2 : -Math.PI / 2),
        color: carColors[Math.floor(random() * carColors.length)],
        driven: false, owned: false, speed: 0,
      });
    }
    // The first parked car waits near the spawn, so the opening drive is quick.
    state.parked[0].x = 14; state.parked[0].z = 158; state.parked[0].heading = Math.PI;
    state.traffic = [];
    for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
      const axis = random() < 0.5 ? 'x' : 'z';
      const line = ROAD_AT(Math.floor(random() * 7) - 3);
      const dir = random() < 0.5 ? 1 : -1;
      state.traffic.push({
        axis, line, dir,
        x: axis === 'x' ? (random() * 2 - 1) * 200 : line + dir * 3.2,
        z: axis === 'z' ? (random() * 2 - 1) * 200 : line + dir * 3.2,
        heading: axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI),
        speed: 8 + random() * 6,
        color: carColors[Math.floor(random() * carColors.length)],
      });
    }
    state.peds = [];
    for (let i = 0; i < PED_COUNT; i += 1) {
      state.peds.push({
        x: (random() * 2 - 1) * 180,
        z: (random() * 2 - 1) * 180,
        heading: random() * Math.PI * 2,
        speed: 1.2 + random() * 1.0,
        shirt: shirtColors[Math.floor(random() * shirtColors.length)],
        down: 0,
        seed: random() * 10,
      });
    }
    state.pickups = [];
    for (let i = 0; i < 6; i += 1) state.pickups.push(scatterPickup('cash'));
    for (let i = 0; i < 3; i += 1) state.pickups.push(scatterPickup('health'));
    state.police = [];
  }

  // ------------------------------------------------------------- collisions ----
  // Push a circle out of every building box it overlaps. Returns true on a hit.
  function collideBuildings(p, radius) {
    let hit = false;
    for (const b of buildings) {
      const dx = p.x - b.x, dz = p.z - b.z;
      const ox = b.hw + radius - Math.abs(dx);
      const oz = b.hd + radius - Math.abs(dz);
      if (ox > 0 && oz > 0) {
        hit = true;
        if (ox < oz) p.x = b.x + Math.sign(dx || 1) * (b.hw + radius);
        else p.z = b.z + Math.sign(dz || 1) * (b.hd + radius);
      }
    }
    return hit;
  }

  function insideBuilding(x, z, radius) {
    for (const b of buildings) {
      if (Math.abs(x - b.x) < b.hw + radius && Math.abs(z - b.z) < b.hd + radius) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ rules ----
  function addCrime() {
    state.wanted = Math.min(3, state.wanted + 1);
    state.wantedTimer = WANTED_DECAY_SECONDS;
    return EVENT_CRIME;
  }

  function currentMission() {
    return state.storyDone ? null : MISSIONS[state.missionIndex];
  }

  function completeMission() {
    const m = currentMission();
    if (!m) return EVENT_NONE;
    state.cash += m.reward;
    state.stats.missions += 1;
    state.best = Math.max(state.best, state.cash);
    state.missionIndex += 1;
    const next = currentMission();
    state.missionTime = next && next.time ? next.time : 0;
    if (!next) state.storyDone = true;
    return EVENT_MISSION;
  }

  function nearestParked(maxDist) {
    const p = state.player;
    let bestCar = null, bestD = maxDist;
    for (const car of state.parked) {
      const d = dist2d(p.x, p.z, car.x, car.z);
      if (d < bestD) { bestD = d; bestCar = car; }
    }
    return bestCar;
  }

  function enterCar() {
    const p = state.player;
    if (!p.onFoot) {
      // Step out beside the car, facing the same way it does.
      const car = p.car;
      p.onFoot = true; p.car = null; p.speed = 0;
      p.x = car.x + Math.cos(car.heading) * 2.2;
      p.z = car.z - Math.sin(car.heading) * 2.2;
      p.heading = car.heading;
      car.speed = 0;
      return EVENT_NONE;
    }
    const car = nearestParked(3.5);
    if (!car) return EVENT_NONE;
    p.car = car; p.onFoot = false; p.speed = 0;
    p.x = car.x; p.z = car.z; p.heading = car.heading;
    let ev = EVENT_NONE;
    if (!car.owned) {
      car.owned = true;
      state.stats.stolen += 1;
      ev |= addCrime();
    }
    car.driven = true;
    if (currentMission() && currentMission().kind === 'steal') ev |= completeMission();
    return ev;
  }

  function punch() {
    const p = state.player;
    if (!p.onFoot) return EVENT_NONE;
    let ev = EVENT_NONE;
    for (const ped of state.peds) {
      if (ped.down > 0) continue;
      if (dist2d(p.x, p.z, ped.x, ped.z) < 2.6) {
        ped.down = 3;
        ped.heading = p.heading;
        ev |= EVENT_PUNCH | addCrime();
        break;
      }
    }
    return ev;
  }

  // -------------------------------------------------------------- simulation ----
  function updatePlayer(dt, input) {
    const p = state.player;
    if (p.onFoot) {
      const fx = Math.sin(input.camYaw), fz = Math.cos(input.camYaw);
      const rx = Math.cos(input.camYaw), rz = -Math.sin(input.camYaw);
      let mx = fx * input.forward + rx * input.strafe;
      let mz = fz * input.forward + rz * input.strafe;
      const len = Math.hypot(mx, mz);
      if (len > 0.01) {
        mx /= len; mz /= len;
        const targetHeading = Math.atan2(mx, mz);
        p.heading += angleDiff(p.heading, targetHeading) * Math.min(1, dt * 10);
      }
      const target = input.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
      const want = len > 0.01 ? target : 0;
      p.speed += (want - p.speed) * Math.min(1, dt * 8);
      p.x += mx * p.speed * dt;
      p.z += mz * p.speed * dt;
      if (input.actions & 32 /* ACTION_JUMP */ && p.y <= 0.01) p.vy = PLAYER.jumpSpeed;
      p.vy -= 22 * dt;
      p.y = Math.max(0, p.y + p.vy * dt);
      if (p.y === 0) p.vy = 0;
      collideBuildings(p, PLAYER.radius);
    } else {
      const car = p.car;
      const fwd = input.forward;
      if (fwd > 0) car.speed += CAR.accel * dt;
      else if (fwd < 0) car.speed -= (car.speed > 0.5 ? CAR.brake : CAR.accel * 0.6) * dt;
      else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 8 * dt);
      car.speed = clamp(car.speed, -CAR.maxReverse, CAR.maxSpeed);
      car.heading += input.strafe * CAR.steer * 2.2 * (car.speed / CAR.maxSpeed) * dt;
      p.heading = car.heading;
      p.speed = Math.abs(car.speed);
      const nx = car.x + Math.sin(car.heading) * car.speed * dt;
      const nz = car.z + Math.cos(car.heading) * car.speed * dt;
      const probe = { x: nx, z: nz };
      if (collideBuildings(probe, 1.6)) {
        if (Math.abs(car.speed) > 8 && state.crashCooldown <= 0) {
          state.crashCooldown = 0.6;
          p.health = Math.max(0, p.health - 6);
          car.speed *= -0.25;
        } else {
          car.speed *= 0.4;
        }
        car.x = probe.x; car.z = probe.z;
      } else {
        car.x = nx; car.z = nz;
      }
      p.x = car.x; p.z = car.z;
      // Running a pedestrian over is a crime, and it slows the car.
      for (const ped of state.peds) {
        if (ped.down > 0) continue;
        if (Math.abs(car.speed) > 3 && dist2d(car.x, car.z, ped.x, ped.z) < 2.4) {
          ped.down = 4;
          ped.x += Math.sin(car.heading) * 3;
          ped.z += Math.cos(car.heading) * 3;
          car.speed *= 0.55;
        }
      }
      // Bumping traffic costs speed and paint.
      for (const t of state.traffic) {
        if (Math.abs(car.speed) > 4 && dist2d(car.x, car.z, t.x, t.z) < 3.4 && state.crashCooldown <= 0) {
          state.crashCooldown = 0.6;
          car.speed *= 0.5;
          p.health = Math.max(0, p.health - 4);
        }
      }
    }
    p.x = clamp(p.x, -CITY.bound, CITY.bound);
    p.z = clamp(p.z, -CITY.bound, 250);
  }

  function updateTraffic(dt) {
    for (const t of state.traffic) {
      if (t.axis === 'x') {
        t.x += t.dir * t.speed * dt;
        if (t.x > 205) t.x = -205;
        if (t.x < -205) t.x = 205;
        t.z = t.line + t.dir * 3.2;
      } else {
        t.z += t.dir * t.speed * dt;
        if (t.z > 205) t.z = -205;
        if (t.z < -205) t.z = 205;
        t.x = t.line + t.dir * 3.2;
      }
    }
  }

  function updatePeds(dt, tNow) {
    for (const ped of state.peds) {
      if (ped.down > 0) { ped.down -= dt; continue; }
      if (random() < dt * 0.25) ped.heading += (random() - 0.5) * 2.4;
      const nx = ped.x + Math.sin(ped.heading) * ped.speed * dt;
      const nz = ped.z + Math.cos(ped.heading) * ped.speed * dt;
      if (Math.abs(nx) > 200 || nz > 192 || nz < -200 || insideBuilding(nx, nz, 0.6)) {
        ped.heading += Math.PI * (0.7 + random() * 0.6);
      } else {
        ped.x = nx; ped.z = nz;
      }
      ped.seed = tNow;
    }
  }

  function updatePolice(dt) {
    const p = state.player;
    const want = state.wanted > 0 ? Math.min(state.wanted + 1, POLICE_MAX) : 0;
    while (state.police.length < want) {
      const a = random() * Math.PI * 2;
      const d = 45 + random() * 15;
      state.police.push({
        x: clamp(p.x + Math.sin(a) * d, -200, 200),
        z: clamp(p.z + Math.cos(a) * d, -200, 200),
        heading: a, speed: 0,
      });
    }
    if (state.police.length > want) state.police.length = want;
    let events = EVENT_NONE;
    for (const cop of state.police) {
      const target = Math.atan2(p.x - cop.x, p.z - cop.z);
      cop.heading += angleDiff(cop.heading, target) * Math.min(1, dt * 2.5);
      const top = 22 + state.wanted * 2;
      cop.speed += (top - cop.speed) * Math.min(1, dt * 1.5);
      cop.x += Math.sin(cop.heading) * cop.speed * dt;
      cop.z += Math.cos(cop.heading) * cop.speed * dt;
      collideBuildings(cop, 1.6);
      const d = dist2d(cop.x, cop.z, p.x, p.z);
      if (p.onFoot && d < 2.6) {
        state.bustTimer += dt;
        if (state.bustTimer > 0.8) {
          state.bustTimer = 0;
          state.cash = Math.round(state.cash * (1 - BUST_LOSS));
          state.stats.busted += 1;
          state.wanted = 0;
          state.police = [];
          state.player.health = PLAYER.health;
          state.player.onFoot = true; state.player.car = null;
          state.player.x = SPAWN.x; state.player.z = SPAWN.z; state.player.heading = Math.PI;
          return EVENT_BUSTED;
        }
      } else if (!p.onFoot && d < 3.4) {
        cop.x -= Math.sin(cop.heading) * 4;
        cop.z -= Math.cos(cop.heading) * 4;
        p.health = Math.max(0, p.health - 8);
        events |= EVENT_CRASH;
      } else {
        state.bustTimer = Math.max(0, state.bustTimer - dt);
      }
    }
    return events;
  }

  function updatePickups() {
    const p = state.player;
    let events = EVENT_NONE;
    for (const pk of state.pickups) {
      if (dist2d(p.x, p.z, pk.x, pk.z) < 2.2) {
        if (pk.kind === 'cash') { state.cash += 25; state.best = Math.max(state.best, state.cash); events |= EVENT_PICKUP; }
        else { p.health = Math.min(PLAYER.health, p.health + 50); events |= EVENT_HEAL; }
        const next = scatterPickup(pk.kind);
        pk.x = next.x; pk.z = next.z;
      }
    }
    return events;
  }

  function updateMission(dt) {
    const m = currentMission();
    if (!m) return EVENT_NONE;
    const p = state.player;
    state.package.visible = m.kind === 'pickup' && !state.package.taken;
    if (state.package.visible) { state.package.x = m.target[0]; state.package.z = m.target[1]; }
    if (m.kind === 'goto' || m.kind === 'timed') {
      if (dist2d(p.x, p.z, m.target[0], m.target[1]) < 7) return completeMission();
    }
    if (m.kind === 'clean' && state.wanted === 0) return completeMission();
    if (m.kind === 'timed') {
      state.missionTime -= dt;
      if (state.missionTime <= 0) {
        // Out of time: the clock restarts, Rico lets you try again, and the
        // notice below is picked up by the HUD as a toast (main.js polls
        // state.notice once per frame and clears it after showing it).
        state.missionTime = m.time;
        state.notice = 'Too slow — Rico gives you another shot. Clock reset.';
      }
    }
    return EVENT_NONE;
  }

  // -------------------------------------------------------------- public ----
  function step(dt, input) {
    let events = EVENT_NONE;
    state.clockMinutes += dt;
    state.crashCooldown = Math.max(0, state.crashCooldown - dt);
    if (input.actions & ACTION_ENTER) {
      if (currentMission() && currentMission().kind === 'pickup' && state.package.visible
        && dist2d(state.player.x, state.player.z, state.package.x, state.package.z) < 3) {
        state.package.taken = true;
        state.package.visible = false;
        events |= completeMission();
      } else {
        events |= enterCar();
      }
    }
    if (input.actions & ACTION_PUNCH) events |= punch();
    updatePlayer(dt, input);
    updateTraffic(dt);
    updatePeds(dt, state.clockMinutes);
    events |= updatePolice(dt);
    events |= updatePickups();
    events |= updateMission(dt);
    // Heat fades: 18 quiet seconds cost one star, then the timer re-arms.
    if (state.wanted > 0) {
      state.wantedTimer -= dt;
      if (state.wantedTimer <= 0) {
        state.wanted -= 1;
        state.wantedTimer = state.wanted > 0 ? WANTED_DECAY_SECONDS : 0;
      }
    }
    // A slow breather when nobody is chasing.
    if (state.wanted === 0 && state.player.health < PLAYER.health) {
      state.player.health = Math.min(PLAYER.health, state.player.health + dt * 1.5);
    }
    if (state.player.health <= 0) {
      state.cash = Math.round(state.cash * (1 - WASTED_LOSS));
      state.player.health = PLAYER.health;
      state.wanted = 0;
      state.police = [];
      state.player.onFoot = true; state.player.car = null;
      state.player.x = SPAWN.x; state.player.z = SPAWN.z; state.player.heading = Math.PI;
      events |= EVENT_WASTED;
    }
    return events;
  }

  // Drives itself for the screenshot scenes: head for the active target,
  // otherwise cruise the beach road.
  function autoInput() {
    const p = state.player;
    const m = currentMission();
    const target = m && m.target ? m.target : [150, 218];
    const want = Math.atan2(target[0] - p.x, target[1] - p.z);
    const steer = clamp(angleDiff(p.heading, want) * 1.6, -1, 1);
    return { forward: 1, strafe: steer, run: false, actions: 0, camYaw: p.heading };
  }

  function save() {
    return {
      missionIndex: state.missionIndex,
      cash: state.cash,
      best: state.best,
      stats: { ...state.stats },
    };
  }

  function reset(saveData) {
    state.player.x = SPAWN.x; state.player.z = SPAWN.z; state.player.y = 0; state.player.vy = 0;
    state.player.heading = Math.PI; state.player.speed = 0;
    state.player.onFoot = true; state.player.car = null; state.player.health = PLAYER.health;
    state.wanted = 0; state.wantedTimer = 0; state.police = [];
    state.package.taken = false; state.package.visible = false;
    state.clockMinutes = START_CLOCK_MINUTES;
    if (saveData && typeof saveData === 'object') {
      state.missionIndex = clamp(saveData.missionIndex | 0, 0, MISSIONS.length - 1);
      state.cash = saveData.cash | 0;
      state.best = Math.max(state.best, saveData.best | 0);
      if (saveData.stats) state.stats = { ...state.stats, ...saveData.stats };
    } else {
      state.missionIndex = 0; state.cash = 0;
    }
    const m = currentMission();
    state.missionTime = m && m.time ? m.time : 0;
    state.storyDone = state.missionIndex >= MISSIONS.length;
    for (const car of state.parked) { car.driven = false; car.owned = false; car.speed = 0; }
    state.pickups = [];
    for (let i = 0; i < 6; i += 1) state.pickups.push(scatterPickup('cash'));
    for (let i = 0; i < 3; i += 1) state.pickups.push(scatterPickup('health'));
  }

  // Restart the current job from the spawn: the clock and the heat reset too.
  function resetMission() {
    const p = state.player;
    p.x = SPAWN.x; p.z = SPAWN.z; p.y = 0; p.vy = 0;
    p.heading = Math.PI; p.speed = 0;
    p.onFoot = true; p.car = null;
    state.wanted = 0; state.wantedTimer = 0; state.police = [];
    const m = currentMission();
    state.missionTime = m && m.time ? m.time : 0;
  }

  buildCity();
  spawnEntities();
  reset(null);

  return {
    state, buildings, palms,
    currentMission, autoInput, step, save, reset, resetMission,
  };
}
