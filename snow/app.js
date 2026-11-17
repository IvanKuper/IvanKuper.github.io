import * as THREE from "three";

const stops = [...document.querySelectorAll(".stop")];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- Page UI (works with or without WebGL) ----
const rail = document.getElementById("rail");
for (const s of stops) {
  const li = document.createElement("li");
  li.innerHTML = `<a href="#${s.id}"><span>${s.dataset.label}</span><i></i></a>`;
  rail.append(li);
}
const railLinks = [...rail.querySelectorAll("a")];
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.querySelector(".card").classList.add("in");
      for (const a of railLinks) a.classList.toggle("on", a.hash === "#" + e.target.id);
    }
  },
  { rootMargin: "-45% 0px -45% 0px" }
);
stops.forEach((s) => io.observe(s));
stops[0].querySelector(".card").classList.add("in");

// ---- 3D scene ----
const canvas = document.getElementById("scene");
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
} catch {
  document.documentElement.classList.add("no-webgl");
}
if (renderer) buildScene(renderer);

function buildScene(renderer) {
  const RUN = 1400; // length of the run in world units
  const START = 40;
  const END = RUN - 80;
  const SLOPE = 0.32;
  const SKY = new THREE.Color(0xcfe3f1);
  const ACCENT = 0xff5a36;

  // Deterministic random so the mountain looks the same on every visit.
  let seed = 7;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // d = distance down the run, world z = -d
  const pathX = (d) => 22 * Math.sin(d * 0.012) + 9 * Math.sin(d * 0.031 + 1);
  const bumps = (x, d) =>
    2.4 * Math.sin(x * 0.09 + d * 0.05) * Math.cos(d * 0.023 - x * 0.04) + 1.1 * Math.sin(x * 0.21 + d * 0.17);
  const height = (x, d) => {
    const dx = x - pathX(d);
    const off = Math.min(1, Math.abs(dx) / 18);
    return -d * SLOPE + bumps(x, d) * off * off + dx * dx * 0.006;
  };

  const scene = new THREE.Scene();
  scene.background = SKY;
  scene.fog = new THREE.Fog(SKY, 70, 460);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 2000);
  scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x7f93ad, 1.7));
  const sun = new THREE.DirectionalLight(0xffe0c2, 2.4);
  sun.position.set(-1, 1.4, 0.6);
  scene.add(sun);

  // Terrain
  const isSmall = innerWidth < 720;
  const terrainGeo = new THREE.PlaneGeometry(340, RUN + 420, isSmall ? 90 : 150, isSmall ? 520 : 840);
  terrainGeo.rotateX(-Math.PI / 2);
  terrainGeo.translate(0, 0, -RUN / 2);
  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setY(i, height(x, -pos.getZ(i)));
  }
  terrainGeo.computeVertexNormals();
  const colors = new Float32Array(pos.count * 3);
  const snow = new THREE.Color(0xffffff);
  const shade = new THREE.Color(0x9fb8d4);
  const c = new THREE.Color();
  const normals = terrainGeo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    c.copy(shade).lerp(snow, Math.pow(normals.getY(i), 6));
    c.toArray(colors, i * 3);
  }
  terrainGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  scene.add(
    new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }))
  );

  // Distant peaks: unfogged pale silhouettes
  const peakMat = new THREE.MeshStandardMaterial({ color: 0xeef4fa, flatShading: true, fog: false });
  for (let i = 0; i < 14; i++) {
    const r = 160 + rand() * 220;
    const peak = new THREE.Mesh(new THREE.ConeGeometry(r, r * (0.8 + rand() * 0.5), 6 + Math.floor(rand() * 3)), peakMat);
    const side = i % 2 ? 1 : -1;
    const d = (i / 14) * (RUN + 600) + 200;
    peak.position.set(side * (420 + rand() * 300), -d * SLOPE - 60, -d - 300);
    peak.rotation.y = rand() * Math.PI;
    scene.add(peak);
  }

  const lodgeD = END + 24;
  const lodgeX = pathX(lodgeD) + 13;

  // Trees with snow caps
  const TREES = isSmall ? 600 : 1100;
  const treeGeo = new THREE.ConeGeometry(2.2, 7, 6).translate(0, 3.5, 0);
  const capGeo = new THREE.ConeGeometry(1.25, 2.6, 6).translate(0, 6.2, 0);
  const trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshStandardMaterial({ color: 0x2f5d50, flatShading: true }), TREES);
  const caps = new THREE.InstancedMesh(capGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), TREES);
  const m = new THREE.Object3D();
  let planted = 0;
  for (let i = 0; i < TREES; i++) {
    const d = -120 + rand() * (RUN + 300);
    const side = rand() < 0.5 ? -1 : 1;
    const x = pathX(d) + side * (15 + Math.pow(rand(), 1.6) * 150);
    if (Math.hypot(x - lodgeX, d - lodgeD) < 30) continue;
    m.position.set(x, height(x, d) - 0.3, -d);
    m.rotation.y = rand() * Math.PI;
    m.scale.setScalar(0.7 + rand() * 1);
    m.updateMatrix();
    trees.setMatrixAt(planted, m.matrix);
    caps.setMatrixAt(planted++, m.matrix);
  }
  trees.count = caps.count = planted;
  scene.add(trees, caps);

  // Stars to catch: fixed spots down the run, some off the line so you have to steer
  const STARS = 40;
  const starD = [];
  const starO = [];
  const got = new Uint8Array(STARS);
  for (let i = 0; i < STARS; i++) {
    starD.push(START + 30 + (i / STARS) * (END - START - 60));
    starO.push(Math.round((rand() * 2 - 1) * 4) * 2.5);
  }
  const stars = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.9),
    new THREE.MeshStandardMaterial({ color: 0xffc83d, emissive: 0xff8a00, emissiveIntensity: 0.6, flatShading: true }),
    STARS
  );
  scene.add(stars);
  document.getElementById("starsTotal").textContent = STARS;

  // Checkpoint gates, one per page section
  const label = (text) => {
    const cv = document.createElement("canvas");
    cv.width = 512;
    cv.height = 128;
    const g = cv.getContext("2d");
    g.fillStyle = "#ff5a36";
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = "#fff";
    g.font = "800 64px 'Bricolage Grotesque', system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text.toUpperCase(), 256, 68);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  const poleGeo = new THREE.CylinderGeometry(0.18, 0.18, 7, 8).translate(0, 3.5, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x0d1b2a });
  const gates = stops.map((s, i) => {
    const gate = new THREE.Group();
    const left = new THREE.Mesh(poleGeo, poleMat);
    const right = left.clone();
    left.position.x = -7;
    right.position.x = 7;
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 3.2),
      new THREE.MeshBasicMaterial({ map: label(i === 0 ? "Start" : s.dataset.label), side: THREE.DoubleSide })
    );
    banner.position.y = 5.6;
    gate.add(left, right, banner);
    scene.add(gate);
    return gate;
  });

  // Lodge at the bottom of the run
  const lodge = new THREE.Group();
  const walls = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 9), new THREE.MeshStandardMaterial({ color: 0x8a5a3b, flatShading: true }));
  walls.position.y = 3;
  const roof = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, 9, 5, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true })
  );
  roof.position.y = 8.4;
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.2), new THREE.MeshBasicMaterial({ color: 0xffc46b }));
  glow.position.set(0, 3.2, 4.55);
  lodge.add(walls, roof, glow);
  lodge.position.set(lodgeX, height(lodgeX, lodgeD) - 0.5, -lodgeD);
  lodge.rotation.y = -0.6;
  scene.add(lodge);

  // Rider
  const rider = new THREE.Group();
  const mat = (color) => new THREE.MeshStandardMaterial({ color, flatShading: true });
  const add = (geo, material, x, y, z) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    rider.add(mesh);
    return mesh;
  };
  add(new THREE.BoxGeometry(0.75, 0.12, 2.8), mat(ACCENT), 0, 0.08, 0);
  const pants = mat(0x1d2b3a);
  add(new THREE.CylinderGeometry(0.17, 0.17, 1.1, 8), pants, 0, 0.7, -0.45).rotation.x = -0.25;
  add(new THREE.CylinderGeometry(0.17, 0.17, 1.1, 8), pants, 0, 0.7, 0.45).rotation.x = 0.25;
  const jacket = mat(0x2a9d8f);
  add(new THREE.CapsuleGeometry(0.4, 0.7, 4, 8), jacket, 0, 1.65, 0);
  const armL = add(new THREE.CapsuleGeometry(0.13, 0.8, 4, 6), jacket, 0, 1.85, -0.75);
  const armR = add(new THREE.CapsuleGeometry(0.13, 0.8, 4, 6), jacket, 0, 1.85, 0.75);
  armL.rotation.x = -1.2;
  armR.rotation.x = 1.2;
  add(new THREE.SphereGeometry(0.3, 12, 10), mat(0xf1c8a6), 0, 2.45, 0);
  add(new THREE.SphereGeometry(0.34, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xffffff), 0, 2.5, 0);
  add(new THREE.BoxGeometry(0.12, 0.14, 0.42), mat(ACCENT), 0.27, 2.47, 0);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x3b5470, transparent: true, opacity: 0.22, depthWrite: false })
  );
  rider.scale.setScalar(1.35);
  scene.add(rider, shadow);

  // Falling snow, kept in a box around the camera
  const FLAKES = reduceMotion ? 0 : isSmall ? 900 : 1800;
  const flakePos = new Float32Array(FLAKES * 3);
  for (let i = 0; i < FLAKES; i++) {
    let x, z;
    do {
      x = (rand() - 0.5) * 120;
      z = (rand() - 0.5) * 120;
    } while (x * x + z * z < 64); // no flakes right in front of the lens
    flakePos[i * 3] = x;
    flakePos[i * 3 + 1] = (rand() - 0.5) * 60;
    flakePos[i * 3 + 2] = z;
  }
  const dot = document.createElement("canvas");
  dot.width = dot.height = 32;
  const dg = dot.getContext("2d");
  const grad = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  dg.fillStyle = grad;
  dg.fillRect(0, 0, 32, 32);
  const dotTex = new THREE.CanvasTexture(dot);
  const flakeGeo = new THREE.BufferGeometry();
  flakeGeo.setAttribute("position", new THREE.BufferAttribute(flakePos, 3));
  const flakes = new THREE.Points(
    flakeGeo,
    new THREE.PointsMaterial({ map: dotTex, size: 0.5, transparent: true, depthWrite: false })
  );
  scene.add(flakes);

  // Snow spray kicked up by the board
  const SPRAY = reduceMotion ? 0 : 200;
  const sprayPos = new Float32Array(SPRAY * 3).fill(-1e4);
  const sprayVel = new Float32Array(SPRAY * 3);
  const sprayLife = new Float32Array(SPRAY);
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute("position", new THREE.BufferAttribute(sprayPos, 3));
  const spray = new THREE.Points(sprayGeo, new THREE.PointsMaterial({ map: dotTex, size: 0.7, transparent: true, depthWrite: false }));
  spray.frustumCulled = false;
  scene.add(spray);
  let nextSpray = 0;

  // Steering: arrow keys / A-D on a keyboard, sideways swipe on a phone
  let input = 0;
  let steer = 0;
  let off = 0;
  const keyDir = { ArrowLeft: -1, ArrowRight: 1, a: -1, d: 1, A: -1, D: 1 };
  addEventListener("keydown", (e) => {
    if (!keyDir[e.key] || e.target.closest?.("input, textarea")) return;
    input = keyDir[e.key];
    e.preventDefault();
  });
  addEventListener("keyup", (e) => {
    if (keyDir[e.key] === input) input = 0;
  });
  let touchX = 0;
  addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
  addEventListener(
    "touchmove",
    (e) => {
      const x = e.touches[0].clientX;
      steer += (x - touchX) * 0.06;
      touchX = x;
    },
    { passive: true }
  );

  let score = 0;
  const scoreEl = document.getElementById("stars");
  const scoreBox = scoreEl.parentElement;
  const haul = document.getElementById("haul");
  const catchStar = () => {
    score++;
    scoreEl.textContent = score;
    scoreBox.classList.remove("pop");
    void scoreBox.offsetWidth; // restart the pop animation
    scoreBox.classList.add("pop");
    haul.hidden = false;
    haul.textContent =
      score === STARS ? `Perfect run: all ${STARS} stars caught!` : `Your run: ${score} of ${STARS} stars caught.`;
  };

  // Scroll position -> distance down the run. Gates sit where their section is centered.
  let stopT = [];
  const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - innerHeight);
  const distAt = (t) => START + t * (END - START);
  const placeGates = () => {
    stopT = stops.map((s) => THREE.MathUtils.clamp((s.offsetTop + s.offsetHeight / 2 - innerHeight / 2) / maxScroll(), 0, 1));
    gates.forEach((g, i) => {
      const d = distAt(stopT[i]) + 10;
      const x = pathX(d);
      g.position.set(x, height(x, d), -d);
      g.rotation.y = -Math.atan2(pathX(d + 1) - x, 1);
    });
  };

  const resize = () => {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.fov = camera.aspect < 0.8 ? 68 : 55;
    camera.updateProjectionMatrix();
    placeGates();
  };
  addEventListener("resize", resize);
  resize();
  document.fonts?.ready.then(placeGates);

  const altEl = document.getElementById("alt");
  const point = (d, out, o = 0) => {
    const x = pathX(d) + o;
    return out.set(x, height(x, d), -d);
  };
  const here = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const look = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  let t = scrollY / maxScroll();
  let first = true;
  let prevD = distAt(t);
  const clock = new THREE.Clock();

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const target = scrollY / maxScroll();
    t = reduceMotion ? target : t + (target - t) * Math.min(1, dt * 3.5);
    const d = distAt(t);

    steer = THREE.MathUtils.clamp(steer + input * dt * 24, -11, 11);
    const carve = steer - off;
    off += carve * Math.min(1, dt * 6);

    point(d, here, off);
    point(d + 3, ahead, off);
    rider.position.copy(here);
    rider.lookAt(ahead.x, here.y, ahead.z);
    // Lean into the turn: curvature of the path plus the player's own carve
    const curve = pathX(d + 4) - 2 * pathX(d) + pathX(d - 4);
    const speed = Math.abs(target - t) * 60;
    rider.rotateZ(THREE.MathUtils.clamp(-curve * 0.9 - carve * 0.08, -0.6, 0.6));
    rider.rotateX(-Math.atan(SLOPE) * 0.8);
    shadow.position.set(here.x, here.y + 0.05, here.z);

    // Stars: spin, bob, and get caught when the rider passes close enough
    const lo = Math.min(prevD, d) - 1;
    const hi = Math.max(prevD, d) + 1;
    for (let i = 0; i < STARS; i++) {
      if (!got[i] && starD[i] > lo && starD[i] < hi && Math.abs(starO[i] - off) < 2.6) {
        got[i] = 1;
        catchStar();
      }
      point(starD[i], m.position, starO[i]);
      m.position.y += 1.8 + (reduceMotion ? 0 : Math.sin(clock.elapsedTime * 3 + i) * 0.3);
      m.rotation.set(0, reduceMotion ? 0 : clock.elapsedTime * 2 + i, 0);
      m.scale.setScalar(got[i] ? 0 : 1);
      m.updateMatrix();
      stars.setMatrixAt(i, m.matrix);
    }
    stars.instanceMatrix.needsUpdate = true;
    prevD = d;

    if (SPRAY) {
      const emit = Math.min(8, Math.floor(speed * 3 + Math.abs(carve) * 0.8));
      for (let k = 0; k < emit; k++) {
        const i = nextSpray++ % SPRAY;
        sprayPos.set([here.x + (Math.random() - 0.5) * 1.2, here.y + 0.2, here.z + 1.2], i * 3);
        sprayVel.set([(Math.random() - 0.5) * 4 - carve * 0.4, 2 + Math.random() * 3, 3 + Math.random() * 3], i * 3);
        sprayLife[i] = 0.7;
      }
      for (let i = 0; i < SPRAY; i++) {
        if (sprayLife[i] <= 0) continue;
        sprayLife[i] -= dt;
        if (sprayLife[i] <= 0) {
          sprayPos[i * 3 + 1] = -1e4;
          continue;
        }
        sprayVel[i * 3 + 1] -= 9.8 * dt;
        for (let a = 0; a < 3; a++) sprayPos[i * 3 + a] += sprayVel[i * 3 + a] * dt;
      }
      sprayGeo.attributes.position.needsUpdate = true;
    }

    // Camera rides behind and above the rider; on phones a bit higher so cards don't hide the rider
    const back = camera.aspect < 0.8 ? 15 : 13;
    const up = camera.aspect < 0.8 ? 9 : 6.5;
    point(d - back, camTarget, off * 0.7);
    camTarget.y += up + Math.min(speed, 3);
    lookTarget.copy(point(d + 14, look, off * 0.5)).lerp(here, 0.55);
    if (first) {
      camera.position.copy(camTarget);
      first = false;
    }
    camera.position.lerp(camTarget, Math.min(1, dt * 5));
    camera.lookAt(lookTarget);

    if (FLAKES) {
      flakes.position.copy(camera.position);
      const p = flakeGeo.attributes.position.array;
      const fall = dt * 6;
      for (let i = 0; i < FLAKES; i++) {
        const y = i * 3 + 1;
        p[y] -= fall * (0.6 + (i % 5) * 0.15);
        p[i * 3] += Math.sin(clock.elapsedTime + i) * dt * 0.6;
        if (p[y] < -30) p[y] += 60;
      }
      flakeGeo.attributes.position.needsUpdate = true;
    }

    altEl.textContent = Math.round(2400 - t * 1650).toLocaleString("en-US");
    renderer.render(scene, camera);
    document.documentElement.dataset.scene = "ready";
  });
}
