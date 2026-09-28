import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^monaco-editor$/,
        replacement: fileURLToPath(new URL("./src/test/mocks/monaco-editor.ts", import.meta.url)),
      },
      {
        find: /^monaco-editor\/esm\/vs\/editor\/editor\.api$/,
        replacement: fileURLToPath(new URL("./src/test/mocks/monaco-editor.ts", import.meta.url)),
      },
      {
        find: /^monaco-editor\/esm\/vs\/editor\/editor\.worker\.js\?worker$/,
        replacement: fileURLToPath(new URL("./src/test/mocks/monaco-worker.ts", import.meta.url)),
      },
      {
        find: /^monaco-editor\/esm\/vs\/editor\/contrib\/(?:folding\/browser\/folding|find\/browser\/findController|suggest\/browser\/suggestController|snippet\/browser\/snippetController2|format\/browser\/formatActions|linesOperations\/browser\/linesOperations|bracketMatching\/browser\/bracketMatching|wordOperations\/browser\/wordOperations|multicursor\/browser\/multicursor|readOnlyMessage\/browser\/contribution|hover\/browser\/hoverContribution|gotoError\/browser\/gotoError)\.js$/,
        replacement: fileURLToPath(new URL("./src/test/mocks/monaco-contribution.ts", import.meta.url)),
      },
    ],
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
