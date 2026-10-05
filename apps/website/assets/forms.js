// The site's forms: walkthrough request, demo-call booking and the free trial.
// Posts JSON to /v1/public/* (serve.mjs forwards it to the platform service).
(() => {
  const ar = document.documentElement.lang === "ar";
  const msg = {
    slot_taken: ar ? "هذا الموعد حُجز للتو — اختر وقتاً آخر." : "That time was just taken — please pick another.",
    email_taken: ar ? "لديك حساب ArenaOS بهذا البريد بالفعل. سجّل الدخول أو تواصل معنا." : "You already have an ArenaOS account with this email — sign in, or contact us to add a venue.",
    slug_taken: ar ? "هذا العنوان مستخدم — جرّب اسماً آخر." : "That web address is taken — try another.",
    too_many_attempts: ar ? "محاولات كثيرة. حاول لاحقاً." : "Too many attempts from here — please try again later.",
    trials_closed: ar ? "التجارب المجانية متوقفة مؤقتاً — راسلنا وسنجهّز لك حساباً." : "Free trials are paused right now — send us a message and we'll set you up.",
    validation_failed: ar ? "تحقّق من الحقول المظللة." : "Please check the highlighted fields.",
    failed: ar ? "تعذّر الإرسال. تحقّق من اتصالك وحاول مجدداً." : "Couldn't send. Check your connection and try again.",
  };

  window.arenaPost = async (url, body) => {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json().catch(() => ({}));
      return r.ok ? { ok: true, data } : { ok: false, error: data.error ?? "failed", issues: data.issues };
    } catch { return { ok: false, error: "failed" }; }
  };

  /** Wires a form: collects fields, posts, shows the error or calls done(). */
  window.arenaForm = (form, url, done, shape = (v) => v) => {
    const err = document.createElement("div");
    err.className = "err-msg";
    err.setAttribute("role", "alert");
    form.querySelector("button[type=submit]").before(err);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      const values = Object.fromEntries([...new FormData(form)].filter(([, v]) => v !== ""));
      const target = typeof url === "function" ? url(values) : url;
      btn.disabled = true;
      err.textContent = "";
      let ref = null;
      try { ref = sessionStorage.getItem("arena.ref"); } catch { /* storage off */ }
      const payload = shape(values);
      if (ref && target.startsWith("/v1/public/")) payload.ref = ref;
      const r = await window.arenaPost(target, payload);
      btn.disabled = false;
      if (r.ok) {
        // A finished step in the sign-up funnel (counted, nothing about the person).
        const step = target.endsWith("/trial") ? "trial_done" : target.endsWith("/demo") ? "demo_booked" : payload.kind === "PARTNER" ? "partner_sent" : target.endsWith("/leads") ? "contact_sent" : null;
        if (step) window.arenaTrack?.(step);
        return done(r.data, values);
      }
      err.textContent = msg[r.error] ?? msg.failed;
      for (const i of r.issues ?? []) form.querySelector(`[name="${i.path}"]`)?.setAttribute("aria-invalid", "true");
    });
    form.addEventListener("input", (e) => e.target.removeAttribute?.("aria-invalid"));
  };

  /** Fills a <select> with free call times, grouped by day, in the visitor's own time zone. */
  window.arenaSlots = async (select) => {
    const r = await fetch("/v1/public/demo-slots").then((x) => x.json()).catch(() => null);
    if (!r?.slots?.length) return select.closest("label")?.remove();
    const day = new Intl.DateTimeFormat(ar ? "ar" : undefined, { weekday: "long", day: "numeric", month: "long" });
    const time = new Intl.DateTimeFormat(ar ? "ar" : undefined, { hour: "numeric", minute: "2-digit" });
    const groups = new Map();
    for (const s of r.slots) {
      const d = day.format(new Date(s));
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(s);
    }
    for (const [d, list] of groups) {
      const g = document.createElement("optgroup");
      g.label = d;
      for (const s of list) g.append(new Option(time.format(new Date(s)), s));
      select.append(g);
    }
  };
})();
