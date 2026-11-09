import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// host: true so a phone on the same Wi-Fi can open the dev build.
// The PWA caches only the app shell: matches and money always need the live server.
export default defineConfig({
  envDir: "../..",
  plugins: [
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["brand/margin-icon.svg", "brand/margin-cat-cutout.svg", "brand/margin-180.png"],
      manifest: {
        name: "MARGIN",
        short_name: "MARGIN",
        description: "Get greedy. Get liquidated. A 90-second arena where BOOST is a loan.",
        theme_color: "#FF3D5A",
        background_color: "#070A12",
        display: "fullscreen",
        orientation: "any",
        start_url: "/#/",
        icons: [
          { src: "brand/margin-192.png", sizes: "192x192", type: "image/png" },
          { src: "brand/margin-512.png", sizes: "512x512", type: "image/png" },
          { src: "brand/margin-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // SPA fallback so /auth/callback (NEAR Auth redirect) opens the app offline-cached too.
        navigateFallback: "/index.html",
      },
    }),
  ],
  server: { port: 1234, host: true },
  build: { target: "es2022" },
});
