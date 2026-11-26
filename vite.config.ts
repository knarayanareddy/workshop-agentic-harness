import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Bind all interfaces so a container/proxy can reach the dev server, and allow the
// proxy's Host header — Vite's DNS-rebinding protection otherwise answers 403
// "Blocked request. This host is not allowed." for <port>-<id>.e2b.app.
// Extra hosts (e.g. a facilitator's own tunnel) can be added comma-separated in
// VITE_ALLOWED_HOSTS without editing this file.
const extraHosts = (process.env.VITE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);
const allowedHosts = [".e2b.app", ...extraHosts];
const server = { host: "0.0.0.0", allowedHosts };

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  server,
  preview: server,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
