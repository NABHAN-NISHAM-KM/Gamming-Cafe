// Slim bar on top of every demo: what you're looking at, and a way to switch or leave.
(() => {
  const here = document.documentElement.dataset.demo;
  const demos = [
    ["superadmin", "Super Admin"],
    ["admin", "Venue admin"],
    ["shell", "Gaming Shell"],
    ["customer", "Customer app"],
  ];
  const css = `
  .demobar{position:fixed;top:0;left:0;right:0;height:40px;z-index:1000;display:flex;align-items:center;gap:14px;padding:0 14px;
    background:#05070c;border-bottom:1px solid #1d2433;font:500 13px/1 Inter,system-ui,sans-serif;color:#a9b3c8}
  .demobar a{color:#a9b3c8;text-decoration:none;padding:6px 10px;border-radius:7px;white-space:nowrap}
  .demobar a:hover{color:#fff;background:#121722}
  .demobar a.on{color:#22d3ee;background:#0e3440}
  .demobar .brand{display:flex;align-items:center;gap:8px;color:#e8edf7;font-weight:700;padding:0;margin-right:4px}
  .demobar .brand i{width:20px;height:20px;border-radius:6px;background:conic-gradient(from 210deg,#22d3ee,#a78bfa,#22d3ee);display:grid;place-items:center;color:#05070c;font-style:normal;font-size:11px;font-weight:800}
  .demobar .tag{padding:3px 8px;border-radius:999px;background:#2a2410;color:#facc15;border:1px solid #574a17;font-size:11px}
  .demobar .links{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none}
  .demobar .back{margin-left:auto}
  body{padding-top:40px}
  @media (max-width:760px){.demobar .tag,.demobar .back{display:none}}`;
  const s = document.createElement("style");
  s.textContent = css;
  document.head.appendChild(s);
  const bar = document.createElement("div");
  bar.className = "demobar";
  bar.innerHTML = `<a class="brand" href="../index.html"><i>A</i>ArenaOS</a><span class="tag">Demo · sample data</span>
    <div class="links">${demos.map(([k, l]) => `<a href="${k}.html" class="${k === here ? "on" : ""}">${l}</a>`).join("")}</div>
    <a class="back" href="../demos.html">← All demos</a>`;
  document.body.prepend(bar);
})();
