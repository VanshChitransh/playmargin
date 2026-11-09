// #/play: joins a live free match, or, if no server answers in 2.5 s (or ?local is set),
// runs offline practice on the real rules with local bots. Either way the same renderer,
// HUD, receipt and end screens run on top. Open /?fps#/play to see the frame rate.
import type { GameEventMsg, InputCmd, JoinOpts } from "@margin/core";
import type { Frame } from "./game/frame";
import { LocalMatch } from "./game/local";
import { Receipt } from "./game/receipt";
import { Hud } from "./hud/hud";
import { elapsedS } from "./hud/logic";
import { shareCertificate, verifyUrl } from "./share/certificate";
import { shareLink } from "./share/link";
import type { Outcome } from "./game/receipt";
import { shareRoom } from "./net/room-code";
import { Controls } from "./input/controls";
import { MatchConnection, guestKey } from "./net/client";
import { refusalWords } from "./net/refusal";
import { ArenaRenderer } from "./render/arena";
import { rerender, type Screen } from "./router";
import { showAborted, showDeath, showResults } from "./screens/overlays";
import { setLocalLog } from "./screens/verify";
import { C } from "./render/colors";
import { engine, engineFuel, play as sfx } from "./audio";
import { JUICE } from "./render/juice";

interface Source {
  readonly me: string;
  readonly matchId: string;
  frameAt(nowMs: number): Frame | null;
  send(cmd: InputCmd): void;
  onEvent(cb: (e: GameEventMsg) => void): () => void;
  leave?(): void;
  onCommander?: (rationale: string | null) => void;
  onAborted?: (reason: string) => void;
}

const JOIN_TIMEOUT_MS = 2500;

/** A paid seat handed over by #/cash after the ticket is bought; used once. */
// A function, so every join attempt signs a fresh one-use proof (valid 60 s).
let paidSeat: (() => JoinOpts) | null = null;
export const setPaidSeat = (o: () => JoinOpts): void => void (paidSeat = o);

/** The server refused the seat (credits, already playing, busy...): shown, never papered over. */
class Refused extends Error {}
/** Set by the refusal card's "Practice offline" button: the next connect goes straight to local bots. */
let offlineOnPurpose = false;

