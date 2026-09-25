import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Kiosk hygiene: no context menu, no drag-out, no browser shortcuts from inside the page.
addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("dragstart", (e) => e.preventDefault());
addEventListener("keydown", (e) => {
  if ((e.ctrlKey && ["p", "s", "o", "u", "f", "r", "+", "-", "=", "0"].includes(e.key.toLowerCase())) || e.key === "F5" || e.key === "F12") e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
