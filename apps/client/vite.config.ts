import { defineConfig } from "vite";

// host: true so a phone on the same Wi-Fi can open the dev build.
export default defineConfig({
  envDir: "../..",
  server: { port: 1234, host: true },
  build: { target: "es2022" },
});