async function connect(roomCode?: string, judge = false): Promise<Source> {
  const paid = paidSeat;
  paidSeat = null;
  // Reloaded or came back mid-match: take the held seat back before anything else.
  if (!paid) {
    const back = new MatchConnection();
    if (await back.resume()) return back;
  }
  // A paid seat never falls back to offline practice: the ticket is real, so the error must show.
  if (paid) {
    const conn = new MatchConnection();
    await conn.join(paid());
    return conn;
  }
  const wantLocal = offlineOnPurpose || new URLSearchParams(location.search).has("local");
  offlineOnPurpose = false;
  if (!wantLocal) {
    const conn = new MatchConnection();
    const timeout = new Promise<never>((_, no) => setTimeout(() => no(new Error("join timeout")), JOIN_TIMEOUT_MS));
    try {
      await Promise.race([conn.join({ mode: "free", guestKey: guestKey(), roomCode }, judge), timeout]);
      return conn;
    } catch (e) {
      conn.leave();
      // The server said no (not just silence): show why, never dress practice up as a real lobby.
      const why = refusalWords((e as Error).message ?? "");
      if (why) throw new Refused(why);
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
  controls.onHold = (on) => {
    arena.held = on;
    hud.held = on;
    engine(on);
    sfx(on ? "press" : "release");
    hud.speedLines(on && !controls.els.boost.classList.contains("blocked"));
  };
  const status = document.createElement("div");
  status.className = "tag pointer-events-none fixed bottom-3 left-3 max-w-[55vw] text-muted";
  status.textContent = "Connecting";
  root.appendChild(status);

  /** Event to effect: every money moment gets a visible number or burst where it happened. */
  let repayRun = 0;
  let lastRepayAt = -Infinity;
  // Nitro sound follows the tank: pitch rises, a coin ticks per 10% borrowed, a clunk when dry.
  let lastStep = -1;
  let dry = false;
  const nitroSound = (f: Frame): void => {
    const mine = f.blobs.find((b) => b.id === f.me);
    if (!mine || !arena.held || f.match.phase !== "LIVE") return void ((lastStep = -1), (dry = false));
    const fuel = mine.fuel ?? mine.pips / 3;
    engineFuel(fuel);
    const step = Math.floor((1 - fuel) / JUICE.COIN_TICK_STEP);
    if (lastStep >= 0 && step > lastStep) (sfx("clink", 0.75), navigator.vibrate?.(6));
    lastStep = step;
    if (fuel <= 0.001 && !dry) {
      dry = true;
      sfx("clunk");
      engine(false);
      navigator.vibrate?.([40, 30, 40]);
    }
  };

  const juice = (e: GameEventMsg, me: string): void => {
    const at = (id: string): { x: number; y: number; r: number } | undefined => {
      const b = lastFrame?.blobs.find((x) => x.id === id);
      return b && { x: b.x, y: b.y, r: b.radius };
    };
    const z = arena.zoomLevel;
    const num = (n: number): string => (n >= 10 ? Math.round(n).toString() : n.toFixed(1));
    switch (e.type) {
      // BOOST feel (engine sound, trail, ticking +N) comes from the held state, not this event.
      case "repay": {
        const p = e.blob === me ? at(me) : undefined;
        if (p) {
          const now = performance.now();
          repayRun = now - lastRepayAt < JUICE.REPAY_RUN_MS ? repayRun + 1 : 0;
          lastRepayAt = now;
          sfx("clink", JUICE.REPAY_PITCH[Math.min(repayRun, JUICE.REPAY_PITCH.length - 1)]);
          hud.coinsToOwe();
        }
        if (p) arena.squashMe(me);
        if (p) arena.fx.floatText(p.x, p.y - p.r, `\u2212${num(e.amount)}`, C.paper, z);
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
        if (e.victim === me) arena.hitStop(JUICE.HIT_STOP_MS);
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
    setTimeout(() => !left && (overlay = showResults(root, o, (a) => (a === "again" ? again() : a === "verify" ? void toVerify() : a === "share" ? void shareResult(o, src!.matchId) : home()), wasPaid)), 900);
  };

  const draw = (now: number): Frame | null => {
    const f = src?.frameAt(now) ?? null;
    const dt = (now - last) / 1000;
    last = now;
    if (!f) return null;
    lastFrame = f;
    hud.update(f, now);
    nitroSound(f);
    receipt?.frame(f.blobs, f.match.rateTier, now, dt, f.rateBps, f.match.phase === "LIVE" ? elapsedS(f.match) : undefined, f.food);
    if (f.match.phase === "ENDED") finish();
    // Dev-only hook so tests and agent-browser can read the drawn frame (stripped from builds).
    if (import.meta.env.DEV) Object.assign(window, { __frame: f, __arena: arena });
    return f;
  };

  void arena.mount(root, draw, { fps: new URLSearchParams(location.search).has("fps") }).then(() => {
    mounted = true;
    if (left) arena.destroy();
  });

  void connect(params.code, params.judge === "1").catch((e: Error) => {
    if (e instanceof Refused) refusedCard(root, e.message);
    else status.textContent = `Could not join the paid match: ${e.message}. Your ticket stays on your account for the next one.`;
    return new Promise<never>(() => {});
  }).then((s) => {
    if (left) return s.leave?.();
    src = s;
    hud.offline = s instanceof LocalMatch;
    status.textContent =
      s instanceof LocalMatch
        ? "Offline practice: real rules, local bots, nothing counts"
        : params.judge === "1"
          ? "Judge Run: a 90 s scenario. Seeded map, normal rules, Drone-1 hunts red blobs. Most first-timers get greedy. Will you?"
          : "";
    if (params.code && !(s instanceof LocalMatch)) roomChip(root, params.code);
    receipt = new Receipt(s.me);
    if (import.meta.env.DEV) (window as unknown as { __receipt: Receipt }).__receipt = receipt;
    s.onCommander = (r) => hud.commander(r);
    s.onAborted = (reason) => {
      ended = true;
      overlay?.remove();
      overlay = showAborted(root, reason, () => !left && home());
    };
    s.onEvent((e) => {
      receipt?.event(e);
      juice(e, s.me);
      if ((e.type === "pop" || e.type === "eat") && e.victim === s.me && !ended) {
        const death = receipt!.outcome(lastFrame?.blobs ?? []).death!;
        overlay = showDeath(root, death, (a) => {
          if (a === "again") return again();
          if (a === "share") return void shareCertificate({ ...death, matchId: s.matchId });
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
    engine(false);
    controls.destroy();
    hud.destroy();
    overlay?.remove();
    status.remove();
    if (mounted) arena.destroy();
  };
};

/** Private room: the code stays on screen with one tap to send the link to a friend. */
function roomChip(root: HTMLElement, code: string): void {
  const b = document.createElement("button");
  b.className = "sticker sticker-press fixed bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-box bg-paper px-4 py-2 font-display text-lg text-ink";
  const label = (t: string): void => void (b.innerHTML = `Room <span class="num">${code}</span> · ${t}`);
  label("Invite a friend");
  b.addEventListener("click", () =>
    void shareRoom(code).then((r) => label(r === "copied" ? "Link copied" : r === "shared" ? "Sent" : "Copy failed")),
  );
  root.appendChild(b);
}

/** Share from the results screen: the certificate after a liquidation, else a one-line brag + verify link. */
function shareResult(o: Outcome, matchId: string): void {
  if (o.death && !o.death.eaten) return void shareCertificate({ ...o.death, matchId });
  const what = o.kind === "cashed" ? `cashed out ${o.end.toFixed(2)}` : o.kind === "survived" ? `survived with ${o.end.toFixed(2)}` : "got eaten";
  void shareLink(`I ${what} on MARGIN, rank #${o.rank} of ${o.of}. Get greedy. Get liquidated.`, verifyUrl(matchId));
}

/** The server said no: say why, offer offline practice as an explicit choice, or go home. */
function refusedCard(root: HTMLElement, why: string): void {
  const el = document.createElement("div");
  el.className = "fixed inset-0 z-20 grid place-items-center bg-ink/80 p-4";
  el.innerHTML = `<div class="sticker max-w-sm rounded-box bg-paper p-6 text-center text-ink">
    <h2 class="font-display text-4xl">Can't join right now</h2>
    <p data-why class="mt-2"></p>
    <div class="mt-5 flex flex-wrap justify-center gap-3">
      <button data-off class="sticker sticker-press rounded-box bg-ink px-5 py-3 font-display text-lg text-paper">Practice offline</button>
      <a href="#/" class="sticker sticker-press rounded-box bg-paper px-5 py-3 font-display text-lg">Home</a></div>
    <p class="mt-3 text-xs text-ink/60">Offline practice runs the real rules against local bots. Nothing counts.</p></div>`;
  el.querySelector("[data-why]")!.textContent = why;
  el.querySelector("[data-off]")!.addEventListener("click", () => {
    offlineOnPurpose = true;
    rerender();
  });
  root.appendChild(el);
}
