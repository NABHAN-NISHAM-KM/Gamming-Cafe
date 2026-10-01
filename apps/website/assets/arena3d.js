// ArenaOS home: a real-time 3D arena the visitor flies through by scrolling.
// Five camera poses, one per chapter of the hero:
//   0 the arena · 1 top-down Live Floor · 2 one seat (the Gaming Shell)
//   3 the kitchen (an order flies from the seat) · 4 every branch
// Each station is a full setup (desk, monitor, RGB tower, keyboard, chair);
// screens show a game, a lock screen or a reservation like the real Live Floor.
// Lazy-loaded by site.js; honours prefers-reduced-motion; fine without WebGL.
import * as THREE from "./vendor/three.module.min.js";
import { RoomEnvironment } from "./vendor/RoomEnvironment.js";

const STATUS = {
  free: new THREE.Color("#34d399"),
  busy: new THREE.Color("#a07cff"),
  ending: new THREE.Color("#fb923c"),
  reserved: new THREE.Color("#facc15"),
  vip: new THREE.Color("#2ee6f6"),
};
const WHITE = new THREE.Color(1, 1, 1);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (x) => x * x * x * (x * (x * 6 - 15) + 10);

// ── screen atlas: 4×2 tiles of 512×288 ────────────────────────────────────
// 0 lock screen (free) · 1 reserved · 2–7 games
function drawAtlas(g) {
  const W = 512, H = 288;
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const tile = (t, fn) => { g.save(); g.translate((t % 4) * W, Math.floor(t / 4) * H); g.beginPath(); g.rect(0, 0, W, H); g.clip(); fn(); g.restore(); };
  const grad = (y0, y1, stops) => { const l = g.createLinearGradient(0, y0, 0, y1); stops.forEach(([o, c]) => l.addColorStop(o, c)); return l; };
  const text = (s, x, y, font, color, align = "left") => { g.font = font; g.fillStyle = color; g.textAlign = align; g.fillText(s, x, y); };
  const lock = (accent, title, sub) => {
    const r = g.createRadialGradient(W * 0.3, H * 0.2, 10, W * 0.5, H * 0.5, W * 0.7);
    r.addColorStop(0, "#1c1236"); r.addColorStop(1, "#06060a");
    g.fillStyle = r; g.fillRect(0, 0, W, H);
    g.fillStyle = "#a07cff"; g.fillRect(W / 2 - 22, 70, 44, 44);
    text("A", W / 2, 103, "800 30px sans-serif", "#0b0717", "center");
    text("ArenaOS", W / 2, 145, "700 22px sans-serif", "#f3f1fb", "center");
    g.fillStyle = accent; g.fillRect(W / 2 - 70, 170, 140, 34);
    text(title, W / 2, 193, "700 15px sans-serif", "#06060a", "center");
    text(sub, W / 2, 232, "500 13px monospace", "#8a86a6", "center");
  };
  tile(0, () => lock("#34d399", "SIGN IN TO PLAY", "password or PIN"));
  tile(1, () => lock("#facc15", "RESERVED 21:30", "held for booking #4821"));
  tile(2, () => { // tactical shooter
    g.fillStyle = grad(0, H, [[0, "#f59e5b"], [0.45, "#c2557a"], [0.46, "#2b2236"], [1, "#151018"]]); g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 34) { const h = 40 + rnd() * 90; g.fillStyle = "#3a2438"; g.fillRect(x, 132 - h, 30, h); g.fillStyle = "rgba(255,200,120,.5)"; for (let k = 0; k < 4; k++) g.fillRect(x + 4 + (k % 2) * 12, 140 - h + 12 + Math.floor(k / 2) * 18, 6, 8); }
    g.fillStyle = "#0e0a10"; g.beginPath(); g.moveTo(330, H); g.lineTo(380, 200); g.lineTo(470, 190); g.lineTo(512, 210); g.lineTo(512, H); g.fill();
    g.strokeStyle = "#7dfc9a"; g.lineWidth = 2; g.beginPath(); g.moveTo(W / 2 - 12, H / 2); g.lineTo(W / 2 - 4, H / 2); g.moveTo(W / 2 + 4, H / 2); g.lineTo(W / 2 + 12, H / 2); g.moveTo(W / 2, H / 2 - 12); g.lineTo(W / 2, H / 2 - 4); g.moveTo(W / 2, H / 2 + 4); g.lineTo(W / 2, H / 2 + 12); g.stroke();
    text("100", 24, H - 22, "700 26px sans-serif", "#f3f1fb"); g.fillStyle = "#7dfc9a"; g.fillRect(74, H - 40, 90, 8);
    text("24 / 90", W - 24, H - 22, "700 22px sans-serif", "#f3f1fb", "right");
    text("7 - 5", W / 2, 26, "700 18px sans-serif", "#f3f1fb", "center");
  });
  tile(3, () => { // racing
    g.fillStyle = grad(0, 140, [[0, "#1b2a6b"], [0.7, "#ff7a59"], [1, "#ffc46b"]]); g.fillRect(0, 0, W, 140);
    g.fillStyle = "#2a1f3d"; g.beginPath(); g.moveTo(0, 140); for (let x = 0; x <= W; x += 32) g.lineTo(x, 110 + Math.sin(x * 0.03) * 18 + rnd() * 8); g.lineTo(W, 140); g.fill();
    g.fillStyle = "#1d3b2a"; g.fillRect(0, 140, W, H - 140);
    g.fillStyle = "#3b3b46"; g.beginPath(); g.moveTo(W / 2 - 14, 140); g.lineTo(W / 2 + 14, 140); g.lineTo(W - 20, H); g.lineTo(20, H); g.fill();
    g.fillStyle = "#f3f1fb"; for (let k = 0; k < 6; k++) { const y = 150 + k * k * 4.4; g.fillRect(W / 2 - 1 - k * 0.6, y, 2 + k * 1.2, 4 + k * 2); }
    g.fillStyle = "#c81e4b"; g.fillRect(W / 2 - 46, H - 70, 92, 40); g.fillStyle = "#111"; g.fillRect(W / 2 - 40, H - 80, 80, 14);
    text("212", W - 30, H - 34, "800 34px sans-serif", "#f3f1fb", "right"); text("KM/H", W - 30, H - 16, "600 11px monospace", "#f3f1fb", "right");
    text("P2 / 12   LAP 2/3", 20, 30, "700 15px sans-serif", "#f3f1fb");
  });
  tile(4, () => { // MOBA
    g.fillStyle = "#1f3b24"; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 220; k++) { g.fillStyle = rnd() > 0.5 ? "#24462a" : "#18301d"; g.fillRect(rnd() * W, rnd() * H, 6, 6); }
    g.strokeStyle = "#2f6f9a"; g.lineWidth = 26; g.beginPath(); g.moveTo(0, H); g.quadraticCurveTo(W / 2, H / 2, W, 0); g.stroke();
    g.strokeStyle = "#8a6a3d"; g.lineWidth = 10; g.beginPath(); g.moveTo(30, H - 20); g.lineTo(W - 30, 20); g.moveTo(30, H - 20); g.lineTo(30, 20); g.lineTo(W - 30, 20); g.stroke();
    [["#e74c5a", 300, 80], ["#e74c5a", 420, 40], ["#4c8ae7", 120, 210], ["#4c8ae7", 60, 120]].forEach(([c, x, y]) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); });
    g.fillStyle = "#0b0a12"; g.fillRect(0, H - 50, W, 50); [0, 1, 2, 3].forEach((k) => { g.fillStyle = "#2b2840"; g.fillRect(150 + k * 52, H - 44, 42, 38); });
    g.fillStyle = "#3ccf6a"; g.fillRect(150, H - 54, 200, 6);
  });
  tile(5, () => { // battle royale
    g.fillStyle = grad(0, 120, [[0, "#5aa0d8"], [1, "#bfe0f0"]]); g.fillRect(0, 0, W, 120);
    g.fillStyle = "#4d6b3a"; g.beginPath(); g.moveTo(0, 130); for (let x = 0; x <= W; x += 20) g.lineTo(x, 110 + Math.sin(x * 0.02) * 20); g.lineTo(W, H); g.lineTo(0, H); g.fill();
    g.fillStyle = "#6b8a4a"; g.fillRect(0, 170, W, H - 170);
    g.fillStyle = "rgba(140,60,220,.35)"; g.fillRect(380, 0, 132, H);
    for (let k = 0; k < 8; k++) { g.fillStyle = "#2e4a24"; g.beginPath(); g.moveTo(40 + k * 60, 160); g.lineTo(55 + k * 60, 110); g.lineTo(70 + k * 60, 160); g.fill(); }
    g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(W / 2 - 120, 8, 240, 22); text("N        NE        E        SE", W / 2, 24, "600 12px monospace", "#f3f1fb", "center");
    text("42 ALIVE", W - 18, 52, "700 15px sans-serif", "#f3f1fb", "right");
    g.fillStyle = "#1a1a1a"; g.beginPath(); g.moveTo(300, H); g.lineTo(350, 210); g.lineTo(512, 200); g.lineTo(512, H); g.fill();
  });
  tile(6, () => { // football
    for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? "#2e8a3e" : "#33964a"; g.fillRect(k * 64, 0, 64, H); }
    g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 3; g.strokeRect(20, 20, W - 40, H - 40); g.beginPath(); g.moveTo(W / 2, 20); g.lineTo(W / 2, H - 20); g.stroke(); g.beginPath(); g.arc(W / 2, H / 2, 40, 0, 7); g.stroke(); g.strokeRect(20, H / 2 - 50, 60, 100); g.strokeRect(W - 80, H / 2 - 50, 60, 100);
    for (let k = 0; k < 18; k++) { g.fillStyle = k % 2 ? "#e74c5a" : "#4c8ae7"; g.beginPath(); g.arc(40 + rnd() * (W - 80), 40 + rnd() * (H - 80), 6, 0, 7); g.fill(); }
    g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(16, 12, 130, 26); text("ARS 2 - 1 MCI   67'", 24, 30, "700 12px sans-serif", "#f3f1fb");
  });
  tile(7, () => { // space shooter
    g.fillStyle = "#04030a"; g.fillRect(0, 0, W, H);
    const r = g.createRadialGradient(360, 90, 10, 360, 90, 220); r.addColorStop(0, "rgba(160,60,200,.55)"); r.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = r; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 160; k++) { g.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.7})`; g.fillRect(rnd() * W, rnd() * H, 1.5, 1.5); }
    g.fillStyle = "#2ee6f6"; g.beginPath(); g.moveTo(W / 2, H - 70); g.lineTo(W / 2 - 22, H - 30); g.lineTo(W / 2 + 22, H - 30); g.fill();
    g.fillStyle = "#ff5d7a"; for (let k = 0; k < 4; k++) g.fillRect(W / 2 - 2, H - 100 - k * 40, 4, 22);
    [[150, 70], [320, 50], [400, 120]].forEach(([x, y]) => { g.fillStyle = "#c084fc"; g.beginPath(); g.ellipse(x, y, 20, 10, 0, 0, 7); g.fill(); });
    text("SCORE 184 220", 16, 26, "700 14px monospace", "#f3f1fb");
  });
}

export function mountArena(host, { progress = () => 0, onStats } = {}) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  if (!gl) return null;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "A 3D gaming arena: rows of gaming PCs with RGB towers and chairs, screens showing games and lock screens, a kitchen counter and other branches, viewed from a camera that moves as you scroll.");
  host.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const shadows = innerWidth > 820 && (navigator.hardwareConcurrency ?? 8) >= 6;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x060609, 0.03);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.22;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 400);

  const canvasTex = (w, h) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { c, g: c.getContext("2d"), t };
  };
  const glowTex = (() => {
    const { g, t } = canvasTex(64, 64);
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.35, "rgba(255,255,255,.35)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return t;
  })();
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
  const std = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const led = () => new THREE.MeshBasicMaterial({ toneMapped: false });

  // ── room ────────────────────────────────────────────────────────────────
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), std(0x0b0a10, 0.32, 0.35));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(260, 130, 0x5b3fc4, 0x1a1828);
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
  grid.position.y = 0.002;
  scene.add(grid);

  const WALL_Z = -9.6;
  const room = new THREE.Group(); // back wall, fades out when the camera rises to show every branch
  scene.add(room);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(40, 14, 0.3), std(0x0c0b12, 0.85));
  wall.position.set(0, 7, WALL_Z);
  wall.receiveShadow = true;
  room.add(wall);
  const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(1.25, 4.2, 0.12), std(0x15131e, 0.95), 22);
  for (let k = 0; k < 22; k++) {
    const x = -16 + k * 1.5 + 0.2;
    panels.setMatrixAt(k, new THREE.Matrix4().makeTranslation(x, 2.8, WALL_Z + 0.2 + (k % 3) * 0.03));
  }
  room.add(panels);
  const neon = (w, h, x, y, color) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    m.position.set(x, y, WALL_Z + 0.32);
    room.add(m);
  };
  neon(34, 0.04, 0, 5.15, 0xa07cff);
  neon(34, 0.04, 0, 0.35, 0x2ee6f6);
  [-12.6, -6.6, 6.6, 12.6].forEach((x) => neon(0.04, 4.4, x, 2.8, 0xa07cff));
  // LED wall: tonight's tournament.
  const board = canvasTex(1024, 440);
  {
    const g = board.g;
    const bg = g.createLinearGradient(0, 0, 1024, 440);
    bg.addColorStop(0, "#160d2e"); bg.addColorStop(1, "#05040a");
    g.fillStyle = bg; g.fillRect(0, 0, 1024, 440);
    g.fillStyle = "#a07cff"; g.font = "600 22px monospace"; g.fillText("TONIGHT · 21:00 · MAIN STAGE", 48, 64);
    g.fillStyle = "#f3f1fb"; g.font = "900 96px sans-serif"; g.fillText("VALORANT CUP", 44, 170);
    g.fillStyle = "#2ee6f6"; g.font = "700 30px sans-serif"; g.fillText("16 teams · AED 10,000 prize pool", 48, 222);
    const teams = [["Night Owls", "13"], ["Marina Five", "9"], ["Desert Aces", "11"], ["Byte Club", "13"]];
    teams.forEach(([t, s], k) => {
      const x = 48 + (k % 2) * 470, y = 270 + Math.floor(k / 2) * 74;
      g.fillStyle = "#1c1830"; g.fillRect(x, y, 440, 58);
      g.fillStyle = s === "13" ? "#34d399" : "#8a86a6"; g.fillRect(x, y, 6, 58);
      g.fillStyle = "#f3f1fb"; g.font = "700 26px sans-serif"; g.fillText(t, x + 24, y + 38);
      g.textAlign = "right"; g.fillText(s, x + 420, y + 38); g.textAlign = "left";
    });
  }
  const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.1), new THREE.MeshBasicMaterial({ map: board.t, toneMapped: false }));
  boardMesh.position.set(0, 3.0, WALL_Z + 0.36);
  room.add(boardMesh);
  const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(7.45, 3.35, 0.1), std(0x07070b, 0.4, 0.6));
  boardFrame.position.set(0, 3.0, WALL_Z + 0.3);
  room.add(boardFrame);

  room.traverse((o) => o.material && (o.material.transparent = true));

  // ── stations ────────────────────────────────────────────────────────────
  const rows = 4;
  const cols = 9;
  const n = rows * cols;
  const pos = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) pos.push({ x: (c - (cols - 1) / 2) * 2.05, z: (r - (rows - 1) / 2) * 2.6 - 1.5 });

  // Each part: geometry, material, and its placements relative to the desk centre
  // [dx, dy, dz, rx, ry, rz]. One InstancedMesh per part.
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const SPOKES = [0, 1, 2, 3, 4].map((k) => { const a = (k / 5) * Math.PI * 2; return [Math.cos(a) * 0.17, 0.07, 0.8 - Math.sin(a) * 0.17, 0, a, 0]; });
  const parts = {
    deskTop: [box(1.6, 0.05, 0.8), std(0x18161f, 0.45, 0.15), [[0, 0.75, 0]]],
    legs: [box(0.05, 0.72, 0.05), std(0x2a2a33, 0.3, 0.9), [[-0.74, 0.365, -0.34], [0.74, 0.365, -0.34], [-0.74, 0.365, 0.34], [0.74, 0.365, 0.34]]],
    mousepad: [box(1.0, 0.004, 0.4), std(0x0c0c11, 0.95), [[0.05, 0.777, 0.12]]],
    monBody: [box(0.8, 0.47, 0.03), std(0x0b0b10, 0.35, 0.5), [[0, 1.1, -0.2]]],
    monBack: [box(0.42, 0.26, 0.06), std(0x101016, 0.5, 0.4), [[0, 1.08, -0.245]]],
    monNeck: [box(0.05, 0.32, 0.04), std(0x2a2a33, 0.3, 0.9), [[0, 0.93, -0.27]]],
    monBase: [box(0.3, 0.012, 0.2), std(0x2a2a33, 0.3, 0.9), [[0, 0.781, -0.24]]],
    keyboard: [box(0.44, 0.022, 0.14), std(0x101015, 0.5, 0.3), [[-0.06, 0.789, 0.12]]],
    mouse: [new THREE.SphereGeometry(1, 16, 10).scale(0.034, 0.017, 0.055), std(0x101015, 0.35, 0.3), [[0.34, 0.785, 0.13]]],
    tower: [box(0.22, 0.46, 0.44), std(0x0d0d12, 0.15, 0.6), [[0.62, 1.005, -0.12]]],
    seat: [box(0.52, 0.09, 0.5), std(0x17151f, 0.75), [[0, 0.52, 0.8]]],
    back: [box(0.5, 0.82, 0.09), std(0x17151f, 0.75), [[0, 1.02, 1.07, 0.12, 0, 0]]],
    wings: [box(0.08, 0.5, 0.12), std(0x17151f, 0.75), [[-0.27, 1.08, 1.09, 0.12, 0, 0], [0.27, 1.08, 1.09, 0.12, 0, 0]]],
    arms: [box(0.06, 0.04, 0.3), std(0x1b1a22, 0.6), [[-0.31, 0.72, 0.8], [0.31, 0.72, 0.8]]],
    armPosts: [box(0.04, 0.2, 0.04), std(0x2a2a33, 0.3, 0.9), [[-0.31, 0.61, 0.8], [0.31, 0.61, 0.8]]],
    lift: [new THREE.CylinderGeometry(0.03, 0.03, 0.4, 12), std(0x2a2a33, 0.25, 0.95), [[0, 0.28, 0.8]]],
    spokes: [box(0.34, 0.03, 0.045), std(0x101015, 0.4, 0.5), SPOKES],
    // Lit parts: colour set per frame.
    stripe: [box(0.12, 0.74, 0.1), std(0xffffff, 0.6), [[0, 1.02, 1.07, 0.12, 0, 0]]],
    keysRgb: [new THREE.PlaneGeometry(0.42, 0.12).rotateX(-Math.PI / 2), led(), [[-0.06, 0.801, 0.12]]],
    fans: [new THREE.TorusGeometry(0.06, 0.009, 8, 32), led(), [[0.62, 1.15, 0.101], [0.62, 1.0, 0.101], [0.62, 0.85, 0.101]]],
    towerGlow: [box(0.005, 0.4, 0.38), led(), [[0.508, 1.005, -0.12]]],
    strips: [box(1.6, 0.012, 0.012), led(), [[0, 0.722, 0.405]]],
  };
  const P = {};
  const m4 = new THREE.Matrix4();
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const v = new THREE.Vector3();
  for (const [name, [geo, mat, items]] of Object.entries(parts)) {
    const mesh = new THREE.InstancedMesh(geo, mat, n * items.length);
    mesh.castShadow = shadows && !(mat instanceof THREE.MeshBasicMaterial);
    mesh.receiveShadow = shadows;
    for (let i = 0; i < n; i++)
      items.forEach(([dx, dy, dz, rx = 0, ry = 0, rz = 0], k) => {
        q.setFromEuler(e.set(rx, ry, rz));
        mesh.setMatrixAt(i * items.length + k, m4.compose(v.set(pos[i].x + dx, dy, pos[i].z + dz), q, one));
      });
    if (mat instanceof THREE.MeshBasicMaterial || name === "stripe") mesh.setColorAt(0, WHITE);
    scene.add(mesh);
    P[name] = { mesh, per: items.length };
  }

  // Screens: one atlas, a per-instance tile offset picks game / lock / reserved.
  const atlas = canvasTex(2048, 576);
  drawAtlas(atlas.g);
  atlas.t.needsUpdate = true;
  const screenGeo = new THREE.PlaneGeometry(0.77, 0.435);
  const uvOff = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
  screenGeo.setAttribute("uvOff", uvOff);
  const screenMat = new THREE.MeshBasicMaterial({ map: atlas.t, toneMapped: false });
  screenMat.onBeforeCompile = (sh) => {
    sh.vertexShader = "attribute vec2 uvOff;\n" + sh.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv = vMapUv * vec2(0.25, 0.5) + uvOff;\n#endif");
  };
  const screens = new THREE.InstancedMesh(screenGeo, screenMat, n);
  for (let i = 0; i < n; i++) screens.setMatrixAt(i, m4.makeTranslation(pos[i].x, 1.1, pos[i].z - 0.184));
  scene.add(screens);
  const setTile = (i, t) => { uvOff.setXY(i, (t % 4) * 0.25, t < 4 ? 0.5 : 0); uvOff.needsUpdate = true; };

  // Top-down status tiles: what the Live Floor map shows, fades in for chapter 1.
  const tiles = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.8, 2.3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ ...additive, opacity: 0, toneMapped: false }), n);
  for (let i = 0; i < n; i++) tiles.setMatrixAt(i, m4.makeTranslation(pos[i].x, 0.01, pos[i].z + 0.4));
  scene.add(tiles);

  const HERO = 3 * cols + 6; // PC-07: front row, right of centre
  const kinds = ["busy", "busy", "busy", "free", "busy", "ending", "busy", "reserved", "free", "busy"];
  const state = pos.map((_, i) => {
    const r = Math.floor(i / cols);
    const kind = i === HERO ? "busy" : r === 0 && i % 3 === 0 ? "vip" : kinds[(i * 7) % kinds.length];
    return { kind, game: 2 + ((i * 5) % 6), hue: (i * 0.137) % 1, color: STATUS[kind].clone(), target: STATUS[kind].clone(), flicker: Math.random() * 10 };
  });
  const tileFor = (s) => (s.kind === "free" ? 0 : s.kind === "reserved" ? 1 : s.game);
  state.forEach((s, i) => setTile(i, tileFor(s)));
  // Chair accents: violet on the main floor, cyan in the VIP row.
  state.forEach((s, i) => P.stripe.mesh.setColorAt(i, new THREE.Color(i < cols ? "#1aa9b5" : "#6d4ad6")));

  // Screen glow on the desks.
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos.flatMap((p) => [p.x, 1.05, p.z - 0.05]), 3));
  glowGeo.setAttribute("color", new THREE.Float32BufferAttribute(new Array(n * 3).fill(1), 3));
  const glow = new THREE.Points(glowGeo, new THREE.PointsMaterial({ ...additive, size: 1.9, map: glowTex, vertexColors: true, opacity: 0.32 }));
  scene.add(glow);

  // ── the hero seat: PC-07 runs the Gaming Shell on a live canvas ─────────
  const shell = canvasTex(512, 290);
  const shellScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.77, 0.435), new THREE.MeshBasicMaterial({ map: shell.t, toneMapped: false, transparent: true, opacity: 0 }));
  shellScreen.position.set(pos[HERO].x, 1.1, pos[HERO].z - 0.182);
  scene.add(shellScreen);
  let left = 1 * 3600 + 24 * 60 + 7;
  const drawShell = () => {
    const { g } = shell;
    const grd = g.createLinearGradient(0, 0, 512, 290);
    grd.addColorStop(0, "#1a1033");
    grd.addColorStop(1, "#07070c");
    g.fillStyle = grd;
    g.fillRect(0, 0, 512, 290);
    g.fillStyle = "rgba(160,124,255,.18)";
    g.fillRect(0, 0, 512, 26);
    g.fillStyle = "#b4b0cc";
    g.font = "500 13px monospace";
    g.textAlign = "left";
    g.fillText("PC-07  ·  ahmed  ·  Gold member", 14, 18);
    const cx = 150, cy = 158, R = 82;
    g.lineWidth = 12;
    g.strokeStyle = "#2e2c40";
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = "#a07cff";
    g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (left / 7200)); g.stroke();
    const hms = [Math.floor(left / 3600), Math.floor(left / 60) % 60, left % 60].map((x, k) => (k ? String(x).padStart(2, "0") : x)).join(":");
    g.fillStyle = "#f3f1fb";
    g.font = "700 34px sans-serif";
    g.textAlign = "center";
    g.fillText(hms, cx, cy + 6);
    g.font = "500 12px monospace";
    g.fillStyle = "#8a86a6";
    g.fillText("TIME LEFT", cx, cy + 30);
    g.textAlign = "left";
    ["Valorant", "CS2", "Fortnite", "Food & drinks"].forEach((label, k) => {
      g.fillStyle = k === 3 ? "rgba(251,146,60,.2)" : "rgba(255,255,255,.06)";
      g.fillRect(278, 62 + k * 50, 210, 40);
      g.fillStyle = k === 3 ? "#fb923c" : "#f3f1fb";
      g.font = "600 16px sans-serif";
      g.fillText(label, 294, 88 + k * 50);
    });
    shell.t.needsUpdate = true;
  };
  drawShell();

  // ── kitchen counter with a KDS screen ───────────────────────────────────
  const K = new THREE.Vector3(12.6, 0, -1.5);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.05, 6.5), std(0x17151f, 0.4, 0.4));
  counter.position.set(K.x, 0.525, K.z);
  counter.castShadow = counter.receiveShadow = shadows;
  scene.add(counter);
  const counterTop = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.05, 6.7), std(0x2b2834, 0.2, 0.3));
  counterTop.position.set(K.x, 1.075, K.z);
  scene.add(counterTop);
  const counterEdge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 6.5), new THREE.MeshBasicMaterial({ color: 0xfb923c, toneMapped: false }));
  counterEdge.position.set(K.x - 0.66, 1.0, K.z);
  scene.add(counterEdge);
  const kds = canvasTex(512, 300);
  const kdsScreen = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.875), new THREE.MeshBasicMaterial({ map: kds.t, toneMapped: false }));
  kdsScreen.position.set(K.x - 0.1, 2.5, K.z);
  kdsScreen.rotation.y = -Math.PI / 2;
  scene.add(kdsScreen);
  const kdsLight = new THREE.PointLight(0xfb923c, 0, 12, 1.6);
  kdsLight.position.set(K.x - 2, 2.6, K.z);
  scene.add(kdsLight);
  let flash = 0;
  let orders = 41;
  const tickets = [["T3", "2× Fries", 6], ["PC-14", "Iced latte", 3], ["PC-02", "Club sandwich", 1]];
  const drawKds = () => {
    const { g } = kds;
    g.fillStyle = "#0b0a12";
    g.fillRect(0, 0, 512, 300);
    g.fillStyle = "#fb923c";
    g.font = "700 18px sans-serif";
    g.fillText("KITCHEN · 4 open", 16, 30);
    tickets.slice(0, 4).forEach(([seat, item, mins], k) => {
      const x = 16 + k * 124;
      const hot = k === 0 && flash > 0;
      g.fillStyle = hot ? `rgba(251,146,60,${0.25 + flash * 0.5})` : "#16141f";
      g.fillRect(x, 48, 112, 232);
      g.fillStyle = hot ? "#fb923c" : "#2e2c40";
      g.fillRect(x, 48, 112, 4);
      g.fillStyle = "#f3f1fb";
      g.font = "700 17px sans-serif";
      g.fillText(seat, x + 10, 80);
      g.font = "500 13px sans-serif";
      g.fillStyle = "#b4b0cc";
      g.fillText(item, x + 10, 104);
      g.font = "500 12px monospace";
      g.fillStyle = mins > 5 ? "#fb5d7a" : "#8a86a6";
      g.fillText(`${mins} min`, x + 10, 262);
    });
    kds.t.needsUpdate = true;
  };
  drawKds();

  // An order flying from PC-07 to the kitchen.
  const orderPath = new THREE.QuadraticBezierCurve3(new THREE.Vector3(pos[HERO].x, 1.25, pos[HERO].z - 0.2), new THREE.Vector3((pos[HERO].x + K.x) / 2, 4.6, (pos[HERO].z + K.z) / 2), new THREE.Vector3(K.x - 0.2, 2.5, K.z));
  const orderTrail = new THREE.Line(new THREE.BufferGeometry().setFromPoints(orderPath.getPoints(48)), new THREE.LineBasicMaterial({ color: 0xfb923c, ...additive, opacity: 0 }));
  scene.add(orderTrail);
  const order = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfb923c, ...additive, opacity: 0 }));
  order.scale.setScalar(1.1);
  scene.add(order);
  let orderT = 0;

  // ── other branches: islands of stations linked to this one ──────────────
  const branches = new THREE.Group();
  scene.add(branches);
  const ISLANDS = [[-52, -38], [50, -44], [-60, 26], [58, 30], [4, -78], [-8, 62]];
  const islandPts = [];
  const islandCol = [];
  const statusList = Object.values(STATUS);
  const arcs = [];
  for (const [ix, iz] of ISLANDS) {
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 7; c++) {
        islandPts.push(ix + (c - 3) * 2.2, 0.6, iz + (r - 1.5) * 2.6);
        const col = statusList[(r * 7 + c + ix) % 5 === 0 ? 0 : (r + c) % 3 ? 1 : (c % 2) + 2];
        islandCol.push(col.r, col.g, col.b);
      }
    const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-9, -6.5], [9, -6.5], [9, 6.5], [-9, 6.5]].map(([x, z]) => new THREE.Vector3(ix + x, 0.05, iz + z))), new THREE.LineBasicMaterial({ color: 0x5b3fc4, ...additive, opacity: 0 }));
    branches.add(outline);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.5, -1.5), new THREE.Vector3(ix / 2, 22, iz / 2), new THREE.Vector3(ix, 0.5, iz));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(64)), new THREE.LineBasicMaterial({ color: 0x2ee6f6, ...additive, opacity: 0 }));
    branches.add(line);
    const packet = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x2ee6f6, ...additive, opacity: 0 }));
    packet.scale.setScalar(2.2);
    branches.add(packet);
    arcs.push({ curve, line, outline, packet, off: Math.random() });
  }
  const islandGeo = new THREE.BufferGeometry();
  islandGeo.setAttribute("position", new THREE.Float32BufferAttribute(islandPts, 3));
  islandGeo.setAttribute("color", new THREE.Float32BufferAttribute(islandCol, 3));
  const islands = new THREE.Points(islandGeo, new THREE.PointsMaterial({ ...additive, size: 3.2, map: glowTex, vertexColors: true, opacity: 0 }));
  branches.add(islands);

  // Dust in the light.
  const pc = 320;
  const pgeo = new THREE.BufferGeometry();
  const pp = new Float32Array(pc * 3);
  for (let i = 0; i < pc; i++) {
    pp[i * 3] = (Math.random() - 0.5) * 36;
    pp[i * 3 + 1] = Math.random() * 6;
    pp[i * 3 + 2] = (Math.random() - 0.5) * 18 - 2;
  }
  pgeo.setAttribute("position", new THREE.BufferAttribute(pp, 3));
  scene.add(new THREE.Points(pgeo, new THREE.PointsMaterial({ ...additive, size: 0.05, color: 0xb9a3ff, opacity: 0.5 })));

  // Session-start pulses.
  const pulses = Array.from({ length: 6 }, () => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 48), new THREE.MeshBasicMaterial({ ...additive, color: 0xa07cff, opacity: 0, side: THREE.DoubleSide, toneMapped: false }));
    m.rotation.x = -Math.PI / 2;
    scene.add(m);
    return { m, t: 1 };
  });
  let nextPulse = 0;
  const pulseAt = (i, color) => {
    const p = pulses[nextPulse++ % pulses.length];
    p.m.position.set(pos[i].x, 0.03, pos[i].z + 0.4);
    p.m.material.color.copy(color);
    p.t = 0;
  };

  // ── lights ──────────────────────────────────────────────────────────────
  scene.add(new THREE.HemisphereLight(0x8a7bd8, 0x0a0812, 0.5));
  const sun = new THREE.DirectionalLight(0xd9d2ff, 1.4);
  sun.position.set(4, 14, 9);
  sun.target.position.set(0, 0, -1.5);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 12, bottom: -12, near: 1, far: 40 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const key = new THREE.PointLight(0xa07cff, 60, 30, 1.6);
  key.position.set(-6, 5, 4);
  scene.add(key);
  const rim = new THREE.PointLight(0x2ee6f6, 45, 30, 1.6);
  rim.position.set(7, 4, -7);
  scene.add(rim);
  const wallWash = new THREE.PointLight(0x7c4dff, 30, 14, 1.6);
  wallWash.position.set(0, 4.5, WALL_Z + 2);
  scene.add(wallWash);

  // ── camera path ─────────────────────────────────────────────────────────
  const h = pos[HERO];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const POSES = [
    { p: V(14, 6, 15), l: V(0, 1, -2.5) }, // the arena
    { p: V(0.5, 31, 2.5), l: V(0.5, 0, -1.5) }, // top-down Live Floor
    { p: V(h.x - 0.6, 2.25, h.z + 2.3), l: V(h.x + 0.05, 1.04, h.z - 0.2) }, // the seat
    { p: V(7.6, 2.7, 3.2), l: V(K.x, 2.0, K.z) }, // the kitchen
    { p: V(6, 74, 80), l: V(0, 0, -6) }, // every branch
  ];
  const camPos = POSES[0].p.clone();
  const camLook = POSES[0].l.clone();
  const tmpP = new THREE.Vector3();
  const tmpL = new THREE.Vector3();

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener("pointermove", (ev) => {
    pointer.tx = ev.clientX / innerWidth - 0.5;
    pointer.ty = ev.clientY / innerHeight - 0.5;
  }, { passive: true });

  const resize = () => {
    const w = host.clientWidth;
    const hh = host.clientHeight;
    renderer.setSize(w, hh, false);
    camera.aspect = w / hh;
    const wide = w > 820;
    camera.fov = wide ? 42 : 60;
    // Push the subject right of centre on wide screens; the copy sits on the left.
    if (wide) camera.setViewOffset(w, hh, -w * 0.17, 0, w, hh);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(host);
  resize();

  let visible = true;
  new IntersectionObserver(([en]) => (visible = en.isIntersecting), { threshold: 0 }).observe(host);

  const stats = () => {
    if (!onStats) return;
    const c = { free: 0, busy: 0, ending: 0, reserved: 0, vip: 0 };
    state.forEach((s) => c[s.kind]++);
    onStats(c);
  };
  stats();

  const clock = new THREE.Clock();
  let t = 0;
  let statusTimer = 0;
  let secTimer = 0;
  let first = true;
  const colorAttr = glowGeo.getAttribute("color");
  const tmpC = new THREE.Color();
  const rgb = new THREE.Color();
  const orange = STATUS.ending;
  const flagged = ["keysRgb", "fans", "towerGlow", "strips", "stripe"].map((k) => P[k].mesh);

  function frame() {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    const dt = Math.min(0.05, clock.getDelta());
    t += dt;

    // Where are we on the path? Hold on each pose a little, then glide.
    const raw = clamp(progress()) * (POSES.length - 1);
    const seg = reduced ? Math.round(raw) : raw;
    const i0 = Math.min(POSES.length - 2, Math.floor(seg));
    const f = smooth(clamp((seg - i0 - 0.18) / 0.64));
    tmpP.lerpVectors(POSES[i0].p, POSES[i0 + 1].p, f);
    tmpL.lerpVectors(POSES[i0].l, POSES[i0 + 1].l, f);
    const w = (k) => clamp(1 - Math.abs(seg - k) * 1.6); // weight of chapter k
    const [w1, w2, w3] = [w(1), w(2), w(3)];
    const w4 = clamp(seg - 3);

    // Live floor: every ~1.2 s a station changes, like real sessions.
    statusTimer += dt;
    if (statusTimer > 1.2 && !reduced) {
      statusTimer = 0;
      const i = Math.floor(Math.random() * n);
      const s = state[i];
      const next = s.kind === "free" ? "busy" : s.kind === "busy" ? (Math.random() < 0.5 ? "ending" : "busy") : s.kind === "ending" ? "free" : s.kind === "reserved" ? "busy" : s.kind;
      if (i !== HERO && next !== s.kind) {
        if (next === "busy") { pulseAt(i, STATUS.busy); s.game = 2 + Math.floor(Math.random() * 6); }
        s.kind = next;
        s.target.copy(STATUS[next]);
        setTile(i, tileFor(s));
        stats();
      }
    }
    secTimer += dt;
    if (secTimer >= 1) {
      secTimer = 0;
      left = left > 0 ? left - 1 : 7200;
      if (w2 > 0) drawShell();
      tickets.forEach((tk) => tk[2]++);
      if (w3 > 0 || flash > 0) drawKds();
    }

    for (let i = 0; i < n; i++) {
      const s = state[i];
      s.color.lerp(s.target, 0.08);
      const b = 0.92 + 0.08 * Math.sin(t * 1.3 + s.flicker);
      // Screens: the picture itself, warmed and pulsing when time is nearly up.
      tmpC.copy(WHITE);
      if (s.kind === "ending") tmpC.lerp(orange, 0.35 + 0.3 * Math.sin(t * 5 + s.flicker));
      screens.setColorAt(i, tmpC.multiplyScalar(b));
      tiles.setColorAt(i, s.color);
      P.strips.mesh.setColorAt(i, s.color);
      colorAttr.setXYZ(i, s.color.r * 0.6 + 0.3, s.color.g * 0.6 + 0.3, s.color.b * 0.6 + 0.3);
      // RGB: keyboards and fans cycle hue; the tower glass follows status.
      rgb.setHSL((s.hue + t * 0.08) % 1, 0.85, 0.55);
      P.keysRgb.mesh.setColorAt(i, rgb);
      for (let k = 0; k < 3; k++) P.fans.mesh.setColorAt(i * 3 + k, tmpC.setHSL((s.hue + t * 0.08 + k * 0.06) % 1, 0.9, 0.55));
      P.towerGlow.mesh.setColorAt(i, tmpC.copy(s.color).multiplyScalar(0.55));
    }
    screens.instanceColor.needsUpdate = true;
    tiles.instanceColor.needsUpdate = true;
    for (const m of flagged) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    colorAttr.needsUpdate = true;
    tiles.material.opacity = w1 * 0.55;
    glow.material.opacity = 0.32 * (1 - w1 * 0.6);
    shellScreen.material.opacity = clamp(w2 * 2.2 + w3);

    for (const p of pulses) {
      if (p.t >= 1) continue;
      p.t = Math.min(1, p.t + dt * 0.7);
      const k = 1 + p.t * 7;
      p.m.scale.set(k, k, k);
      p.m.material.opacity = (1 - p.t) * 0.9;
    }

    // Chapter 3: orders fly from the seat to the kitchen screen.
    orderTrail.material.opacity = w3 * 0.35;
    if (w3 > 0.05) {
      orderT += dt * (reduced ? 0 : 0.45);
      if (orderT >= 1) {
        orderT = 0;
        flash = 1;
        orders++;
        tickets.unshift(["PC-07", ["Smash burger", "Loaded nachos", "Energy drink"][orders % 3], 0]);
        tickets.length = 4;
        drawKds();
      }
      orderPath.getPoint(reduced ? 0.5 : orderT, order.position);
    }
    order.material.opacity = w3 * (reduced ? 0.8 : Math.sin(orderT * Math.PI));
    flash = Math.max(0, flash - dt * 0.8);
    kdsLight.intensity = 6 + w3 * 14 + flash * 30;

    // Chapter 4: the other branches light up; the back wall gets out of the way.
    room.visible = w4 < 0.98;
    room.traverse((o) => o.material && (o.material.opacity = 1 - w4));
    islands.material.opacity = w4;
    for (const a of arcs) {
      a.line.material.opacity = w4 * 0.5;
      a.outline.material.opacity = w4 * 0.6;
      a.packet.material.opacity = w4;
      a.curve.getPoint(reduced ? 0.5 : (t * 0.25 + a.off) % 1, a.packet.position);
    }

    if (!reduced) {
      for (let i = 0; i < pc; i++) {
        pp[i * 3 + 1] += dt * (0.08 + (i % 7) * 0.02);
        if (pp[i * 3 + 1] > 6) pp[i * 3 + 1] = 0;
      }
      pgeo.getAttribute("position").needsUpdate = true;
    }

    // Camera: ease toward the path; a little pointer parallax (less up close).
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    const near = 1 - w2 * 0.85;
    tmpP.x += pointer.x * 1.6 * near;
    tmpP.y -= pointer.y * 1.0 * near;
    const k = first || reduced ? 1 : 1 - Math.exp(-dt * 5);
    first = false;
    camPos.lerp(tmpP, k);
    camLook.lerp(tmpL, k);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    scene.fog.density = 0.55 / Math.max(8, camPos.distanceTo(camLook));

    renderer.render(scene, camera);
  }
  frame();
  host.classList.add("arena3d-ready");
  return { destroy: () => renderer.dispose() };
}
