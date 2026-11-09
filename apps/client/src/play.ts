// #/play: joins a live free match, or, if no server answers in 2.5 s (or ?local is set),
// runs offline practice on the real rules with local bots. Either way the same renderer,
// HUD, receipt and end screens run on top. Open /?fps#/play to see the frame rate.
import type { GameEventMsg, InputCmd, JoinOpts } from "@margin/core";
import type { Frame } from "./game/frame";
import { LocalMatch } from "./game/local";
import { Receipt } from "./game/receipt";
import { Hud } from "./hud/hud";
import { Controls } from "./input/controls";
import { MatchConnection, guestKey } from "./net/client";
import { ArenaRenderer } from "./render/arena";
import { rerender, type Screen } from "./router";
import { showDeath, showResults } from "./screens/overlays";
import { setLocalLog } from "./screens/verify";
import { C } from "./render/colors";
import { play as sfx } from "./audio";

interface Source {
  readonly me: string;
  readonly matchId: string;
  frameAt(nowMs: number): Frame | null;
  send(cmd: InputCmd): void;
  onEvent(cb: (e: GameEventMsg) => void): () => void;
  leave?(): void;
}

const JOIN_TIMEOUT_MS = 2500;

/** A paid seat handed over by #/cash after the ticket is bought; used once. */
// A function, so every join attempt signs a fresh one-use proof (valid 60 s).
let paidSeat: (() => JoinOpts) | null = null;
export const setPaidSeat = (o: () => JoinOpts): void => void (paidSeat = o);

async function connect(roomCode?: string): Promise<Source> {
  const paid = paidSeat;
  paidSeat = null;
  // A paid seat never falls back to offline practice: the ticket is real, so the error must show.
  if (paid) {
    const conn = new MatchConnection();
    await conn.join(paid());
    return conn;
  }
  if (!new URLSearchParams(location.search).has("local")) {
    const conn = new MatchConnection();
    const timeout = new Promise<never>((_, no) => setTimeout(() => no(new Error("join timeout")), JOIN_TIMEOUT_MS));
    try {
      await Promise.race([conn.join({ mode: "free", guestKey: guestKey(), roomCode }), timeout]);
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

  /** Event to effect: every money moment gets a visible number or burst where it happened. */
  const juice = (e: GameEventMsg, me: string): void => {
    const at = (id: string): { x: number; y: number; r: number } | undefined => {
      const b = lastFrame?.blobs.find((x) => x.id === id);
      return b && { x: b.x, y: b.y, r: b.radius };
    };
    const z = arena.zoomLevel;
    const num = (n: number): string => (n >= 10 ? Math.round(n).toString() : n.toFixed(1));
    switch (e.type) {
      case "boost":
      case "repay": {
        const p = e.blob === me ? at(me) : undefined;
        if (p) sfx(e.type);
        if (p) arena.fx.floatText(p.x, p.y - p.r, `${e.type === "boost" ? "+" : "\u2212"}${num(e.amount)}`, e.type === "boost" ? C.gold : C.paper, z);
        break;
      }
      case "spikeHit": {
        const p = at(e.blob);
        if (!p) break;
        arena.fx.shards(p.x, p.y, Math.max(4, Math.min(18, Math.round(e.damage / 2))), C.muted, p.r);
        if (e.blob === me) {
          arena.fx.floatText(p.x, p.y - p.r, `\u2212${num(e.damage)}`, C.liq, z);
          sfx("spike");
        }
        break;
      }
      case "pop": {
        const p = at(e.victim);
        if (p) arena.fx.shards(p.x, p.y, 22, C.liq, p.r);
        if (e.victim === me) arena.hitStop(150);
        if (e.victim === me || e.by === me) sfx("pop");
        const by = e.by === me ? at(me) : undefined;
        if (by && e.bounty > 0) {
          arena.fx.floatText(by.x, by.y - by.r, `+${num(e.bounty)}`, C.gold, z);
          sfx("coin");
        }
        break;
      }
      case "eat": {
        const p = e.by === me ? at(me) : undefined;
        if (p) {
          arena.fx.floatText(p.x, p.y - p.r, `+${num(e.gained)}`, C.gold, z);
          sfx("coin");
        }
        break;
      }
    }
  };

  const wasPaid = paidSeat !== null;
  // A paid rematch needs a new ticket, so it goes back through #/cash.
  const again = (): void => (wasPaid ? void (location.hash = "#/cash") : rerender());
  const home = (): void => void (location.hash = "#/");
  const toVerify = async (): Promise<void> => {
    if (src instanceof LocalMatch) setLocalLog(await src.log());
    location.hash = `#/verify/${encodeURIComponent(src?.matchId ?? "")}`;
  };
  const finish = (): void => {
    if (ended || !lastFrame || !receipt) return;
    ended = true;
    const o = receipt.outcome(lastFrame.blobs);
    overlay?.remove();
    // A beat after the bell so the last pop or cash-out is seen before the receipt covers it.
    setTimeout(() => !left && (overlay = showResults(root, o, (a) => (a === "again" ? again() : a === "verify" ? void toVerify() : home()))), 900);
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

  void connect(params.code).catch((e: Error) => {
    status.textContent = `Could not join the paid match: ${e.message}. Your ticket stays on your account for the next one.`;
    return new Promise<never>(() => {});
  }).then((s) => {
    if (left) return s.leave?.();
    src = s;
    status.textContent = s instanceof LocalMatch ? "Offline practice: real rules, local bots" : "";
    receipt = new Receipt(s.me);
    s.onEvent((e) => {
      receipt?.event(e);
      juice(e, s.me);
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
