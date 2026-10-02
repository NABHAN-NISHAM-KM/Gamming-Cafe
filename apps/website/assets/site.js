// Shared chrome and motion for the marketing pages: nav, footer, icons,
// reveals, and the scroll engine that drives every 3D/scroll effect by
// writing CSS variables (--p, --land, --draw…) — no animation library.
(() => {
  const base = document.documentElement.dataset.base ?? "";
  const page = document.documentElement.dataset.page ?? "";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(pointer: fine)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

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

  // Arabic pages live under /ar/ (lang="ar", dir="rtl", data-base="../") and get Arabic chrome.
  const ar = document.documentElement.lang === "ar";
  const T = (en, arText) => (ar ? arText : en);
  const AR_PAGES = ["index.html", "contact.html", "signup.html"];
  const file = location.pathname.split("/").pop() || "index.html";
  const other = ar ? `${base}${file}` : `${base}ar/${AR_PAGES.includes(file) ? file : "index.html"}`;
  const links = ar
    ? [["ar/index.html", "المنتج", "home"], ["features.html", "الميزات", "features"], ["pricing.html", "الأسعار", "pricing"], ["demos.html", "عروض حية", "demos"], ["downloads.html", "التنزيلات", "downloads"], ["help.html", "المساعدة", "help"], ["ar/contact.html", "تواصل معنا", "contact"]]
    : [
        ["index.html", "Product", "home"],
        ["features.html", "Features", "features"],
        ["pricing.html", "Pricing", "pricing"],
        ["demos.html", "Live demos", "demos"],
        ["downloads.html", "Download", "downloads"],
        ["help.html", "Help", "help"],
        ["install.html", "Install", "install"],
        ["contact.html", "Contact", "contact"],
      ];
  const nav = document.getElementById("nav");
  if (nav) {
    nav.className = "nav";
    nav.innerHTML = `<div class="wrap">
      <a class="brand" href="${base}index.html" aria-label="ArenaOS home"><span class="brand-mark" aria-hidden="true">A</span><span>Arena<b>OS</b></span></a>
      <nav class="nav-links" id="navLinks">${links.map(([h, l, k]) => `<a href="${base}${h}" class="${k === page ? "on" : ""}"${k === page ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
      <div class="nav-cta"><a class="btn btn-ghost btn-sm" href="${other}" hreflang="${ar ? "en" : "ar"}" lang="${ar ? "en" : "ar"}">${ar ? "English" : "العربية"}</a><a class="btn btn-ghost btn-sm" href="${base}${ar ? "ar/" : ""}contact.html?call">${T("Book a call", "احجز مكالمة")}</a><a class="btn btn-primary btn-sm" href="${base}${ar ? "ar/" : ""}signup.html">${T("Start free trial", "ابدأ مجاناً")}</a></div>
      <button class="menu-btn" aria-label="Menu" aria-expanded="false" aria-controls="navLinks"><i></i></button>
    </div><span class="bar" aria-hidden="true"></span>`;
    const btn = nav.querySelector(".menu-btn");
    btn.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      btn.setAttribute("aria-expanded", String(open));
      document.body.style.overflow = open ? "hidden" : "";
    });
    nav.querySelectorAll(".nav-links a").forEach((a) => a.addEventListener("click", () => {
      nav.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
    }));
  }

  const foot = document.getElementById("footer");
  if (foot) {
    foot.innerHTML = `<div class="wrap">
      <div class="foot">
        <div><a class="brand" href="${base}index.html"><span class="brand-mark" aria-hidden="true">A</span><span>Arena<b>OS</b></span></a>
          <p>${T("The operating system for gaming cafés, esports arenas, internet cafés, console &amp; VR centres and gaming restaurants.", "نظام تشغيل مقاهي الألعاب وساحات الرياضات الإلكترونية ومقاهي الإنترنت ومراكز الكونسول والواقع الافتراضي ومطاعم الألعاب.")}</p></div>
        <div><h4>${T("Built for", "مصمّم لـ")}</h4><a href="${base}for-gaming-cafes.html">${T("Gaming cafés", "مقاهي الألعاب")}</a><a href="${base}for-esports-arenas.html">${T("Esports arenas", "ساحات الرياضات الإلكترونية")}</a><a href="${base}for-internet-cafes.html">${T("Internet cafés", "مقاهي الإنترنت")}</a><a href="${base}for-console-vr-centres.html">${T("Console &amp; VR centres", "مراكز الكونسول والواقع الافتراضي")}</a><a href="${base}for-gaming-restaurants.html">${T("Gaming restaurants", "مطاعم الألعاب")}</a></div>
        <div><h4>${T("Product", "المنتج")}</h4><a href="${base}features.html">${T("Features", "الميزات")}</a><a href="${base}changelog.html">${T("What's new", "الجديد")}</a><a href="${base}compare.html">${T("Why switch", "لماذا تنتقل")}</a><a href="${base}demos.html">${T("Live demos", "عروض حية")}</a><a href="${base}downloads.html">${T("Downloads", "التنزيلات")}</a></div>
        <div><h4>${T("Company", "الشركة")}</h4><a href="${base}pricing.html">${T("Pricing", "الأسعار")}</a><a href="${base}${ar ? "ar/" : ""}signup.html">${T("Free trial", "تجربة مجانية")}</a><a href="${base}${ar ? "ar/" : ""}contact.html">${T("Contact sales", "تواصل مع المبيعات")}</a><a href="${base}help.html">${T("Help centre", "مركز المساعدة")}</a><a href="${base}install.html">${T("Install guide", "دليل التثبيت")}</a></div>
      </div>
      <div class="wordmark" data-scroll aria-hidden="true">Arena<b>OS</b></div>
      <div class="copy"><span>© ${new Date().getFullYear()} ArenaOS. ${T("All rights reserved.", "جميع الحقوق محفوظة.")}</span><span>${T("Built for venues that never close.", "صُمّم لأماكن لا تُغلق أبوابها.")}</span></div>
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

  // Headlines that rise word by word: <h1 data-split>. Keeps child elements (spans) intact.
  document.querySelectorAll("[data-split]").forEach((el) => {
    let i = 0;
    const wrap = (node) => {
      [...node.childNodes].forEach((c) => {
        if (c.nodeType === 3) {
          const frag = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) return frag.append(part);
            const w = document.createElement("span");
            w.className = "w";
            w.innerHTML = `<span style="--i:${i++}"></span>`;
            w.firstChild.textContent = part;
            frag.append(w);
          });
          c.replaceWith(frag);
        } else if (c.nodeType === 1 && c.tagName !== "BR") wrap(c);
      });
    };
    wrap(el);
    el.classList.add("split-words");
  });

  // Pointer-following tilt (cards marked .tilt).
  if (finePointer && !reduced)
    document.querySelectorAll(".tilt").forEach((el) => {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        el.style.setProperty("--ry", `${(x - 0.5) * 8}deg`);
        el.style.setProperty("--rx", `${(0.5 - y) * 6}deg`);
        el.style.setProperty("--mx", `${x * 100}%`);
        el.style.setProperty("--my", `${y * 100}%`);
      });
      el.addEventListener("pointerleave", () => {
        el.style.setProperty("--rx", "0deg");
        el.style.setProperty("--ry", "0deg");
      });
    });

  // Numbers that count up when they scroll into view: <b class="count" data-to="111">.
  const counters = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    counters.unobserve(e.target);
    const el = e.target;
    const to = Number(el.dataset.to);
    if (reduced || !Number.isFinite(to)) return;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 1600);
      el.textContent = Math.round(to * (1 - Math.pow(1 - k, 4))).toLocaleString();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }), { threshold: 0.6 }) : null;
  document.querySelectorAll(".count[data-to]").forEach((el) => counters?.observe(el));

  // ── scroll engine ───────────────────────────────────────────────────────
  // [data-scroll]: --p goes 0→1 while the element crosses the viewport.
  // [data-pin]:    --p goes 0→1 while its sticky child is pinned.
  const tasks = [];
  const view = (el) => {
    const r = el.getBoundingClientRect();
    return clamp((innerHeight - r.top) / (innerHeight + r.height));
  };
  const pinned = (el) => {
    const r = el.getBoundingClientRect();
    return clamp(-r.top / Math.max(1, r.height - innerHeight));
  };
  document.querySelectorAll("[data-scroll]").forEach((el) => tasks.push(() => el.style.setProperty("--p", view(el).toFixed(4))));
  document.querySelectorAll("[data-pin]").forEach((el) => tasks.push(() => el.style.setProperty("--p", pinned(el).toFixed(4))));
  if (nav) tasks.push(() => {
    nav.classList.toggle("solid", scrollY > 24);
    nav.style.setProperty("--read", (scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)).toFixed(4));
  });

  // Live demo devices tilt up and land as they arrive.
  document.querySelectorAll(".devices").forEach((el) => tasks.push(() => el.style.setProperty("--land", reduced ? 1 : smooth(clamp(view(el) * 2.2)).toFixed(4))));

  // Session flow: a line draws across, lighting each step as it passes.
  document.querySelectorAll(".flow").forEach((el) => {
    const steps = [...el.children];
    tasks.push(() => {
      const d = reduced ? 1 : clamp((view(el) - 0.25) * 2.4);
      el.style.setProperty("--draw", d.toFixed(4));
      steps.forEach((s, i) => s.classList.toggle("lit", d >= (i + 0.2) / steps.length));
    });
  });

  // Modules: vertical scroll drives a horizontal track; panels swing in 3D.
  document.querySelectorAll(".hscroll").forEach((sec) => {
    const track = sec.querySelector(".track");
    const panels = [...track.children];
    const count = sec.querySelector(".count b");
    const measure = () => track.style.setProperty("--shift", `${Math.max(0, track.scrollWidth - innerWidth + 40)}px`);
    addEventListener("resize", measure);
    measure();
    tasks.push(() => {
      const p = pinned(sec);
      sec.style.setProperty("--p", p.toFixed(4));
      const mid = innerWidth / 2;
      let on = 0;
      panels.forEach((pa, i) => {
        const r = pa.getBoundingClientRect();
        const k = clamp((r.left + r.width / 2 - mid) / innerWidth, -1, 1);
        pa.style.setProperty("--k", k.toFixed(3));
        pa.style.setProperty("--ka", Math.abs(k).toFixed(3));
        if (r.left < mid) on = i;
      });
      if (count) count.textContent = String(Math.min(on + 1, panels.length - 1)).padStart(2, "0");
    });
  });

  // Hero flythrough: chapters fade by position on the path; 3D reads the same progress.
  const fly = document.querySelector(".fly");
  let flyP = 0;
  if (fly) {
    const chapters = [...fly.querySelectorAll(".chapter")];
    const rail = [...fly.querySelectorAll(".rail a")];
    const hud = fly.querySelector(".hud");
    const N = chapters.length - 1;
    tasks.push(() => {
      flyP = pinned(fly);
      fly.style.setProperty("--p", flyP.toFixed(4));
      const t = flyP * N;
      chapters.forEach((c, i) => {
        const o = reduced ? (Math.abs(t - i) < 0.5 ? 1 : 0) : i === 0 && t < 0 ? 1 : clamp((0.48 - Math.abs(t - i)) * 4.5);
        c.style.setProperty("--o", o.toFixed(3));
        c.style.setProperty("--dir", t < i ? 1 : -1);
        c.classList.toggle("vis", o > 0.01);
        c.inert = o < 0.5;
      });
      rail.forEach((a, i) => a.classList.toggle("on", Math.round(t) === i));
      hud?.style.setProperty("--hud", clamp((0.5 - Math.abs(t - 1)) * 4).toFixed(3));
    });
    rail.forEach((a, i) => a.addEventListener("click", (e) => {
      e.preventDefault();
      const top = fly.getBoundingClientRect().top + scrollY;
      scrollTo({ top: top + (i / N) * (fly.offsetHeight - innerHeight), behavior: reduced ? "auto" : "smooth" });
    }));
  }

  let queued = false;
  const run = () => { queued = false; tasks.forEach((f) => f()); };
  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  run();
  function smooth(x) { return x * x * (3 - 2 * x); }

  // Hero film, scrubbed by scroll: each chapter maps to a moment in the video
  // (data-times). Loaded as a blob so seeking is instant in both directions.
  // If the film can't load, the real-time 3D arena takes its place.
  const stage = document.querySelector("[data-arena3d]");
  if (stage) {
    const lowEnd = (navigator.hardwareConcurrency ?? 8) < 4 || navigator.connection?.saveData;
    const hud = document.querySelector(".hud");
    const onStats = hud && ((c) => {
      for (const k in c) { const el = hud.querySelector(`[data-k="${k}"]`); if (el) el.textContent = c[k]; }
    });
    const mount3d = () => {
      if (lowEnd) return;
      document.querySelector(".fly")?.classList.add("is-3d");
      import(new URL(`${base}assets/arena3d.js`, location.href).href).then((m) => m.mountArena(stage, { progress: () => flyP, onStats })).catch((e) => console.warn("3D hero unavailable:", e));
    };
    const video = stage.querySelector("video[data-scrub]");
    if (!video) mount3d();
    else
      fetch(new URL(base + video.dataset.scrub, location.href))
        .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
        .then((blob) => new Promise((ok, fail) => {
          video.onloadeddata = ok;
          video.onerror = fail;
          video.src = URL.createObjectURL(blob);
        }))
        .then(() => {
          const marks = video.dataset.times.split(" ").map(Number);
          const at = (p) => { // chapter progress → video time, piecewise between marks
            const x = clamp(p) * (marks.length - 1);
            const i = Math.min(marks.length - 2, Math.floor(reduced ? Math.round(x) : x));
            const f = reduced ? Math.round(x) - i : x - i;
            return marks[i] + (marks[i + 1] - marks[i]) * clamp(f);
          };
          let shown = at(flyP);
          video.currentTime = shown;
          stage.classList.add("video-ready");
          const tick = () => {
            requestAnimationFrame(tick);
            const target = at(flyP);
            shown += (target - shown) * (reduced ? 1 : 0.14); // a little inertia, like a camera
            if (!video.seeking && Math.abs(video.currentTime - shown) > 1 / 60) video.currentTime = shown;
          };
          tick();
        })
        .catch((e) => { console.warn("Hero film unavailable, using 3D:", e); video.remove(); mount3d(); });
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
    const cover = screen.querySelector(".cover");
    cover?.addEventListener("click", start);
    cover?.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), start()));
  });
  document.querySelectorAll("[data-launch-all]").forEach((b) => b.addEventListener("click", () => document.querySelectorAll("[data-live] .cover").forEach((c) => c.click())));

  const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { threshold: 0.15 }) : null;
  document.querySelectorAll(".reveal, .split-words").forEach((el) => (io ? io.observe(el) : el.classList.add("in")));
})();
