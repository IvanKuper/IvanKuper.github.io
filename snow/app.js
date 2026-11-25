const stops = [...document.querySelectorAll(".stop")];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const root = document.documentElement;
const noWebgl = () => root.classList.add("no-webgl");

// ---- Page UI (works with or without WebGL, and if the 3D library fails to load) ----
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

const maxScroll = () => Math.max(1, root.scrollHeight - innerHeight);
const progress = document.getElementById("progress");
const onScroll = () => progress.style.setProperty("--p", Math.min(1, scrollY / maxScroll()));
addEventListener("scroll", onScroll, { passive: true });
onScroll();

// ---- 3D scene ----
import("three")
  .then((THREE) => {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("scene"), antialias: true, powerPreference: "high-performance" });
    } catch {
      return noWebgl();
    }
    return buildScene(THREE, renderer);
  })
  .catch(noWebgl);

// Built in small steps with pauses in between, so the page stays responsive on phones while the mountain loads
const pause = () => new Promise((r) => setTimeout(r));

async function buildScene(THREE, renderer) {
  const RUN = 1400; // length of the run in world units
  const START = 40;
  const END = RUN - 80;
  const SLOPE = 0.32;
  const ACCENT = 0xff5a36;
  // Late-afternoon light: deep blue overhead, warm haze on the horizon
  const ZENITH = new THREE.Color(0x3f78bf);
  const HORIZON = new THREE.Color(0xfde9dc);
  const HAZE = new THREE.Color(0xf8efe8);

  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.3;

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
  scene.fog = new THREE.Fog(HAZE, 80, 520);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 3200);
  scene.add(new THREE.HemisphereLight(0xe3eeff, 0x8b9cc4, 1.7));
  const sun = new THREE.DirectionalLight(0xffd2a6, 2.8);
  sun.position.set(-1, 1.1, 0.5);
  scene.add(sun);

  // Sky dome with a soft sun glow, follows the camera
  const sunDir = new THREE.Vector3(-0.5, 0.07, -1).normalize();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2800, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      uniforms: { zenith: { value: ZENITH }, horizon: { value: HORIZON }, sunDir: { value: sunDir } },
      vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(horizon, zenith, pow(h, 0.42));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          col += vec3(1.0, 0.8, 0.55) * (pow(s, 900.0) * 1.5 + pow(s, 60.0) * 0.22 + pow(s, 8.0) * 0.04);
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  sky.renderOrder = -1;
  scene.add(sky);

  // Terrain: warm light on slopes facing the sun, cool blue in the shade
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
  const snow = new THREE.Color(0xfffaf5);
  const shade = new THREE.Color(0xa3bce3);
  const c = new THREE.Color();
  const normals = terrainGeo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    c.copy(shade).lerp(snow, Math.pow(normals.getY(i), 8));
    c.toArray(colors, i * 3);
  }
  terrainGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  scene.add(
    new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }))
  );

  await pause();

  // Distant peaks: rock below, snow on top, faded into the haze like real distance
  const rock = new THREE.Color(0x6f86ad);
  const peakSnow = new THREE.Color(0xffffff);
  const peakMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, fog: false });
  const addPeak = (x, y, z, r, h, haze) => {
    const geo = new THREE.ConeGeometry(r, h, 6 + Math.floor(rand() * 4), 4);
    const p = geo.attributes.position;
    const pc = new Float32Array(p.count * 3);
    const line = 0.05 + rand() * 0.25; // snow line, as a share of the height
    const phase = rand() * 6;
    for (let k = 0; k < p.count; k++) {
      const v = p.getY(k) / h + 0.5;
      // Jagged ridges: the wobble depends only on the angle, so the seam of the cone stays closed
      const wobble = 1 + 0.14 * Math.sin(Math.atan2(p.getZ(k), p.getX(k)) * 3 + v * 5 + phase);
      p.setX(k, p.getX(k) * wobble);
      p.setZ(k, p.getZ(k) * wobble);
      c.copy(rock).lerp(peakSnow, THREE.MathUtils.smoothstep(v, line, line + 0.25)).lerp(HAZE, haze);
      c.toArray(pc, k * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(pc, 3));
    geo.computeVertexNormals();
    const peak = new THREE.Mesh(geo, peakMat);
    peak.position.set(x, y + h / 2 - 40, z);
    peak.rotation.y = rand() * Math.PI;
    scene.add(peak);
  };
  // Along both sides of the valley
  for (let i = 0; i < 16; i++) {
    const r = 160 + rand() * 220;
    const d = (i / 16) * (RUN + 600) + 200;
    addPeak((i % 2 ? 1 : -1) * (420 + rand() * 300), -d * SLOPE - 60, -d - 300, r, r * (0.85 + rand() * 0.6), 0.35);
  }
  // A big range straight ahead, at the far end of the valley
  for (let i = 0; i < 8; i++) {
    const r = 260 + rand() * 200;
    const d = RUN + 650 + rand() * 450;
    addPeak(-760 + i * 220 + rand() * 80, -d * SLOPE - 40, -d, r, r * (1.1 + rand() * 0.6), 0.5);
  }

  const lodgeD = END + 24;
  const lodgeX = pathX(lodgeD) + 13;

  await pause();

  // Pines: two tiers of branches and a snow cap, each tree a slightly different green
  const TREES = isSmall ? 600 : 1100;
  const lowGeo = new THREE.ConeGeometry(2.4, 5, 7).translate(0, 3, 0);
  const highGeo = new THREE.ConeGeometry(1.7, 4, 7).translate(0, 5.6, 0);
  const capGeo = new THREE.ConeGeometry(1.05, 2.2, 7).translate(0, 6.9, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 1.4, 5).translate(0, 0.5, 0);
  const pine = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 });
  const low = new THREE.InstancedMesh(lowGeo, pine, TREES);
  const high = new THREE.InstancedMesh(highGeo, pine, TREES);
  const caps = new THREE.InstancedMesh(capGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), TREES);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5b3d2e, flatShading: true }), TREES);
  const greens = [0x24574a, 0x2f6a52, 0x1f4a44, 0x3a7556, 0x2a5f58];
  const m = new THREE.Object3D();
  let planted = 0;
  for (let i = 0; i < TREES; i++) {
    const d = -120 + rand() * (RUN + 300);
    const side = rand() < 0.5 ? -1 : 1;
    const x = pathX(d) + side * (15 + Math.pow(rand(), 1.6) * 150);
    if (Math.hypot(x - lodgeX, d - lodgeD) < 30) continue;
    m.position.set(x, height(x, d) - 0.3, -d);
    m.rotation.y = rand() * Math.PI;
    const s = 0.7 + rand();
    m.scale.set(s, s * (0.9 + rand() * 0.35), s);
    m.updateMatrix();
    c.setHex(greens[Math.floor(rand() * greens.length)]);
    for (const mesh of [low, high, caps, trunks]) mesh.setMatrixAt(planted, m.matrix);
    low.setColorAt(planted, c);
    high.setColorAt(planted, c.offsetHSL(0, 0, 0.04));
    planted++;
  }
  for (const mesh of [low, high, caps, trunks]) {
    mesh.count = planted;
    scene.add(mesh);
  }

  await pause();

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
    new THREE.MeshStandardMaterial({ color: 0xffc83d, emissive: 0xff8a00, emissiveIntensity: 0.7, flatShading: true }),
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
    g.fillStyle = "rgba(255,255,255,0.25)";
    g.fillRect(0, 0, 512, 10);
    g.fillRect(0, 118, 512, 10);
    g.fillStyle = "#fff";
    g.font = "800 64px 'Bricolage Grotesque', system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text.toUpperCase(), 256, 68);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
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
      new THREE.MeshBasicMaterial({ map: label(i === 0 ? "Start" : s.dataset.label), side: THREE.DoubleSide, toneMapped: false })
    );
    banner.position.y = 5.6;
    gate.add(left, right, banner);
    scene.add(gate);
    return gate;
  });

  // Lodge at the bottom of the run, with warm windows and a chimney
  const lodge = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a3b, flatShading: true });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 9), wood);
  walls.position.y = 3;
  const roof = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, 9, 5, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true })
  );
  roof.position.y = 8.4;
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffc46b, toneMapped: false });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.2), glowMat);
  glow.position.set(0, 3.2, 4.55);
  const side = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.8), glowMat);
  side.position.set(6.05, 3.4, 0);
  side.rotation.y = Math.PI / 2;
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3, 1.2), new THREE.MeshStandardMaterial({ color: 0x6b6f7a, flatShading: true }));
  chimney.position.set(-2.5, 9.5, -1);
  lodge.add(walls, roof, glow, side, chimney);
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
  add(new THREE.CapsuleGeometry(0.36, 2.2, 2, 8).rotateX(Math.PI / 2).scale(1, 0.3, 1), mat(ACCENT), 0, 0.08, 0);
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
  add(new THREE.SphereGeometry(0.34, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xffd166), 0, 2.5, 0);
  add(new THREE.SphereGeometry(0.11, 8, 6), mat(0xffffff), 0, 2.86, 0);
  add(new THREE.BoxGeometry(0.14, 0.16, 0.5), new THREE.MeshStandardMaterial({ color: 0xffb02e, metalness: 0.6, roughness: 0.2 }), 0.27, 2.47, 0);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x3b5470, transparent: true, opacity: 0.25, depthWrite: false })
  );
  rider.scale.setScalar(1.35);
  scene.add(rider, shadow);

  // Carved track left in the snow behind the board
  const TRAIL = 160;
  const trailPts = [];
  const trailPos = new Float32Array(TRAIL * 2 * 3);
  const trailIdx = [];
  for (let i = 0; i < TRAIL - 1; i++) {
    const a = i * 2;
    trailIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setIndex(trailIdx);
  trailGeo.setDrawRange(0, 0);
  const trail = new THREE.Mesh(
    trailGeo,
    new THREE.MeshBasicMaterial({ color: 0xb9cbe6, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })
  );
  trail.frustumCulled = false;
  scene.add(trail);
  const updateTrail = () => {
    for (let i = 0; i < trailPts.length; i++) {
      const p = trailPts[i];
      const n = trailPts[Math.min(i + 1, trailPts.length - 1)];
      const q = trailPts[Math.max(i - 1, 0)];
      let dx = n.x - q.x;
      let dz = n.z - q.z;
      const len = Math.hypot(dx, dz) || 1;
      const w = 0.32 * (i / trailPts.length); // narrows to nothing at the far end
      dx = (-dz / len) * w;
      dz = ((n.x - q.x) / len) * w;
      trailPos.set([p.x + dx, p.y, p.z + dz, p.x - dx, p.y, p.z - dz], i * 6);
    }
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.setDrawRange(0, Math.max(0, trailPts.length - 1) * 6);
  };

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
  let trailMax = prevD;
  const clock = new THREE.Clock();

  await renderer.compileAsync(scene, camera);
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

    // Track: add a point every half metre going down; riding back up wipes it
    if (d < trailMax - 3) trailPts.length = 0;
    trailMax = trailPts.length ? Math.max(trailMax, d) : d;
    const last = trailPts[trailPts.length - 1];
    if (!last || Math.hypot(here.x - last.x, here.z - last.z) > 0.5) {
      trailPts.push(here.clone().setY(here.y + 0.12));
      if (trailPts.length > TRAIL) trailPts.shift();
      updateTrail();
    }

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
    sky.position.copy(camera.position);

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
    root.dataset.scene = "ready";
  });
}
