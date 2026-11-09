// Client entry: theme CSS, then the hash router decides which screen owns #app.
import "./style.css";
import { startRouter } from "./router";
import { isAuthCallback, runAuthCallback } from "./auth-callback";
import { judge, notFound } from "./screens";
import { verify } from "./screens/verify";
import { landing } from "./screens/landing";
import { play } from "./play";
import { cash } from "./screens/cash";
import { unlockAudioOnGesture } from "./audio";

unlockAudioOnGesture();

const app = document.getElementById("app")!;
if (isAuthCallback()) void runAuthCallback(app);
else startRouter(app, {
  "/": landing,
  "/play": play,
  "/cash": cash,
  "/judge": judge,
  "/verify/:id": verify,
  "/r/:code": play,
  "*": notFound,
});
