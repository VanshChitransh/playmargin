// #/play: joins a free match and draws it. If the server is unreachable (or the URL
// has ?synth) it plays the synthetic loop instead, so the client is always demoable.
// Open /?fps#/play to see the frame rate.
import type { Screen } from "./router";
import { ArenaRenderer, type FrameSource } from "./render/arena";
import { H, W, synthFrame } from "./game/synth";
import { MatchConnection, guestKey } from "./net/client";
import { Controls } from "./input/controls";
import { Hud } from "./hud/hud";

export const play: Screen = (root) => {
  const q = new URLSearchParams(location.search);
  const arena = new ArenaRenderer();
  const conn = new MatchConnection();
  const t0 = performance.now();
  // Offline mode steers my blob locally so controls can be felt without a server.
  const me = { x: W / 2, y: H / 2 };
  let dir = { x: 0, y: 0 };
  let last = t0;
  const synth: FrameSource = (now) => {
    const dt = (now - last) / 1000;
    last = now;
    me.x = Math.min(W, Math.max(0, me.x + dir.x * 300 * dt));
    me.y = Math.min(H, Math.max(0, me.y + dir.y * 300 * dt));
    return synthFrame((now - t0) / 1000, me);
  };
  let source: FrameSource = synth;
  const controls = new Controls(root, (cmd) => {
    dir = { x: cmd.dirX, y: cmd.dirY };
    if (cmd.boost || cmd.repay || cmd.cashout) console.debug("tap", cmd);
    conn.send(cmd);
  });

  // Pixi init is async: if the player leaves before it resolves, destroy on arrival.
  let left = false;
  let mounted = false;
  const hud = new Hud(root, controls.els, (open) => controls.setCashoutVisible(open));
  // Dev-only hook so tests and agent-browser can read the drawn frame (stripped from builds).
  const draw: FrameSource = (now) => {
    const f = source(now);
    if (f) hud.update(f, now);
    if (import.meta.env.DEV) (window as unknown as { __frame?: unknown }).__frame = f;
    return f;
  };
  void arena.mount(root, draw, { fps: q.has("fps") }).then(() => {
    mounted = true;
    if (left) arena.destroy();
  });
  if (!q.has("synth")) {
    conn
      .join(guestKey())
      .then(() => {
        if (left) return conn.leave();
        source = (now) => conn.buffer.frameAt(now);
      })
      .catch((e: unknown) => console.warn("server unreachable, playing the synthetic loop", e));
  }
  return () => {
    left = true;
    controls.destroy();
    hud.destroy();
    conn.leave();
    if (mounted) arena.destroy();
  };
};
