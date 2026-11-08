// Client entry: theme CSS, then the hash router decides which screen owns #app.
import "./style.css";
import { startRouter } from "./router";
import { judge, landing, notFound, room, verify } from "./screens";
import { play } from "./play";

startRouter(document.getElementById("app")!, {
  "/": landing,
  "/play": play,
  "/judge": judge,
  "/verify/:id": verify,
  "/r/:code": room,
  "*": notFound,
});
