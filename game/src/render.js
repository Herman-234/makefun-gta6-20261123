// Three.js presentation: the city, the vehicles, the people, the camera, the HUD and
// the minimap. Reads world.state every frame and paints it; owns no rules.
import * as THREE from 'three';
import { CITY, PALETTE } from './core.js';

const TAU = Math.PI * 2;

function makeGroundTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const g = c.getContext('2d');
  const X = (x) => ((x + 210) / 420) * 1024;
  const Z = (z) => ((z + 210) / 480) * 1024;
  g.fillStyle = '#2b2f38'; g.fillRect(0, 0, 1024, 1024);
  // sidewalks: light blocks between roads
  g.fillStyle = '#8f96a3';
  for (let bx = -3; bx < 3; bx += 1) {
    for (let bz = -3; bz < 3; bz += 1) {
      const x0 = X((bx + 0.5) * 58 - 22), z0 = Z((bz + 0.5) * 58 - 22);
      g.fillRect(x0, z0, X(44) - X(0), Z(44) - Z(0));
    }
  }
  // beach + sea at the south edge
  g.fillStyle = '#e8cf9a'; g.fillRect(0, Z(196), 1024, Z(250) - Z(196));
  g.fillStyle = '#2e7fc2'; g.fillRect(0, Z(250), 1024, 1024 - Z(250));
  // lane dashes along every road centreline
  g.fillStyle = '#e8c33d';
  for (let i = -3; i <= 3; i += 1) {
    const lx = i * 58;
    for (let s = -200; s < 200; s += 16) g.fillRect(X(lx) - 2, Z(s), 4, 8);
    for (let s = -200; s < 200; s += 16) g.fillRect(X(s), Z(lx) - 2, 8, 4);
  }
  // crosswalks at intersections
  g.fillStyle = 'rgba(255,255,255,0.75)';
  for (let ix = -3; ix <= 3; ix += 1) {
    for (let iz = -3; iz <= 3; iz += 1) {
      const cx = X(ix * 58), cz = Z(iz * 58);
      for (let k = -2; k <= 2; k += 1) {
        g.fillRect(cx - 14 + k * 6, cz - 12, 3, 24);
        g.fillRect(cx - 12, cz - 14 + k * 6, 24, 3);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeWindowTexture(rows) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
  for (let r = 0; r < rows; r += 1) {
    for (let col = 0; col < 4; col += 1) {
      if (Math.random() < 0.25) continue;
      g.fillStyle = Math.random() < 0.7 ? '#ffd98a' : '#9fd8ff';
      g.fillRect(6 + col * 14, 8 + r * (112 / rows), 9, 7);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeFigure(shirtColor, scale) {
  const group = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: shirtColor });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b98a });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2c3242 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.85, 0.42), shirt);
  torso.position.y = 1.05; torso.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), skin);
  head.position.y = 1.78; head.castShadow = true;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.7, 0.3), pants);
  legL.position.set(-0.18, 0.35, 0); legL.castShadow = true;
  const legR = legL.clone(); legR.position.x = 0.18;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.24), shirt);
  armL.position.set(-0.48, 1.05, 0); armL.castShadow = true;
  const armR = armL.clone(); armR.position.x = 0.48;
  group.add(torso, head, legL, legR, armL, armR);
  group.scale.setScalar(scale || 1);
  group.userData = { legL, legR, armL, armR, torso, head };
  return group;
}

function makeCar(color, police) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: police ? 0xf2f2f2 : color });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x182233 });
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14161c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.62, 3.8), bodyMat);
  body.position.y = 0.62; body.castShadow = true;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.55, 1.9), glassMat);
  cabin.position.set(0, 1.18, -0.25); cabin.castShadow = true;
  group.add(body, cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  const wheels = [];
  for (const [x, z] of [[-0.85, 1.25], [0.85, 1.25], [-0.85, -1.25], [0.85, -1.25]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.36, z);
    w.castShadow = true;
    group.add(w); wheels.push(w);
  }
  let barL = null, barR = null;
  if (police) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.4), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    bar.position.set(0, 1.55, -0.25);
    barL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.36), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    barL.position.set(-0.3, 1.56, -0.25);
    barR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.36), new THREE.MeshBasicMaterial({ color: 0x2266ff }));
    barR.position.set(0.3, 1.56, -0.25);
    group.add(bar, barL, barR);
  }
  group.userData = { wheels, barL, barR };
  return group;
}

