import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "monaco-editor": fileURLToPath(new URL("./src/test/mocks/monaco-editor.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.{test,spec}.mjs"],
    environmentMatchGlobs: [
      ["src/components/**", "jsdom"],
    ],
    setupFiles: ["src/test/setup.ts"],
    globals: false,
    css: false,
  },
});
