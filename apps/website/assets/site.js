// Shared chrome for the marketing pages: nav, footer, icons, scroll reveal.
(() => {
  const base = document.documentElement.dataset.base ?? "";
  const page = document.documentElement.dataset.page ?? "";

  // Lucide-style 24px stroke icons (hand-picked subset).
  const P = {
    floor: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L22 7H6"/>',
    chef: '<path d="M6 13.9A4 4 0 0 1 7 6a5 5 0 0 1 10 0 4 4 0 0 1 1 7.9V21H6z"/><path d="M6 17h12"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    game: '<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><rect x="2" y="6" width="20" height="12" rx="6"/>',
    vr: '<path d="M3 8h18v8h-5l-2-3h-4l-2 3H3z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="16.5" cy="11.5" r="1"/>',
    print: '<path d="M6 9V2h12v7"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v8H6z"/>',
    wallet: '<path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15v14H5a2 2 0 0 1-2-2V5"/><circle cx="16" cy="14" r="1.2"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    megaphone: '<path d="m3 11 15-6v14L3 13z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z"/>',
    wifi: '<path d="M5 12.6a10 10 0 0 1 14 0M8.5 16.1a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 20 0M12 20h.01"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
    chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
    crown: '<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7z"/><path d="M5 20h14"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',
    coffee: '<path d="M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M6 2v2M10 2v2M14 2v2"/>',
    tv: '<rect x="2" y="7" width="20" height="15" rx="2"/><path d="m17 2-5 5-5-5"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    play: '<path d="m6 3 14 9-14 9z"/>',
  };
  window.arenaIcon = (name, size = 22) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ""}</svg>`;
  document.querySelectorAll("[data-icon]").forEach((el) => (el.innerHTML = window.arenaIcon(el.dataset.icon, Number(el.dataset.size) || 22)));

  const links = [
    ["index.html", "Product", "home"],
    ["features.html", "Features", "features"],
    ["pricing.html", "Pricing", "pricing"],
    ["demos.html", "Live demos", "demos"],
    ["index.html#downloads", "Download", "downloads"],
    ["guide.html", "Guide", "guide"],
    ["install.html", "Install", "install"],
    ["contact.html", "Contact", "contact"],
  ];
  const nav = document.getElementById("nav");
  if (nav) {
    nav.className = "nav";
    nav.innerHTML = `<div class="wrap">
      <a class="brand" href="${base}index.html"><span class="brand-mark">A</span><span>Arena<b>OS</b></span></a>
      <nav class="nav-links">${links.map(([h, l, k]) => `<a href="${base}${h}" class="${k === page ? "on" : ""}">${l}</a>`).join("")}</nav>
      <div class="nav-cta"><a class="btn btn-ghost btn-sm" href="${base}contact.html">Book a call</a><a class="btn btn-primary btn-sm" href="${base}live/admin/login/">Try it live</a></div>
      <button class="menu-btn" aria-label="Menu">☰</button>
    </div>`;
    nav.querySelector(".menu-btn").addEventListener("click", () => nav.classList.toggle("open"));
  }

  const foot = document.getElementById("footer");
  if (foot) {
    foot.innerHTML = `<div class="wrap">
      <div class="foot">
        <div><a class="brand" href="${base}index.html"><span class="brand-mark">A</span><span>Arena<b>OS</b></span></a>
          <p>The operating system for gaming cafés, esports arenas, internet cafés, console &amp; VR centres and gaming restaurants.</p></div>
        <div><h4>Product</h4><a href="${base}features.html#stations">Stations &amp; Live Floor</a><a href="${base}features.html#sessions">Sessions &amp; Shell</a><a href="${base}features.html#pos">POS &amp; restaurant</a><a href="${base}features.html#engage">Loyalty &amp; tournaments</a></div>
        <div><h4>Live demos</h4><a href="${base}live/admin/login/">Venue admin</a><a href="${base}live/admin/login/?next=%2Fplatform">Super Admin</a><a href="${base}live/shell/">Gaming Shell</a><a href="${base}live/app/">Customer app</a><a href="${base}index.html#downloads">Downloads</a></div>
        <div><h4>Company</h4><a href="${base}pricing.html">Pricing</a><a href="${base}contact.html">Contact sales</a><a href="${base}guide.html">How it works</a><a href="${base}install.html">Install guide</a><a href="${base}pricing.html#faq">FAQ</a></div>
      </div>
      <div class="copy"><span>© ${new Date().getFullYear()} ArenaOS. All rights reserved.</span><span>Built for venues that never close.</span></div>
    </div>`;
  }

  // Copy buttons on documentation code blocks (trailing "# comments" are dropped).
  document.querySelectorAll(".doc pre").forEach((pre) => {
    const b = document.createElement("button");
    b.className = "copy-btn";
    b.textContent = "Copy";
    b.onclick = async () => {
      const text = pre.querySelector("code").innerText.split("\n").map((l) => l.replace(/\s+#.*$/, "")).join("\n").trim();
      try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; } catch { b.textContent = "Select & copy"; }
      setTimeout(() => (b.textContent = "Copy"), 1500);
    };
    pre.appendChild(b);
  });

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(pointer: fine)").matches;

  // 3D tilt that follows the pointer (cards marked .tilt).
  if (finePointer && !reduced)
    document.querySelectorAll(".tilt").forEach((el) => {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        el.style.setProperty("--ry", `${(x - 0.5) * 10}deg`);
        el.style.setProperty("--rx", `${(0.5 - y) * 8}deg`);
        el.style.setProperty("--mx", `${x * 100}%`);
        el.style.setProperty("--my", `${y * 100}%`);
      });
      el.addEventListener("pointerleave", () => {
        el.style.setProperty("--rx", "0deg");
        el.style.setProperty("--ry", "0deg");
      });
    });

  // Numbers that count up when they scroll into view: <b class="count" data-to="111" data-suffix="+">.
  const counters = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    counters.unobserve(e.target);
    const el = e.target;
    const to = Number(el.dataset.to);
    const pre = el.dataset.prefix ?? "";
    const suf = el.dataset.suffix ?? "";
    if (reduced || !Number.isFinite(to)) return;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 1400);
      const v = to * (1 - Math.pow(1 - k, 3));
      el.textContent = pre + (to % 1 ? v.toFixed(1) : Math.round(v).toLocaleString()) + suf;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }), { threshold: 0.6 }) : null;
  document.querySelectorAll(".count[data-to]").forEach((el) => counters?.observe(el));

  // The 3D arena in the hero: loaded only when there's room for it.
  const stage = document.querySelector("[data-arena3d]");
  if (stage) {
    const lowEnd = (navigator.hardwareConcurrency ?? 8) < 4 || navigator.connection?.saveData;
    if (!lowEnd) {
      const go = () => import(new URL(`${base}assets/arena3d.js`, location.href).href).then((m) => m.mountArena(stage)).catch((e) => console.warn("3D hero unavailable:", e));
      "requestIdleCallback" in window ? requestIdleCallback(go, { timeout: 1200 }) : setTimeout(go, 300);
    }
  }

  // Live demos inside device frames: rendered at their natural size and scaled
  // to fit, loaded only when the visitor clicks (keeps the page fast).
  document.querySelectorAll("[data-live]").forEach((screen) => {
    const [w, h] = (screen.dataset.vp ?? "1440x900").split("x").map(Number);
    const vp = document.createElement("div");
    vp.className = "vp";
    vp.style.width = `${w}px`;
    vp.style.height = `${h}px`;
    screen.prepend(vp);
    const fit = () => (vp.style.transform = `scale(${screen.clientWidth / w})`);
    new ResizeObserver(fit).observe(screen);
    fit();
    const start = () => {
      if (screen.classList.contains("loaded")) return;
      const f = document.createElement("iframe");
      f.src = base + screen.dataset.live;
      f.title = screen.dataset.title ?? "ArenaOS live demo";
      f.loading = "eager";
      f.allow = "clipboard-write";
      vp.appendChild(f);
      screen.classList.add("loaded");
    };
    screen.querySelector(".cover")?.addEventListener("click", start);
  });
  document.querySelectorAll("[data-launch-all]").forEach((b) => b.addEventListener("click", () => document.querySelectorAll("[data-live] .cover").forEach((c) => c.click())));

  const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { threshold: 0.12 }) : null;
  document.querySelectorAll(".reveal").forEach((el) => (io ? io.observe(el) : el.classList.add("in")));
})();
