import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@arena/theme/fonts";
import "./styles.css";

const DEMO = import.meta.env.VITE_ARENA_DEMO === "1";

if ("serviceWorker" in navigator && import.meta.env.PROD && !DEMO) {
  addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}

// Demo build (VITE_ARENA_DEMO=1): the whole venue runs in the browser (@arena/demo).
async function boot() {
  if (DEMO) await import("@arena/demo").then((m) => m.installDemo("customer"));
  const { App } = await import("./App");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void boot();
