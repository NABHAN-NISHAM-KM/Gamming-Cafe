import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@arena/theme/fonts";
import "./styles.css";

// Kiosk hygiene: no context menu, no drag-out, no browser shortcuts from inside the page.
addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("dragstart", (e) => e.preventDefault());
addEventListener("keydown", (e) => {
  if ((e.ctrlKey && ["p", "s", "o", "u", "f", "r", "+", "-", "=", "0"].includes(e.key.toLowerCase())) || e.key === "F5" || e.key === "F12") e.preventDefault();
});

// Demo build (VITE_ARENA_DEMO=1): install the in-browser demo venue first, so
// the Shell runs as a station on the shared demo floor instead of a real PC.
async function boot() {
  if (import.meta.env.VITE_ARENA_DEMO === "1") await import("@arena/demo").then((m) => m.installDemo("shell"));
  const { App } = await import("./App");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void boot();
