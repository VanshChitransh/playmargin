// Client entry: theme CSS, then the hash router decides which screen owns #app.
import "./style.css";
import { startRouter } from "./router";
import { isAuthCallback, runAuthCallback } from "./auth-callback";
import { notFound } from "./screens";
import { verify } from "./screens/verify";
import { landing } from "./screens/landing";
import { how } from "./screens/how";
import { play } from "./play";
import { cash } from "./screens/cash";
import { watch } from "./screens/watch";
import { unlockAudioOnGesture } from "./audio";

unlockAudioOnGesture();

const app = document.getElementById("app")!;
if (isAuthCallback()) void runAuthCallback(app);
else startRouter(app, {
  "/": landing,
  "/how": how,
  "/play": play,
  "/cash": cash,
  "/watch": watch,
  "/judge": (root, p) => play(root, { ...p, judge: "1" }),
  "/verify/:id": verify,
  "/r/:code": play,
  "*": notFound,
});
