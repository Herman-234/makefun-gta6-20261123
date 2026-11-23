// VICE SHORES — three.js presentation: the city, the vehicles, the people,
// the camera, the HUD and the minimap. Reads world.state every frame and
// paints it; it owns no rules. The world hands it buildings and palms.
import * as THREE from 'three';
import { CITY, PALETTE, formatCash, clamp, angleDiff } from './core.js';

const TAU = Math.PI * 2;

// The ground is one painted canvas: asphalt, sidewalk blocks, the beach and
// the sea, lane dashes and crosswalks — cheaper than a thousand meshes.
function makeGroundTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const g = c.getContext('2d');
  const X = (x) => ((x + 210) / 420) * 1024;
  const Z = (z) => ((z + 210) / 480) * 1024;
  g.fillStyle = '#2b2f38'; g.fillRect(0, 0, 1024, 1024);
  g.fillStyle = '#8f96a3';
  for (let bx = -3; bx <= 2; bx += 1) {
    for (let bz = -3; bz <= 2; bz += 1) {
      const x0 = X((bx + 0.5) * 58 - 22), z0 = Z((bz + 0.5) * 58 - 22);
      g.fillRect(x0, z0, X(44) - X(0), Z(44) - Z(0));
    }
  }
  g.fillStyle = '#e8cf9a'; g.fillRect(0, Z(196), 1024, Z(250) - Z(196));
  g.fillStyle = '#2e7fc2'; g.fillRect(0, Z(250), 1024, 1024 - Z(250));
  g.fillStyle = '#e8c33d';
  for (let i = -3; i <= 3; i += 1) {
    const lx = i * 58;
    for (let s = -200; s < 200; s += 16) g.fillRect(X(lx) - 2, Z(s), 4, 8);
    for (let s = -200; s < 200; s += 16) g.fillRect(X(s), Z(lx) - 2, 8, 4);
  }
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
  g.fillStyle = '#20242e'; g.fillRect(0, 0, 64, 128);
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

// A low-poly person: shirt torso, head, legs and arms, with the limbs kept in
// userData so the walk cycle can swing them.
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

// A boxy sedan. Police cars get a white body and a red/blue light bar.
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
  if (police) {
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.4), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    barBase.position.set(0, 1.52, -0.25);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.34), new THREE.MeshBasicMaterial({ color: 0xff2d2d }));
    red.position.set(-0.32, 1.56, -0.25);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.34), new THREE.MeshBasicMaterial({ color: 0x2d5bff }));
    blue.position.set(0.32, 1.56, -0.25);
    group.add(barBase, red, blue);
    group.userData.lightRed = red; group.userData.lightBlue = blue;
  }
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [wx, wz] of [[-0.95, 1.25], [0.95, 1.25], [-0.95, -1.25], [0.95, -1.25]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(wx, 0.36, wz); w.castShadow = true;
    group.add(w); wheels.push(w);
  }
  group.userData.wheels = wheels;
  return group;
}

