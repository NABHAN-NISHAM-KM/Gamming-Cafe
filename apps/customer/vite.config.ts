import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

// The customer app (PWA). In development the API is proxied, so the app and
// the API share an origin — no CORS, and the token never goes cross-site.
// In production it is served from the same host as the API (/v1).
export default defineConfig({
  plugins: [
    react(),
    tailwind(),
    // The APK calls a hosted API on another origin (VITE_ARENA_API): let the CSP allow it.
    { name: "csp-api", transformIndexHtml: (html) => html.replace("connect-src 'self'", `connect-src 'self' ${process.env["VITE_ARENA_API"] ?? ""}`.trimEnd()) },
  ],
  server: {
    proxy: { "/v1": { target: process.env["ARENA_API"] ?? "http://localhost:4000", changeOrigin: false } },
  },
  // Two pages: the customer app, and the TV station display (/display.html).
  build: { outDir: "dist", emptyOutDir: true, rollupOptions: { input: { main: "index.html", display: "display.html" } } },
});
