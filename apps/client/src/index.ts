// Client entry: theme CSS, then the path router decides which screen owns #app.
import "./style.css";
import { lazy, startRouter } from "./router";
import { isAuthCallback, runAuthCallback } from "./auth-callback";
import { notFound } from "./screens";
import { landing } from "./screens/landing";
import { how } from "./screens/how";
import { unlockAudioOnGesture } from "./audio";
// Eager: installs the data-track click listener on first import (S5 analytics, anonymous, opt-out aware).
import { trackView } from "./analytics/track";
import { laptopCapable } from "./device";
import type { Screen } from "./router";
import { laptopOnly } from "./screens/laptop";

unlockAudioOnGesture();
// The PWA is retired: drop any service worker and cache an earlier visit installed. public/sw.js
// does the same from inside an old install that never loads this code.
void navigator.serviceWorker?.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()));
void globalThis.caches?.keys().then((keys) => keys.filter((k) => /^(workbox|margin)/.test(k)).forEach((k) => void caches.delete(k)));

const app = document.getElementById("app")!;
// The game, chain and verify code load on first visit; the home page stays light (QA-B-16).
// Phones and tablets get the "plays on a laptop" card on game routes; how and verify stay open.
const laptop = (s: Screen): Screen => (root, p) => (laptopCapable() ? s(root, p) : laptopOnly(root, p));
const play = laptop(lazy(() => import("./play").then((m) => m.play)));
const judge = laptop(lazy(() => import("./play").then((m) => (root, p) => m.play(root, { ...p, judge: "1" }))));
if (isAuthCallback()) void runAuthCallback(app);
else startRouter(app, {
  "/": landing,
  "/how": how,
  "/play": play,
  "/cash": laptop(lazy(() => import("./screens/cash").then((m) => m.cash))),
  "/watch": laptop(lazy(() => import("./screens/watch").then((m) => m.watch))),
  "/judge": judge,
  "/verify/:id": lazy(() => import("./screens/verify").then((m) => m.verify)),
  // Read only, so phones may open it too (like verify).
  "/judges": lazy(() => import("./screens/judges").then((m) => m.judges)),
  "/r/:code": play,
  // Private funnel numbers (S5), read only, no laptop guard.
  "/stats": lazy(() => import("./screens/stats").then((m) => m.stats)),
  "*": notFound,
}, trackView);
