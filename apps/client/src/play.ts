// #/play: mounts the arena renderer. Frames come from the synthetic generator until
// U2 wires the Colyseus room; open /?fps#/play to see the frame rate.
import type { Screen } from "./router";
import { ArenaRenderer } from "./render/arena";
import { synthFrame } from "./game/synth";

export const play: Screen = (root) => {
  const arena = new ArenaRenderer();
  const t0 = performance.now();
  const showFps = new URLSearchParams(location.search).has("fps");
  // Pixi init is async: if the player leaves before it resolves, destroy on arrival.
  let left = false;
  let mounted = false;
  void arena.mount(root, (now) => synthFrame((now - t0) / 1000), { fps: showFps }).then(() => {
    mounted = true;
    if (left) arena.destroy();
  });
  return () => {
    left = true;
    if (mounted) arena.destroy();
  };
};
