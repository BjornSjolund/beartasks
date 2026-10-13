import { defineConfig } from "vite";

// Tauri expects a fixed dev server port. `src/` is the Vite root so that
// index.html can live next to the application sources.
export default defineConfig({
  root: "src",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Don't watch the Rust project.
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2021",
    sourcemap: false,
  },
});
