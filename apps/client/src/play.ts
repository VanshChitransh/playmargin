// #/play: mounts the arena. Until U1 lands this is the boilerplate Colyseus demo,
// kept so "two clients see each other" still works end to end.
import type { Screen } from "./router";
import { Application } from "./Application";

export const play: Screen = (root) => {
  const app = new Application();
  const onResize = (): void => {
    app.renderer.resize(window.innerWidth, window.innerHeight);
    app.viewport?.resize(window.innerWidth, window.innerHeight);
  };
  void app.init().then(() => {
    app.interpolation = true;
    root.appendChild(app.canvas);
    window.addEventListener("resize", onResize);
  });
  return () => {
    window.removeEventListener("resize", onResize);
    void app.room?.leave();
    app.interpolation = false;
    app.destroy(true);
  };
};