export function createRenderer(canvas, world) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 260, 520);

  const hemi = new THREE.HemisphereLight(0xbdd8ff, 0x8a6f52, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 1.6);
  sun.position.set(160, 240, 90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -260; sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260; sun.shadow.camera.bottom = -260;
  sun.shadow.camera.far = 700;
  scene.add(sun);

  // ground + ocean
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 480),
    new THREE.MeshLambertMaterial({ map: makeGroundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 30);
  ground.receiveShadow = true;
  scene.add(ground);
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(460, 260),
    new THREE.MeshLambertMaterial({ color: PALETTE.ocean }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.15, 380);
  scene.add(ocean);

  // buildings
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const winTex = [makeWindowTexture(6), makeWindowTexture(10), makeWindowTexture(16)];
  const matCache = new Map();
  function buildingMat(color, h) {
    const band = h < 16 ? 0 : h < 28 ? 1 : 2;
    const key = `${color}-${band}`;
    if (!matCache.has(key)) {
      matCache.set(key, new THREE.MeshLambertMaterial({
        color, emissive: 0xffc46b, emissiveMap: winTex[band], emissiveIntensity: 0.55,
      }));
    }
    return matCache.get(key);
  }
  for (const b of world.state.buildings) {
    const m = new THREE.Mesh(boxGeo, buildingMat(b.color, b.h));
    m.scale.set(b.w, b.h, b.d);
    m.position.set(b.x, b.h / 2, b.z);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
  }
  // lamps
  const lampPoleMat = new THREE.MeshLambertMaterial({ color: 0x3a3f4a });
  const lampBulbMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 6, 6);
  const bulbGeo = new THREE.SphereGeometry(0.32, 8, 6);
  for (const l of world.state.lamps) {
    const pole = new THREE.Mesh(poleGeo, lampPoleMat);
    pole.position.set(l.x, 3, l.z);
    const bulb = new THREE.Mesh(bulbGeo, lampBulbMat);
    bulb.position.set(l.x, 6.2, l.z);
    scene.add(pole, bulb);
  }
  // palms
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6a45 });
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x3f9e4d });
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 5, 6);
  const frondGeo = new THREE.ConeGeometry(1.7, 1.1, 6);
  for (const p of world.state.palms) {
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(p.x, 2.5 * p.s, p.z);
    trunk.scale.setScalar(p.s);
    trunk.rotation.z = 0.12;
    const fronds = new THREE.Mesh(frondGeo, frondMat);
    fronds.position.set(p.x + 0.5, 5.4 * p.s, p.z);
    fronds.scale.setScalar(p.s);
    scene.add(trunk, fronds);
  }

  // dynamic entities
  const carMeshes = new Map();
  function syncCar(list, police, prefix) {
    for (const c of list) {
      let mesh = carMeshes.get(prefix + c.id);
      if (!mesh) {
        mesh = makeCar(c.color, police);
        scene.add(mesh);
        carMeshes.set(prefix + c.id, mesh);
      }
      mesh.visible = c.active !== false;
      mesh.position.set(c.x, 0, c.z);
      mesh.rotation.y = c.heading;
      const spin = (c.speed || 0) * 0.016;
      for (const w of mesh.userData.wheels) w.rotation.x += spin;
      if (police && mesh.userData.barL) {
        const on = Math.floor(world.state.elapsed * 6) % 2 === 0;
        mesh.userData.barL.material.color.setHex(on ? 0xff2222 : 0x551111);
        mesh.userData.barR.material.color.setHex(on ? 0x1133aa : 0x2266ff);
      }
    }
  }

  const pedMeshes = new Map();
  function syncPeds() {
    for (const ped of world.state.peds) {
      let mesh = pedMeshes.get(ped.id);
      if (!mesh) { mesh = makeFigure(ped.color, 0.95); scene.add(mesh); pedMeshes.set(ped.id, mesh); }
      mesh.position.set(ped.x, 0, ped.z);
      mesh.rotation.y = ped.heading;
      const swing = ped.fall > 0 ? 0 : Math.sin(world.state.elapsed * 9 + ped.id) * 0.5;
      mesh.userData.legL.rotation.x = swing;
      mesh.userData.legR.rotation.x = -swing;
      if (ped.fall > 0) mesh.rotation.x = Math.PI / 2 - 0.2;
      else mesh.rotation.x = 0;
    }
  }

  const pickupMeshes = new Map();
  function syncPickups() {
    for (const pk of world.state.pickups) {
      let mesh = pickupMeshes.get(pk.id);
      if (!mesh) {
        if (pk.kind === 'cash') {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshLambertMaterial({ color: 0xffd23e, emissive: 0xaa8811, emissiveIntensity: 0.6 }));
        } else {
          const g = new THREE.Group();
          const white = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), new THREE.MeshLambertMaterial({ color: 0xffffff }));
          const cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.1), new THREE.MeshBasicMaterial({ color: 0xdd2222 }));
          cross1.position.z = 0.36;
          const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.1), new THREE.MeshBasicMaterial({ color: 0xdd2222 }));
          cross2.position.z = 0.36;
          g.add(white, cross1, cross2);
          mesh = g;
        }
        scene.add(mesh);
        pickupMeshes.set(pk.id, mesh);
      }
      mesh.visible = pk.active;
      mesh.position.set(pk.x, 1 + Math.sin(world.state.elapsed * 2 + pk.id) * 0.25, pk.z);
      mesh.rotation.y = world.state.elapsed * 1.5 + pk.id;
    }
  }

  const playerMesh = makeFigure(0x2fae9e, 1);
  scene.add(playerMesh);

  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 34, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
  );
  scene.add(beacon);
  const beaconRing = new THREE.Mesh(
    new THREE.RingGeometry(2.4, 3.2, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  beaconRing.rotation.x = -Math.PI / 2;
  scene.add(beaconRing);

  // camera
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);
  let camYawOff = 0, camPitch = 0.32;
  let camPos = new THREE.Vector3(0, 8, 130);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  // ------------------------------------------------------------- HUD ----
  const el = (id) => document.getElementById(id);
  const cashEl = el('cash'), starsEl = el('stars'), healthEl = el('healthFill');
  const missionTitleEl = el('missionTitle'), missionTextEl = el('missionText'), missionDistEl = el('missionDist');
  const speedEl = el('speed'), clockEl = el('clock');
  const minimap = el('minimap');
  const mm = minimap.getContext('2d');

  function drawMinimap() {
    const S = 360 / 470;
    const OX = 235, OZ = 210;
    mm.clearRect(0, 0, 360, 360);
    mm.fillStyle = '#0a0f1c'; mm.fillRect(0, 0, 360, 360);
    // ocean + sand
    mm.fillStyle = '#2e7fc2'; mm.fillRect(0, (250 + OZ) * S, 360, 360);
    mm.fillStyle = '#e8cf9a'; mm.fillRect(0, (196 + OZ) * S, 360, (250 - 196) * S);
    // roads
    mm.strokeStyle = '#565d6b'; mm.lineWidth = 10;
    for (let i = -3; i <= 3; i += 1) {
      const l = i * 58;
      mm.beginPath(); mm.moveTo((l + OX) * S, 0); mm.lineTo((l + OX) * S, 360); mm.stroke();
      mm.beginPath(); mm.moveTo(0, (l + OZ) * S); mm.lineTo(360, (l + OZ) * S); mm.stroke();
    }
    // buildings
    mm.fillStyle = '#3a4152';
    for (const b of world.state.buildings) {
      mm.fillRect((b.x - b.w / 2 + OX) * S, (b.z - b.d / 2 + OZ) * S, Math.max(2, b.w * S), Math.max(2, b.d * S));
    }
    // pickups
    mm.fillStyle = '#ffd23e';
    for (const pk of world.state.pickups) {
      if (pk.active) { mm.beginPath(); mm.arc((pk.x + OX) * S, (pk.z + OZ) * S, 3, 0, TAU); mm.fill(); }
    }
    // traffic + police
    mm.fillStyle = '#cdd8f2';
    for (const t of world.state.traffic) { mm.beginPath(); mm.arc((t.x + OX) * S, (t.z + OZ) * S, 2.5, 0, TAU); mm.fill(); }
    mm.fillStyle = '#ff4444';
    for (const c of world.state.police) {
      if (c.active) { mm.beginPath(); mm.arc((c.x + OX) * S, (c.z + OZ) * S, 4, 0, TAU); mm.fill(); }
    }
    // beacon
    const bc = world.state.beacon;
    if (bc.active) {
      const pulse = 5 + Math.sin(world.state.elapsed * 4) * 2;
      mm.fillStyle = '#ffd23e';
      mm.beginPath(); mm.arc((bc.x + OX) * S, (bc.z + OZ) * S, pulse, 0, TAU); mm.fill();
      mm.strokeStyle = '#fff'; mm.lineWidth = 2;
      mm.beginPath(); mm.arc((bc.x + OX) * S, (bc.z + OZ) * S, pulse + 4, 0, TAU); mm.stroke();
    }
    // player arrow
    const p = world.state.player;
    mm.save();
    mm.translate((p.x + OX) * S, (p.z + OZ) * S);
    mm.rotate(Math.atan2(Math.sin(p.heading), Math.cos(p.heading)) + Math.PI);
    mm.fillStyle = '#ffffff';
    mm.beginPath(); mm.moveTo(0, -8); mm.lineTo(5, 6); mm.lineTo(-5, 6); mm.closePath(); mm.fill();
    mm.restore();
  }

  function updateHUD() {
    const st = world.state;
    cashEl.textContent = `$${st.cash.toLocaleString('en-US')}`;
    let stars = '';
    for (let i = 0; i < 3; i += 1) stars += i < st.wanted ? '★ ' : '<span class="off">★ </span>';
    starsEl.innerHTML = stars;
    healthEl.style.width = `${Math.max(0, st.health)}%`;
    const m = world.currentMission();
    if (st.storyDone) {
      missionTitleEl.textContent = 'STORY COMPLETE';
      missionTextEl.textContent = 'Vice Shores is yours. Free roam, grab cash bags, dodge the PD.';
      missionDistEl.textContent = '';
    } else if (m) {
      missionTitleEl.textContent = m.title;
      missionTextEl.textContent = m.text;
      if (m.kind === 'timed') missionDistEl.textContent = `⏱ ${Math.max(0, Math.ceil(st.missionTimer || m.time))}s left`;
      else if (m.target) missionDistEl.textContent = `◉ ${Math.round(Math.hypot(m.target[0] - st.player.x, m.target[1] - st.player.z))}m to marker`;
      else if (m.kind === 'clean') missionDistEl.textContent = st.wanted > 0 ? `★ Wanted ${st.wanted} — stay clean…` : 'Almost clean…';
      else missionDistEl.textContent = '';
    }
    const p = st.player;
    speedEl.innerHTML = p.onFoot ? '' : `${Math.round(Math.abs(p.speed || 0) * 3.6)} <small>km/h</small>`;
    const hh = Math.floor(st.clockMinutes / 60) % 24;
    const min = Math.floor(st.clockMinutes % 60);
    clockEl.innerHTML = `VICE SHORES &middot; ${String(hh).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    drawMinimap();
  }

  function draw(attract) {
    const st = world.state;
    const p = st.player;
    syncCar(st.parked, false, 'park-');
    syncCar(st.traffic, false, 'traf-');
    syncCar(st.police, true, 'pol-');
    syncPeds();
    syncPickups();

    // player figure
    playerMesh.visible = p.onFoot;
    if (p.onFoot) {
      playerMesh.position.set(p.x, p.y, p.z);
      playerMesh.rotation.y = p.heading;
      const swing = p.speed > 0.5 ? Math.sin(st.elapsed * 11) * 0.6 : 0;
      playerMesh.userData.legL.rotation.x = swing;
      playerMesh.userData.legR.rotation.x = -swing;
      playerMesh.userData.armL.rotation.x = -swing * 0.7;
      playerMesh.userData.armR.rotation.x = swing * 0.7;
      if (p.punchTimer > 0) playerMesh.userData.armR.rotation.x = -1.4;
    }

    // beacon
    beacon.visible = st.beacon.active;
    beaconRing.visible = st.beacon.active;
    if (st.beacon.active) {
      beacon.position.set(st.beacon.x, 17, st.beacon.z);
      const s = 1 + Math.sin(st.elapsed * 3) * 0.15;
      beaconRing.position.set(st.beacon.x, 0.15, st.beacon.z);
      beaconRing.scale.set(s, s, 1);
    }

    // camera
    const dist = p.onFoot ? 9.5 : 13;
    const height = p.onFoot ? 4.2 : 5.2;
    const camHeading = p.heading + camYawOff;
    const tx = p.x - Math.sin(camHeading) * dist;
    const tz = p.z - Math.cos(camHeading) * dist;
    const k = attract ? 0.02 : 0.12;
    camPos.x += (tx - camPos.x) * k;
    camPos.y += (height - camPos.y) * k;
    camPos.z += (tz - camPos.z) * k;
    camera.position.copy(camPos);
    camera.lookAt(p.x + Math.sin(p.heading) * 3, 1.6 + p.y, p.z + Math.cos(p.heading) * 3);

    updateHUD();
    renderer.render(scene, camera);
  }

  return {
    draw,
    addLook(dx, dy) {
      camYawOff -= dx * 0.004;
      camPitch = Math.max(0.05, Math.min(1.1, camPitch + dy * 0.003));
    },
    resetCamera() { camYawOff = 0; camPitch = 0.32; },
    setCamera(x, y, z) { camPos.set(x, y, z); },
  };
}
