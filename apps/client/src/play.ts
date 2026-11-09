// #/play: joins a live free match, or, if no server answers in 2.5 s (or ?local is set),
// runs offline practice on the real rules with local bots. Either way the same renderer,
// HUD, receipt and end screens run on top. Open /?fps#/play to see the frame rate.
import type { GameEventMsg, InputCmd } from "@margin/core";
import type { Frame } from "./game/frame";
import { LocalMatch } from "./game/local";
import { Receipt } from "./game/receipt";
import { Hud } from "./hud/hud";
import { Controls } from "./input/controls";
import { MatchConnection, guestKey } from "./net/client";
import { ArenaRenderer } from "./render/arena";
import { rerender, type Screen } from "./router";
import { showDeath, showResults } from "./screens/overlays";

interface Source {
  readonly me: string;
  frameAt(nowMs: number): Frame | null;
  send(cmd: InputCmd): void;
  onEvent(cb: (e: GameEventMsg) => void): () => void;
  leave?(): void;
}

const JOIN_TIMEOUT_MS = 2500;

async function connect(roomCode?: string): Promise<Source> {
  if (!new URLSearchParams(location.search).has("local")) {
    const conn = new MatchConnection();
    const timeout = new Promise<never>((_, no) => setTimeout(() => no(new Error("join timeout")), JOIN_TIMEOUT_MS));
    try {
      await Promise.race([conn.join(guestKey(), roomCode), timeout]);
      return conn;
    } catch (e) {
      conn.leave();
      console.warn("server unreachable, offline practice", e);
    }
  }
  return new LocalMatch({ seed: (Date.now() >>> 0) % 1e9, withMe: true, bots: 11, warmupS: 8 });
}

export const play: Screen = (root, params) => {
  const arena = new ArenaRenderer();
  let src: Source | null = null;
  let left = false;
  let mounted = false;
  let receipt: Receipt | null = null;
  let overlay: HTMLElement | null = null;
  let ended = false;
  let last = performance.now();
  let lastFrame: Frame | null = null;

  const controls = new Controls(root, (cmd) => src?.send(cmd));
  const hud = new Hud(root, controls.els, (open) => controls.setCashoutVisible(open));
  const status = document.createElement("div");
  status.className = "tag pointer-events-none fixed bottom-3 left-3 text-muted";
  status.textContent = "Connecting";
  root.appendChild(status);

  const again = (): void => rerender();
  const home = (): void => void (location.hash = "#/");
  const finish = (): void => {
    if (ended || !lastFrame || !receipt) return;
    ended = true;
    const o = receipt.outcome(lastFrame.blobs);
    overlay?.remove();
    // A beat after the bell so the last pop or cash-out is seen before the receipt covers it.
    setTimeout(() => !left && (overlay = showResults(root, o, (a) => (a === "again" ? again() : home()))), 900);
  };

  const draw = (now: number): Frame | null => {
    const f = src?.frameAt(now) ?? null;
    const dt = (now - last) / 1000;
    last = now;
    if (!f) return null;
    lastFrame = f;
    hud.update(f, now);
    receipt?.frame(f.blobs, f.match.rateTier, now, dt, f.rateBps);
    if (f.match.phase === "ENDED") finish();
    // Dev-only hook so tests and agent-browser can read the drawn frame (stripped from builds).
    if (import.meta.env.DEV) (window as unknown as { __frame?: unknown }).__frame = f;
    return f;
  };

  void arena.mount(root, draw, { fps: new URLSearchParams(location.search).has("fps") }).then(() => {
    mounted = true;
    if (left) arena.destroy();
  });

  void connect(params.code).then((s) => {
    if (left) return s.leave?.();
    src = s;
    status.textContent = s instanceof LocalMatch ? "Offline practice: real rules, local bots" : "";
    receipt = new Receipt(s.me);
    s.onEvent((e) => {
      receipt?.event(e);
      if (e.type === "pop" && e.victim === s.me && !ended) {
        overlay = showDeath(root, receipt!.outcome(lastFrame?.blobs ?? []).death!, (a) => {
          if (a === "again") return again();
          overlay?.remove();
          overlay = null;
        });
      }
      if (e.type === "matchEnd") finish();
    });
  });

  return () => {
    left = true;
    src?.leave?.();
    controls.destroy();
    hud.destroy();
    overlay?.remove();
    status.remove();
    if (mounted) arena.destroy();
  };
};
