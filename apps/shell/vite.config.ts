import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

// Built into clients/windows/src/Arena.Shell/wwwroot and served by WebView2
// from a virtual host (https://shell.arena/). Relative base: no server needed.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwind()],
  build: {
    outDir: "../../clients/windows/src/Arena.Shell/wwwroot",
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
