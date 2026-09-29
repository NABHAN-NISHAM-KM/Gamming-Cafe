// ArenaOS hero: a real-time 3D gaming arena. Rows of stations whose screens
// change status like the Live Floor (free · in use · ending · reserved), a
// pulse ring when a session starts, floating light, and a camera that drifts
// with the pointer and scroll. Loaded lazily; pauses off-screen; honours
// prefers-reduced-motion; falls back to CSS on devices without WebGL.
import * as THREE from "./vendor/three.module.min.js";

const STATUS = {
  free: new THREE.Color("#34d399"),
  busy: new THREE.Color("#a07cff"),
  ending: new THREE.Color("#fb923c"),
  reserved: new THREE.Color("#facc15"),
  vip: new THREE.Color("#2ee6f6"),
};

export function mountArena(host) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  if (!gl) return null;
  host.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x07070c, 0.055);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);

  // ── floor ───────────────────────────────────────────────────────────────
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x0b0a14, roughness: 0.35, metalness: 0.6 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(120, 80, 0x7c4dff, 0x241f3d);
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  grid.position.y = 0.002;
  scene.add(grid);

  // ── stations (instanced) ────────────────────────────────────────────────
  const rows = 4;
  const cols = 9;
  const n = rows * cols;
  const desks = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.08, 0.8), new THREE.MeshStandardMaterial({ color: 0x161427, roughness: 0.5, metalness: 0.4 }), n);
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(1.35, 0.72, 0.06), new THREE.MeshStandardMaterial({ color: 0x0e0d18, roughness: 0.8 }), n);
  const bezels = new THREE.InstancedMesh(new THREE.BoxGeometry(1.08, 0.66, 0.05), new THREE.MeshStandardMaterial({ color: 0x07070c, roughness: 0.3, metalness: 0.7 }), n);
  const screens = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.0, 0.58), new THREE.MeshBasicMaterial({ toneMapped: false }), n);
  const chairs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.9, 0.12), new THREE.MeshStandardMaterial({ color: 0x1c1a2e, roughness: 0.6 }), n);
  const strips = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.02, 0.02), new THREE.MeshBasicMaterial({ toneMapped: false }), n);
  [desks, legs, bezels, screens, chairs, strips].forEach((m) => scene.add(m));

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = [];
  const state = [];
  const kinds = ["busy", "busy", "busy", "free", "busy", "ending", "busy", "reserved", "free", "busy"];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = (c - (cols - 1) / 2) * 2.05;
      const z = (r - (rows - 1) / 2) * 2.6 - 1.5;
      pos.push({ x, z });
      const vip = r === 0;
      state.push({ kind: vip && i % 3 === 0 ? "vip" : kinds[(i * 7) % kinds.length], color: new THREE.Color(), target: new THREE.Color(), flicker: Math.random() * 10 });
      q.setFromAxisAngle(up, 0);
      m4.compose(new THREE.Vector3(x, 0.76, z), q, new THREE.Vector3(1, 1, 1));
      desks.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(x, 0.37, z + 0.34), q, new THREE.Vector3(1, 1, 1));
      legs.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(x, 1.18, z - 0.22), q, new THREE.Vector3(1, 1, 1));
      bezels.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(x, 1.18, z - 0.19), q, new THREE.Vector3(1, 1, 1));
      screens.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(x, 0.95, z + 0.95), q, new THREE.Vector3(1, 1, 1));
      chairs.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(x, 0.8, z + 0.41), q, new THREE.Vector3(1, 1, 1));
      strips.setMatrixAt(i, m4);
    }
  }
  const paint = (i, instant) => {
    const s = state[i];
    s.target.copy(STATUS[s.kind]);
    if (instant) s.color.copy(s.target);
  };
  state.forEach((_, i) => paint(i, true));

  // Screen glow: one additive point sprite per screen.
  const glowTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.35, "rgba(255,255,255,.35)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos.flatMap((p) => [p.x, 1.2, p.z - 0.1]), 3));
  glowGeo.setAttribute("color", new THREE.Float32BufferAttribute(new Array(n * 3).fill(1), 3));
  const glow = new THREE.Points(glowGeo, new THREE.PointsMaterial({ size: 2.6, map: glowTex, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(glow);

  // Floating particles.
  const pc = 380;
  const pgeo = new THREE.BufferGeometry();
  const pp = new Float32Array(pc * 3);
  for (let i = 0; i < pc; i++) {
    pp[i * 3] = (Math.random() - 0.5) * 34;
    pp[i * 3 + 1] = Math.random() * 9;
    pp[i * 3 + 2] = (Math.random() - 0.5) * 22 - 2;
  }
  pgeo.setAttribute("position", new THREE.BufferAttribute(pp, 3));
  const particles = new THREE.Points(pgeo, new THREE.PointsMaterial({ size: 0.09, color: 0xb9a3ff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(particles);

  // Holographic ring above the stage.
  const ring = new THREE.Group();
  const torus = (radius, color, opacity) => new THREE.Mesh(new THREE.TorusGeometry(radius, 0.025, 8, 160), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.add(torus(2.2, 0xa07cff, 0.9), torus(2.55, 0x2ee6f6, 0.45), torus(2.9, 0x7c4dff, 0.25));
  ring.position.set(0, 5.4, -9.5);
  scene.add(ring);

  // Session-start pulses.
  const pulses = Array.from({ length: 6 }, () => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 48), new THREE.MeshBasicMaterial({ color: 0xa07cff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.02;
    scene.add(m);
    return { m, t: 1 };
  });
  let nextPulse = 0;
  const pulseAt = (i, color) => {
    const p = pulses[nextPulse++ % pulses.length];
    p.m.position.set(pos[i].x, 0.02, pos[i].z + 0.2);
    p.m.material.color.copy(color);
    p.t = 0;
  };

  // ── lights ──────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x6b5bb5, 0.55));
  const key = new THREE.PointLight(0xa07cff, 70, 30, 1.6);
  key.position.set(-6, 7, 4);
  scene.add(key);
  const rim = new THREE.PointLight(0x2ee6f6, 55, 30, 1.6);
  rim.position.set(7, 5, -6);
  scene.add(rim);

  // ── interaction & loop ─────────────────────────────────────────────────
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener("pointermove", (e) => {
    pointer.tx = e.clientX / innerWidth - 0.5;
    pointer.ty = e.clientY / innerHeight - 0.5;
  }, { passive: true });

  const resize = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < 700 ? 58 : 42;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(host);
  resize();

  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0 }).observe(host);

  const clock = new THREE.Clock();
  let last = 0;
  let statusTimer = 0;
  const colorAttr = glowGeo.getAttribute("color");

  function frame() {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    const dt = Math.min(0.05, clock.getDelta());
    const t = (last += dt);

    // Live floor: every ~1.2 s a station changes, like real sessions.
    statusTimer += dt;
    if (statusTimer > 1.2 && !reduced) {
      statusTimer = 0;
      const i = Math.floor(Math.random() * n);
      const s = state[i];
      const next = s.kind === "free" ? "busy" : s.kind === "busy" ? (Math.random() < 0.5 ? "ending" : "busy") : s.kind === "ending" ? "free" : s.kind === "reserved" ? "busy" : s.kind;
      if (next !== s.kind) {
        if (next === "busy") pulseAt(i, STATUS.busy);
        s.kind = next;
        paint(i);
      }
    }
    for (let i = 0; i < n; i++) {
      const s = state[i];
      s.color.lerp(s.target, 0.08);
      const f = s.kind === "ending" ? 0.65 + 0.35 * Math.sin(t * 6 + s.flicker) : 0.9 + 0.1 * Math.sin(t * 1.3 + s.flicker);
      const c = s.color.clone().multiplyScalar(f);
      screens.setColorAt(i, c);
      strips.setColorAt(i, s.color);
      colorAttr.setXYZ(i, c.r, c.g, c.b);
    }
    screens.instanceColor.needsUpdate = true;
    strips.instanceColor.needsUpdate = true;
    colorAttr.needsUpdate = true;

    for (const p of pulses) {
      if (p.t >= 1) continue;
      p.t = Math.min(1, p.t + dt * 0.7);
      const k = 1 + p.t * 7;
      p.m.scale.set(k, k, k);
      p.m.material.opacity = (1 - p.t) * 0.9;
    }

    const arr = pgeo.getAttribute("position").array;
    for (let i = 0; i < pc; i++) {
      arr[i * 3 + 1] += dt * (0.15 + (i % 7) * 0.03);
      if (arr[i * 3 + 1] > 9) arr[i * 3 + 1] = 0;
    }
    pgeo.getAttribute("position").needsUpdate = true;

    ring.rotation.z = t * 0.25;
    ring.children[1].rotation.x = t * 0.4;
    ring.children[2].rotation.y = t * 0.3;

    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;
    const scroll = Math.min(1, scrollY / Math.max(1, host.clientHeight));
    const orbit = reduced ? 0 : Math.sin(t * 0.08) * 0.22;
    const radius = 15.5 - scroll * 3.5;
    camera.position.set(Math.sin(orbit + pointer.x * 0.5) * radius, 6.2 + pointer.y * -1.6 + scroll * 2.2, Math.cos(orbit + pointer.x * 0.5) * radius);
    camera.lookAt(0, 1.2 - scroll * 0.6, -2.5);

    renderer.render(scene, camera);
  }
  frame();
  host.classList.add("arena3d-ready");
  return { destroy: () => renderer.dispose() };
}
