import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// host: true so another laptop on the same Wi-Fi can open the dev build.
// No PWA: laptop only for now (docs/MOBILE.md); public/sw.js removes old installs.
export default defineConfig({
  envDir: "../..",
  plugins: [tailwindcss()],
  server: { port: 1234, host: true },
  build: { target: "es2022" },
});
