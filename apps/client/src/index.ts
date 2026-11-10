// Client entry: theme CSS, then the hash router decides which screen owns #app.
import "./style.css";
import { lazy, startRouter } from "./router";
import { isAuthCallback, runAuthCallback } from "./auth-callback";
import { notFound } from "./screens";
import { landing } from "./screens/landing";
import { how } from "./screens/how";
import { unlockAudioOnGesture } from "./audio";

unlockAudioOnGesture();

const app = document.getElementById("app")!;
// The game, chain and verify code load on first visit; the home page stays light (QA-B-16).
const play = lazy(() => import("./play").then((m) => m.play));
const judge = lazy(() => import("./play").then((m) => (root, p) => m.play(root, { ...p, judge: "1" })));
if (isAuthCallback()) void runAuthCallback(app);
else startRouter(app, {
  "/": landing,
  "/how": how,
  "/play": play,
  "/cash": lazy(() => import("./screens/cash").then((m) => m.cash)),
  "/watch": lazy(() => import("./screens/watch").then((m) => m.watch)),
  "/judge": judge,
  "/verify/:id": lazy(() => import("./screens/verify").then((m) => m.verify)),
  "/r/:code": play,
  "*": notFound,
});
