import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { startupBundlePlugin } from "./scripts/lib/startup-bundle.mjs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react(), startupBundlePlugin()],
  build: { manifest: true },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