export function createRenderer(canvas, world) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 220, 560);

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 1.6);
  sun.position.set(120, 180, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -230; sun.shadow.camera.right = 230;
  sun.shadow.camera.top = 230; sun.shadow.camera.bottom = -230;
  sun.shadow.camera.far = 600;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 480),
    new THREE.MeshLambertMaterial({ map: makeGroundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 30);
  ground.receiveShadow = true;
  scene.add(ground);

  const winTex = [makeWindowTexture(4), makeWindowTexture(7), makeWindowTexture(10)];
  const buildingMeshes = [];
  for (const b of world.buildings) {
    const side = new THREE.MeshLambertMaterial({ map: winTex[Math.floor(Math.random() * winTex.length)] });
    const cap = new THREE.MeshLambertMaterial({ color: b.color });
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(b.hw * 2, b.h, b.hd * 2),
      [side, side, cap, cap, side, side],
    );
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh); buildingMeshes.push(mesh);
  }

  // Palms: a leaning trunk and a flat crown of fronds.
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6b48 });
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x3f9e4d });
  for (const palm of world.palms) {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 4.2, 6), trunkMat);
    trunk.position.y = 2.1; trunk.rotation.z = palm.lean; trunk.castShadow = true;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.2, 7), frondMat);
    crown.position.set(Math.sin(palm.lean) * -1.2, 4.6, 0); crown.castShadow = true;
    tree.add(trunk, crown);
    tree.position.set(palm.x, 0, palm.z);
    scene.add(tree);
  }

  // The pier at the south beach (mission 1's meeting point), boardwalk planks
  // running from the sand into the sea, with striped beach umbrellas nearby.
  const pierMat = new THREE.MeshLambertMaterial({ color: 0x9a7b52 });
  const pier = new THREE.Group();
  for (let z = 206; z <= 246; z += 4) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(10, 0.4, 3.6), pierMat);
    plank.position.set(150, 1.2, z);
    plank.castShadow = true; plank.receiveShadow = true;
    pier.add(plank);
  }
  for (const px of [145.5, 154.5]) {
    for (let z = 208; z <= 244; z += 12) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.6, 6), pierMat);
      post.position.set(px, 0, z);
      pier.add(post);
    }
  }
  scene.add(pier);
  const umbrellaMat = new THREE.MeshLambertMaterial({ color: 0xff7a59 });
  const umbrellaMat2 = new THREE.MeshLambertMaterial({ color: 0x2fae9e });
  const poleMat = new THREE.MeshLambertMaterial({ color: 0xe8e8e8 });
  for (let i = 0; i < 8; i += 1) {
    const ux = -160 + i * 46 + (i % 2 ? 8 : -6);
    const uz = 204 + (i % 3) * 5;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.6, 6), poleMat);
    pole.position.set(ux, 1.3, uz);
    const top = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.0, 8), i % 2 ? umbrellaMat : umbrellaMat2);
    top.position.set(ux, 3.0, uz);
    top.castShadow = true;
    scene.add(pole, top);
  }
  // A few slow clouds, high up, so the sky is not a flat color.
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  for (const [cx, cy, cz, s] of [[-140, 90, -120, 1.6], [60, 105, -160, 2.1], [170, 95, 40, 1.4], [-40, 100, 140, 1.8], [120, 110, -60, 1.2]]) {
    const cloud = new THREE.Group();
    for (const [ox, oy, oz, r] of [[0, 0, 0, 7], [6, 1, 1, 5], [-6, 0.5, -1, 5.5], [2, 2, -2, 4]]) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), cloudMat);
      puff.position.set(ox, oy, oz);
      puff.scale.y = 0.45;
      cloud.add(puff);
    }
    cloud.position.set(cx, cy, cz);
    cloud.scale.setScalar(s);
    scene.add(cloud);
  }

  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 1200);
  let camYaw = Math.PI, camYawOff = 0, camPitch = 0.32;
  let lastNow = performance.now();
  let walkPhase = 0;
  let flashClock = 0;

  const playerMesh = makeFigure(0x35c4b5, 1);
  scene.add(playerMesh);

  const parkedMeshes = world.state.parked.map((car) => {
    const m = makeCar(car.color, false);
    scene.add(m);
    return m;
  });
  const trafficMeshes = world.state.traffic.map((car) => {
    const m = makeCar(car.color, false);
    scene.add(m);
    return m;
  });
  const policeMeshes = [];
  const pedMeshes = world.state.peds.map((ped) => {
    const m = makeFigure(ped.shirt, 0.95);
    scene.add(m);
    return m;
  });
  const pickupMeshes = world.state.pickups.map((pk) => {
    const mat = new THREE.MeshLambertMaterial({ color: pk.kind === 'cash' ? 0x37b268 : 0xf2f2f2 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), mat);
    m.castShadow = true;
    scene.add(m);
    return m;
  });
  const packageMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.7, 1.1),
    new THREE.MeshLambertMaterial({ color: 0x8a6b48 }),
  );
  packageMesh.castShadow = true;
  scene.add(packageMesh);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.4, 34, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
  );
  scene.add(beam);

  // ------------------------------------------------------------- HUD ----
  const $ = (id) => document.getElementById(id);
  const cashEl = $('cash'), starsEl = $('stars'), healthEl = $('healthFill');
  const clockEl = $('clock'), missionTitleEl = $('missionTitle'), missionTextEl = $('missionText');
  const missionDistEl = $('missionDist'), speedEl = $('speed');
  const mapCanvas = $('minimap');
  const mapCtx = mapCanvas.getContext('2d');
  const MX = (x) => ((x + 210) / 420) * 360;
  const MZ = (z) => ((z + 210) / 480) * 360;

  function paintMinimap() {
    const st = world.state;
    mapCtx.fillStyle = '#0a0f1c'; mapCtx.fillRect(0, 0, 360, 360);
    mapCtx.fillStyle = '#2e7fc2'; mapCtx.fillRect(0, MZ(250), 360, 360 - MZ(250));
    mapCtx.fillStyle = '#e8cf9a'; mapCtx.fillRect(0, MZ(196), 360, MZ(250) - MZ(196));
    mapCtx.strokeStyle = 'rgba(255,255,255,0.28)'; mapCtx.lineWidth = 5;
    for (let i = -3; i <= 3; i += 1) {
      mapCtx.beginPath(); mapCtx.moveTo(MX(i * 58), 0); mapCtx.lineTo(MX(i * 58), 360); mapCtx.stroke();
      mapCtx.beginPath(); mapCtx.moveTo(0, MZ(i * 58)); mapCtx.lineTo(360, MZ(i * 58)); mapCtx.stroke();
    }
    mapCtx.fillStyle = 'rgba(255,255,255,0.14)';
    for (const b of world.buildings) mapCtx.fillRect(MX(b.x - b.hw), MZ(b.z - b.hd), MX(b.hw * 2) - MX(0), MZ(b.hd * 2) - MZ(0));
    const m = world.currentMission();
    if (m && m.target) {
      mapCtx.fillStyle = '#ffd23e';
      mapCtx.beginPath(); mapCtx.arc(MX(m.target[0]), MZ(m.target[1]), 7, 0, TAU); mapCtx.fill();
      mapCtx.strokeStyle = '#ffd23e'; mapCtx.lineWidth = 2;
      mapCtx.beginPath(); mapCtx.arc(MX(m.target[0]), MZ(m.target[1]), 12, 0, TAU); mapCtx.stroke();
    }
    for (const pk of st.pickups) {
      mapCtx.fillStyle = pk.kind === 'cash' ? '#37b268' : '#ffffff';
      mapCtx.fillRect(MX(pk.x) - 3, MZ(pk.z) - 3, 6, 6);
    }
    for (const t of st.traffic) {
      mapCtx.fillStyle = '#dfe7ff';
      mapCtx.beginPath(); mapCtx.arc(MX(t.x), MZ(t.z), 3, 0, TAU); mapCtx.fill();
    }
    for (const cop of st.police) {
      mapCtx.fillStyle = '#ff4d4d';
      mapCtx.beginPath(); mapCtx.arc(MX(cop.x), MZ(cop.z), 4, 0, TAU); mapCtx.fill();
    }
    const p = st.player;
    mapCtx.save();
    mapCtx.translate(MX(p.x), MZ(p.z));
    mapCtx.rotate(Math.atan2(Math.sin(p.heading), Math.cos(p.heading)) * -1 + Math.PI);
    mapCtx.fillStyle = '#ffd23e';
    mapCtx.beginPath(); mapCtx.moveTo(0, -8); mapCtx.lineTo(6, 7); mapCtx.lineTo(-6, 7); mapCtx.closePath(); mapCtx.fill();
    mapCtx.restore();
  }

  function paintHud() {
    const st = world.state;
    cashEl.textContent = formatCash(st.cash);
    let stars = '';
    for (let i = 0; i < 3; i += 1) stars += i < st.wanted ? '★ ' : '<span class="off">★ </span>';
    starsEl.innerHTML = stars;
    healthEl.style.width = `${Math.max(0, Math.round(st.player.health))}%`;
    const mins = Math.floor(st.clockMinutes) % 1440;
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    clockEl.textContent = `VICE SHORES · ${hh}:${mm}`;
    const m = world.currentMission();
    if (m) {
      missionTitleEl.textContent = m.title;
      missionTextEl.textContent = m.text;
      const d = Math.round(Math.hypot(st.player.x - m.target?.[0] ?? 0, st.player.z - m.target?.[1] ?? 0));
      missionDistEl.textContent = m.target
        ? (m.time ? `${d}m · ${Math.ceil(st.missionTime)}s left` : `${d}m away`)
        : (m.kind === 'clean' ? 'Stay out of trouble…' : 'Find a car and press E');
    } else {
      missionTitleEl.textContent = 'FREE ROAM';
      missionTextEl.textContent = 'Story complete. The city is yours — grab cash bags, dodge the PD.';
      missionDistEl.textContent = `Best cash: ${formatCash(st.best)}`;
    }
    const p = st.player;
    speedEl.innerHTML = p.onFoot
      ? ''
      : `${Math.round(Math.abs(p.car?.speed || 0) * 3.6)} <small>km/h</small>`;
  }

  function placeCarMesh(mesh, car) {
    mesh.position.set(car.x, 0, car.z);
    mesh.rotation.y = car.heading;
    const spin = (car.speed || 0) * 0.016;
    for (const w of mesh.userData.wheels || []) w.rotation.x += spin;
  }

  function draw(attract) {
    const now = performance.now();
    const dt = clamp((now - lastNow) / 1000, 0, 0.1);
    lastNow = now;
    flashClock += dt;
    const st = world.state;
    const p = st.player;

    const w = canvas.clientWidth || 1280, h = canvas.clientHeight || 720;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    if (attract) {
      const a = now * 0.00004;
      camera.position.set(Math.sin(a) * 250, 110, Math.cos(a) * 250 + 30);
      camera.lookAt(0, 10, 30);
    } else {
      camYawOff *= Math.max(0, 1 - dt * 0.35);
      const want = p.heading + camYawOff;
      camYaw += angleDiff(camYaw, want) * Math.min(1, dt * 6);
      const dist = p.onFoot ? 9 : 12.5;
      const height = 2 + dist * Math.sin(camPitch);
      const back = dist * Math.cos(camPitch);
      camera.position.set(
        p.x - Math.sin(camYaw) * back,
        height + (p.y || 0),
        p.z - Math.cos(camYaw) * back,
      );
      camera.lookAt(p.x + Math.sin(camYaw) * 3, 1.6 + (p.y || 0), p.z + Math.cos(camYaw) * 3);
    }

    // Player figure: walk cycle on foot, tucked into the car when driving.
    if (p.onFoot) {
      playerMesh.visible = true;
      playerMesh.position.set(p.x, p.y || 0, p.z);
      playerMesh.rotation.y = p.heading;
      walkPhase += dt * (p.speed || 0) * 1.6;
      const swing = Math.sin(walkPhase) * (p.speed > 0.5 ? 0.55 : 0);
      const u = playerMesh.userData;
      u.legL.rotation.x = swing; u.legR.rotation.x = -swing;
      u.armL.rotation.x = -swing * 0.8; u.armR.rotation.x = swing * 0.8;
    } else {
      playerMesh.visible = false;
    }
    for (let i = 0; i < parkedMeshes.length; i += 1) {
      const car = st.parked[i];
      const mesh = parkedMeshes[i];
      mesh.position.set(car.x, 0, car.z);
      mesh.rotation.y = car.heading;
      mesh.visible = car !== p.car;
    }
    for (let i = 0; i < trafficMeshes.length; i += 1) placeCarMesh(trafficMeshes[i], st.traffic[i]);
    while (policeMeshes.length < st.police.length) {
      const m = makeCar(0xf2f2f2, true);
      scene.add(m); policeMeshes.push(m);
    }
    for (let i = 0; i < st.police.length; i += 1) {
      placeCarMesh(policeMeshes[i], st.police[i]);
      const on = Math.floor(flashClock * 4) % 2 === 0;
      const m = policeMeshes[i];
      if (m.userData.lightRed) {
        m.userData.lightRed.material.color.setHex(on ? 0xff2d2d : 0x551111);
        m.userData.lightBlue.material.color.setHex(on ? 0x111155 : 0x2d5bff);
      }
    }
    for (let i = 0; i < pedMeshes.length; i += 1) {
      const ped = st.peds[i];
      const mesh = pedMeshes[i];
      mesh.position.set(ped.x, ped.down > 0 ? 0.25 : 0, ped.z);
      mesh.rotation.y = ped.heading;
      mesh.rotation.z = ped.down > 0 ? Math.PI / 2 : 0;
      const u = mesh.userData;
      const swing = ped.down > 0 ? 0 : Math.sin(now * 0.006 + ped.seed * 7) * 0.4;
      u.legL.rotation.x = swing; u.legR.rotation.x = -swing;
      u.armL.rotation.x = -swing * 0.7; u.armR.rotation.x = swing * 0.7;
    }
    for (let i = 0; i < pickupMeshes.length; i += 1) {
      const pk = st.pickups[i];
      const mesh = pickupMeshes[i];
      mesh.position.set(pk.x, 0.9 + Math.sin(now * 0.003 + i) * 0.15, pk.z);
      mesh.rotation.y = now * 0.001 + i;
    }
    packageMesh.visible = !!st.package.visible;
    if (st.package.visible) {
      packageMesh.position.set(st.package.x, 0.35, st.package.z);
      packageMesh.rotation.y = now * 0.0008;
    }
    const m = world.currentMission();
    beam.visible = !!(m && m.target);
    if (m && m.target) beam.position.set(m.target[0], 17, m.target[1]);

    paintHud();
    paintMinimap();
    renderer.render(scene, camera);
  }

  return {
    draw,
    addLook(dx, dy) {
      camYawOff = clamp(camYawOff - dx * 0.005, -2.4, 2.4);
      camPitch = clamp(camPitch + dy * 0.003, 0.08, 1.1);
    },
    resetCamera() { camYawOff = 0; camPitch = 0.32; camYaw = world.state.player.heading; },
    yaw() { return camYaw; },
  };
}
