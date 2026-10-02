// Guided tour over the live demos: a few steps that point at the real controls
// (found by their visible label, so it survives restyling). Shown once per app
// per device, after sign-in; "Tour" in the corner restarts it.

type Step = { target?: string; title: string; text: string };

const TOURS: Record<"admin" | "customer" | "shell", { ready: string; steps: Step[] }> = {
  admin: {
    ready: "Live Floor",
    steps: [
      { title: "Welcome to Pixel Arena", text: "You're the owner of a demo venue that keeps living: players arrive, sessions run out, orders come in. Everything you change is saved on this device." },
      { target: "Live Floor", title: "Live Floor", text: "Every station in the venue in real time. Click a PC to start a session, add time, lock it or send a message." },
      { target: "Counter", title: "Counter", text: "The front desk on one screen: walk-ins, top-ups, food and the shift's cash." },
      { target: "Kitchen", title: "Kitchen", text: "Orders from the POS, the player's PC and the customer app land here as tickets. Bump them when they're ready." },
      { target: "Customers", title: "Customers", text: "Each regular's file: wallet, visits, notes, restrictions and what they like to play." },
      { target: "Reports", title: "Reports", text: "Occupancy by hour, revenue by stream and branch comparisons — from the same ledger the floor writes to." },
      { title: "Explore freely", text: "Nothing here can break. Use Reset in the Live demo bar to start the venue fresh." },
    ],
  },
  customer: {
    ready: "Home",
    steps: [
      { title: "The player's app", text: "This is what your customers install: their wallet, bookings and rewards at your venue." },
      { target: "Book", title: "Book a PC", text: "Pick a zone and a time; double bookings are impossible." },
      { target: "Shop", title: "Top up and order food", text: "Buy time packages and wallet credit, or order food straight to the PC you're sitting at." },
      { target: "Rewards", title: "Rewards", text: "Points from every visit, challenges and tournaments to join." },
      { target: "Me", title: "Your account", text: "Friends, stats, screenshots from the PC, and Arabic or English." },
    ],
  },
  shell: {
    ready: "Games",
    steps: [
      { title: "The screen at every PC", text: "Players see this when they sit down. It's a small desktop: games, apps and your venue's look." },
      { target: "Games", title: "Games", text: "The venue's library, with covers. A game opens in front, and closes when the session ends." },
      { target: "Food", title: "Food to the seat", text: "Order without leaving the game; the kitchen sees which PC it's for." },
      { target: "My account", title: "My account", text: "Wallet, points, time left and settings that follow the player to any PC." },
      { target: "Lock while I'm away", title: "Away lock", text: "A quick break without ending the session." },
    ],
  },
};

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
};

function find(label: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>("a, button, [role=button], [aria-label]");
  for (const el of all) {
    const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
    if (name === label && visible(el)) return el;
  }
  return null;
}

export function installTour(app: keyof typeof TOURS) {
  const tour = TOURS[app];
  const KEY = `arena.demo.tour.${app}`;
  const seen = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
  const markSeen = () => { try { localStorage.setItem(KEY, "1"); } catch { /* private mode */ } };

  const layer = document.createElement("div");
  layer.setAttribute("data-demo-tour", "");
  layer.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;font:14px/1.5 system-ui,sans-serif";
  const ring = document.createElement("div");
  ring.style.cssText = "position:fixed;border:2px solid #8b5cf6;border-radius:12px;box-shadow:0 0 0 9999px rgba(5,5,15,.55),0 0 24px #8b5cf6;transition:all .25s ease;pointer-events:none";
  const card = document.createElement("div");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-live", "polite");
  card.style.cssText = "position:fixed;right:16px;bottom:72px;max-width:340px;background:#12121c;color:#e8e8f0;border:1px solid #8b5cf6;border-radius:14px;padding:16px 18px;box-shadow:0 12px 40px rgba(0,0,0,.5);pointer-events:auto";
  layer.append(ring, card);

  const again = document.createElement("button");
  again.textContent = "Tour";
  again.title = "Show the guided tour";
  again.style.cssText = "position:fixed;right:0;top:45%;z-index:2147483645;background:#12121c;color:#a78bfa;border:1px solid #8b5cf6;border-right:0;border-radius:999px 0 0 999px;padding:6px 10px 6px 12px;font:600 12px system-ui,sans-serif;cursor:pointer";
  again.onclick = () => start();

  let i = 0;
  const close = () => { layer.remove(); markSeen(); removeEventListener("resize", place); };
  const btn = (label: string, primary: boolean, fn: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = `border:0;border-radius:8px;padding:6px 12px;font:600 13px system-ui,sans-serif;cursor:pointer;${primary ? "background:#8b5cf6;color:#fff" : "background:transparent;color:#a0a0b8"}`;
    b.onclick = fn;
    return b;
  };
  function place() {
    const step = tour.steps[i]!;
    const el = step.target ? find(step.target) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      Object.assign(ring.style, { display: "block", left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    } else ring.style.display = "none";
  }
  function render() {
    const step = tour.steps[i]!;
    card.replaceChildren();
    const h = document.createElement("div");
    h.style.cssText = "font-weight:700;font-size:16px;margin-bottom:4px";
    h.textContent = step.title;
    const p = document.createElement("div");
    p.style.cssText = "color:#c0c0d0";
    p.textContent = step.text;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:6px;margin-top:14px";
    const count = document.createElement("span");
    count.style.cssText = "color:#6b6b80;font-size:12px;margin-right:auto";
    count.textContent = `${i + 1} / ${tour.steps.length}`;
    row.append(count, btn("Skip", false, close));
    if (i > 0) row.append(btn("Back", false, () => { i--; render(); }));
    row.append(btn(i === tour.steps.length - 1 ? "Done" : "Next", true, () => (i === tour.steps.length - 1 ? close() : (i++, render()))));
    card.append(h, p, row);
    place();
    (row.lastElementChild as HTMLElement).focus();
  }
  function start() {
    i = 0;
    document.body.append(layer);
    addEventListener("resize", place);
    render();
  }

  const forced = new URLSearchParams(location.search).has("tour");
  const wait = setInterval(() => {
    if (!document.body || !find(tour.ready)) return;
    clearInterval(wait);
    document.body.append(again);
    if (forced || !seen()) start();
  }, 800);
  addEventListener("keydown", (e) => e.key === "Escape" && layer.isConnected && close());
}
