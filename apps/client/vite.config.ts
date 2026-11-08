import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// host: true so a phone on the same Wi-Fi can open the dev build.
export default defineConfig({
  envDir: "../..",
  plugins: [tailwindcss()],
  server: { port: 1234, host: true },
  build: { target: "es2022" },
});
