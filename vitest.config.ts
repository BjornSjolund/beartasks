import { defineConfig } from "vitest/config";

// Vitest runs from the project root (not the Vite `src` root) so the
// `tests/` suite is discovered; pure logic tests need no DOM.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
