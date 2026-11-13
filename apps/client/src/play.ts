// /play: joins a live free match, or, if no server answers in 2.5 s (or ?local is set),
// runs offline practice on the real rules with local bots. Either way the same renderer,
// HUD, receipt and end screens run on top. Open /play?fps to see the frame rate.
import { R, nameProblem, type GameEventMsg, type InputCmd, type JoinOpts, type LogEntry } from "@margin/core";
import type { Frame } from "./game/frame";
import { LocalMatch } from "./game/local";
import { Receipt, mergeLog, receiptFromLog, type ClutchSave } from "./game/receipt";
import { Hud } from "./hud/hud";
import { stakeLabel } from "./stake";
import { elapsedS, outsideZone } from "./hud/logic";
import { shareCertificate, verifyUrl } from "./share/certificate";
import { mountSocialShare } from "./social/mount";
import { shareLink } from "./share/link";
import type { Outcome } from "./game/receipt";
import { isRoomCode, shareRoom } from "./net/room-code";
import { Controls } from "./input/controls";
import { playerName, setPlayerName } from "./player/name";
import { ENDPOINT, MatchConnection, guestKey } from "./net/client";
import { joinFailWords } from "./net/refusal";
import { track } from "./analytics/track";
import { seat } from "./net/seat";
import { ArenaRenderer } from "./render/arena";
import { Director } from "./render/director";
import { rerender, type Screen, navigate } from "./router";
import { showAborted, showDeath, showResults } from "./screens/overlays";
import { setLocalLog } from "./screens/verify";
import { C } from "./render/colors";
import { engine, engineFuel, play as sfx, repayLevel, repayTone } from "./audio";
import { JUICE } from "./render/juice";

interface Source {
  readonly me: string;
  readonly matchId: string;
  frameAt(nowMs: number): Frame | null;
  send(cmd: InputCmd): void;
  onEvent(cb: (e: GameEventMsg) => void): () => void;
  leave?(): void;
  startNow?(): void;
  onCommander?: (rationale: string | null) => void;
  onAborted?: (reason: string) => void;
}

/** How long a join may take before we say the arena is unreachable. Generous on purpose: a slow
 *  phone link must still reach the real match, never be dropped into offline bots (QA-B-14). */
const JOIN_TIMEOUT_MS = 10_000;
/** A held seat answers fast or is gone; a late answer is closed so no second seat stays alive. */
const RESUME_TIMEOUT_MS = 4000;
/** "Already in this match" right after leaving one: how long to wait before the one retry. */
const ALREADY_RETRY_MS = 1500;
/** No server state for this long (a dead room, a hung socket, a drop that never reconnects): stop
 *  pretending and show the can't-join card. The server sends state every tick, so 5 s is a real stall. */
const STALL_MS = 5000;

/** A paid seat handed over by /cash after the ticket is bought; used once. */
// A function, so every join attempt signs a fresh one-use proof (valid 60 s).
let paidSeat: (() => JoinOpts) | null = null;
export const setPaidSeat = (o: () => JoinOpts): void => void (paidSeat = o);

/** The server refused the seat (credits, already playing, busy...): shown, never papered over. */
class Refused extends Error {}
/** Set by the refusal card's "Practice offline" button: the next connect goes straight to local bots. */
let offlineOnPurpose = false;
/** The last connect found a held seat it could not resume (the match ended or my blob died meanwhile). */
let seatLost = false;

async function connect(roomCode?: string, judge = false): Promise<Source> {
  const paid = paidSeat;
  paidSeat = null;
  // Reloaded or came back mid-match: take the held seat back before anything else.
  if (!paid) {
    const target = judge ? "judge" : (roomCode ?? "play");
    // A seat was held: if it cannot be taken back, the player must hear why they start over (QA-B-10).
    seatLost = seat.wasLive(target); // a seat held only in warm-up left no blob behind
    const back = new MatchConnection();
    const late = new Promise<boolean>((r) => setTimeout(() => r(false), RESUME_TIMEOUT_MS));
    if (await Promise.race([back.resume(target), late])) {
      seatLost = false;
      return back;
    }
    back.leave(); // a resume that answers after the timeout must not keep a second seat alive
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
    const opts = { mode: "free" as const, guestKey: guestKey(), roomCode, name: playerName() ?? undefined };
    try {
      try {
        await Promise.race([conn.join(opts, judge), timeout]);
      } catch (e) {
        // My last blob's leave may still be on its way (slow link): wait a beat and try once more
        // before showing the card (QA-B-19).
        if (!/already in this match/i.test((e as Error).message ?? "")) throw e;
        await new Promise((r) => setTimeout(r, ALREADY_RETRY_MS));
        await Promise.race([conn.join(opts, judge), timeout]);
      }
      return conn;
    } catch (e) {
      conn.leave();
      // Never fall back silently: a refusal says why, silence says the arena is unreachable, and
      // offline practice is only ever the player's own choice on that card.
      throw new Refused(joinFailWords((e as Error).message ?? ""));
    }
  }
  return new LocalMatch({ seed: (Date.now() >>> 0) % 1e9, withMe: true, bots: 11, warmupS: 8 });
}

export const play: Screen = (root, params) => {
  const arena = new ArenaRenderer();
  // After my blob pops or cashes out, keep watching the match: killer first, then the action.
  const director = new Director();
  arena.director = (f, tS) => director.shot(f, tS);
  let src: Source | null = null;
  let left = false;
  let mounted = false;
  let receipt: Receipt | null = null;
  let overlay: HTMLElement | null = null;
  let ended = false;
  let died = false;
  let last = performance.now();
  let lastFrame: Frame | null = null;

  const controls = new Controls(root, (cmd) => src?.send(cmd));
  const hud = new Hud(root, controls.els, (open) => controls.setCashoutVisible(open));
  hud.onStart = () => src?.startNow?.();
  hud.anchor = () => (lastFrame ? arena.screenOf(lastFrame.me) : null);
  controls.onHold = (on) => {
    arena.held = on;
    hud.held = on;
    engine(on);
    sfx(on ? "press" : "release");
    hud.speedLines(on && !controls.els.boost.classList.contains("blocked"));
  };
  let repayHeld = false;
  let holdAt = 0;
  // After a real hold the counter already told the story: drop the trailing logged repay event.
  let quietUntil = 0;
  controls.onRepayHold = (on) => {
    const now = performance.now();
    if (on) holdAt = now;
    else if (now - holdAt > JUICE.REPAY_TAP_MS) quietUntil = now + 600;
    repayHeld = on;
    hud.repayHold(on);
    repayTone(on && !controls.els.repay.classList.contains("blocked"));
  };
  const status = document.createElement("div");
  // Phones: the clock pill carries an "offline" tag instead, so this line never crowds the bottom.
  status.className = "tag pointer-events-none fixed bottom-3 left-3 max-w-[55vw] text-muted max-sm:hidden";
  root.appendChild(status);
  // A small laptop window still plays (like agar, nothing is blocked); below about 800x520 a note
  // suggests a bigger window, and it can be dismissed.
  const small = document.createElement("button");
  small.className = "pop-sm pop-press fixed top-[60px] left-3 z-10 hidden rounded-xl bg-card px-2.5 py-1 text-xs font-bold text-ink";
  small.textContent = "Bigger window, full arena  ✕";
  small.title = "Make the window bigger for the full arena (click to hide)";
  let smallOff = false;
  const fit = (): void => void small.classList.toggle("hidden", smallOff || (innerWidth >= 800 && innerHeight >= 520));
  small.addEventListener("click", () => {
    smallOff = true;
    fit();
  });
  addEventListener("resize", fit);
  fit();
  root.appendChild(small);
  // Paid rooms: the match's interest rate comes from the LP vault's utilisation when the room opens.
  // RULES: the lobby shows it as Loan cost LOW / MED / HIGH, above the BOOST dock where the loan starts.
  const loanCost = document.createElement("div");
  loanCost.className = "pop-sm pointer-events-none fixed right-3 bottom-[200px] z-10 hidden rounded-xl px-3 py-1.5 text-sm font-bold text-ink";
  root.appendChild(loanCost);
  const showLoanCost = (f: Frame): void => {
    const on = f.match.mode === "paid" && (f.match.phase === "WARMUP" || f.match.phase === "COUNTDOWN");
    loanCost.classList.toggle("hidden", !on);
    if (!on) return;
    const tier = f.match.rateTier;
    if (loanCost.dataset.tier === tier) return;
    loanCost.dataset.tier = tier;
    loanCost.textContent = `Loan cost: ${tier}`;
    // Colour by meaning: low is safe, medium a warning, high is danger.
    loanCost.style.background = `var(--color-${tier === "HIGH" ? "liq" : tier === "MED" ? "warn" : "safe"})`;
    loanCost.style.color = tier === "HIGH" ? "var(--color-card)" : "";
  };
  // Joining can take a few seconds on a slow link: say so in the middle of the screen.
  const connecting = document.createElement("div");
  connecting.className = "pointer-events-none fixed inset-x-0 top-[38%] z-10 grid place-items-center";
  connecting.innerHTML = `<span class="pop rounded-2xl bg-card px-5 py-3 font-display text-2xl text-ink">Connecting to the arena...</span>`;
  root.appendChild(connecting);

  /** Event to effect: every money moment gets a visible number or burst where it happened. */
  arena.onPickup = () => sfx("blip", 1 + (Math.random() * 2 - 1) * JUICE.PICKUP_PITCH_JITTER);
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

  // Once a second outside the zone: the rule's 4% of mass as a number on my blob, plus a hurt tone.
  let zoneAt = 0;
  const zoneSting = (f: Frame, now: number): void => {
    const b = f.blobs.find((x) => x.id === f.me);
    if (!b || !outsideZone(b, f.match)) return void (zoneAt = 0);
    if (now - zoneAt < 1000) return;
    zoneAt = now;
    const lost = (b.equity + b.owe) * R.ZONE_DMG_PER_S;
    arena.fx.floatText(b.x, b.y - b.radius, `\u2212${lost >= 10 ? Math.round(lost) : lost.toFixed(1)} ZONE`, C.liq, arena.zoomLevel);
    sfx("spike", 0.8);
    navigator.vibrate?.(20);
  };

  const juice = (e: GameEventMsg | ClutchSave, me: string): void => {
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
        if (!p) break;
        // A hold shows one big counter (HUD); only a quick tap gets its chunk number and clink.
        if (repayHeld || performance.now() < quietUntil) break;
        sfx("clink");
        hud.coinsToOwe();
        arena.squashMe(me);
        arena.fx.floatText(p.x, p.y - p.r, `\u2212${num(e.amount)}`, C.paper, z);
        break;
      }
      case "clutchSave": {
        const p = e.blob === me ? at(me) : undefined;
        if (!p) break;
        hud.saved(performance.now());
        arena.hitStop(JUICE.SAVE_FREEZE_MS);
        arena.fx.shards(p.x, p.y, JUICE.SAVE_SPARKS, C.ringSafe, p.r);
        arena.fx.floatText(p.x, p.y - p.r - 20 / z, e.clutch ? "CLUTCH" : "SAVED", C.ringSafe, z * 0.7);
        sfx("saved");
        break;
      }
      case "spikeHit": {
        const p = at(e.blob);
        if (!p) break;
        arena.fx.shards(p.x, p.y, Math.max(6, Math.min(18, Math.round(e.damage / 2))), C.ink, p.r);
        if (e.blob === me) {
          // Say the cause: a spike costs even with no loan, and a bare "-8" read as a mystery.
          arena.fx.floatText(p.x, p.y - p.r, `\u2212${num(e.damage)} SPIKE`, C.liq, z);
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
  // A paid rematch needs a new ticket, so it goes back through /cash.
  const again = (): void => {
    track("play_again");
    if (wasPaid) navigate("/cash");
    else rerender();
  };
  const home = (): void => navigate("/");
  const toVerify = async (): Promise<void> => {
    if (src instanceof LocalMatch) setLocalLog(await src.log());
    navigate(`/verify/${encodeURIComponent(src?.matchId ?? "")}`);
  };
  // The contract's entry stake in dollars, read early so the paid receipt can show dollars (P03).
  let stakeUsd = 1;
  if (wasPaid) void stakeLabel().then((l) => (stakeUsd = Number(l.slice(1)) || 1));
  const results = (o: ReturnType<Receipt["outcome"]>): HTMLElement =>
    showResults(root, o, (a) => (a === "again" ? again() : a === "verify" ? void toVerify() : a === "share" ? void shareResult(o, src!.matchId, overlay) : home()), wasPaid, stakeUsd);
  const finish = (): void => {
    if (ended || !lastFrame || !receipt) return;
    ended = true;
    if (!died) track("match_finished"); // a death already counted it when its card showed
    const o = receipt.outcome(lastFrame.blobs);
    overlay?.remove();
    // A beat after the bell so the last pop or cash-out is seen before the receipt covers it. In
    // that beat the receipt lines are rebuilt from the match log itself (falls back to the live
    // estimate if the log is slow or missing).
    const fromLog = matchLog(src)
      .then((log) => (log && lastFrame ? receiptFromLog(log, lastFrame.me) : null))
      .catch(() => null);
    const wait = new Promise<null>((r) => setTimeout(() => r(null), 2500));
    const beat = new Promise((r) => setTimeout(r, 900));
    void Promise.all([Promise.race([fromLog, wait]), beat]).then(([r]) => {
      if (left) return;
      if (r) mergeLog(o, r);
      overlay = results(o);
      // near.social post block (S2): a no-op on testnet or signed out, and until overlays has the slot.
      const slot = overlay.querySelector<HTMLElement>("[data-social]");
      if (slot && src) mountSocialShare(slot, { survived: o.kind !== "popped", rank: o.rank, of: o.of, kept: o.end.toFixed(2), verifyUrl: verifyUrl(src.matchId) });
    });
  };

  // Anonymous funnel (S5 analytics): GO reached once, and a friend arriving in my private lobby.
  let wentLive = false;
  let humans = 0;
  let chip: HTMLElement | null = null;
  let cashedNote: HTMLElement | null = null;
  const funnel = (f: Frame): void => {
    // The invite chip is for the lobby: once the match is live it would sit over the arena (Q12).
    chip?.classList.toggle("hidden", f.match.phase === "LIVE" || f.match.phase === "ENDED");
    // Cashed out before the bell: say so until the receipt comes, the blob is gone from the arena (Q13).
    if (!cashedNote && f.match.phase === "LIVE" && f.blobs.find((b) => b.id === f.me)?.state === "cashed") {
      cashedNote = document.createElement("p");
      cashedNote.className = "pop-sm pointer-events-none fixed left-1/2 top-24 z-10 -translate-x-1/2 rounded-full bg-card px-5 py-2.5 font-semibold text-ink";
      cashedNote.textContent = "Cashed out. Your receipt comes at the bell.";
      root.appendChild(cashedNote);
    }
    if (f.match.phase === "ENDED") cashedNote?.remove();
    if (!wentLive && f.match.phase === "LIVE") {
      wentLive = true;
      track("warmup_done");
    }
    if (code && f.match.phase !== "LIVE") {
      const n = f.blobs.filter((b) => b.kind === "human").length;
      if (humans === 1 && n >= 2) track("friend_joined");
      humans = n;
    }
  };
  const draw = (now: number): Frame | null => {
    const f = src?.frameAt(now) ?? null;
    const dt = (now - last) / 1000;
    last = now;
    if (!f) return null;
    lastFrame = f;
    hud.update(f, now);
    showLoanCost(f);
    funnel(f);
    nitroSound(f);
    zoneSting(f, now);
    if (repayHeld) {
      repayLevel(hud.repayProgress());
      if (controls.els.repay.classList.contains("blocked")) repayTone(false); // debt cleared: the tone ends
    }
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

  // The code comes from the URL: only a well-formed one is used, and it is only ever set as text.
  const code = params.code?.toUpperCase();
  if (code !== undefined && !isRoomCode(code)) {
    connecting.remove();
    refusedCard(root, "That room link is broken. Ask your friend to send it again.", false);
    return () => {
      left = true;
      controls.destroy();
      hud.destroy();
      status.remove();
      if (mounted) arena.destroy();
    };
  }
  // A friend's room link is often someone's first visit: ask for a name once (Mini Militia style).
  const named = code && !playerName() ? askName(root) : Promise.resolve();
  void named.then(() => connect(code, params.judge === "1")).catch((e: Error) => {
    connecting.remove();
    if (e instanceof Refused) refusedCard(root, e.message);
    else status.textContent = `Could not join the paid match: ${e.message}. Your ticket stays on your account for the next one.`;
    return new Promise<never>(() => {});
  }).then((s) => {
    connecting.remove();
    if (left) return s.leave?.();
    if (seatLost) notice(root, "Your last match ended while you were away. Starting a new one.");
    src = s;
    hud.offline = s instanceof LocalMatch;
    // Offline practice must be impossible to miss: a yellow sticker instead of the grey footer.
    // Phones already show the HUD's "offline practice" tag at the top, so this one stays off them
    // and never sits on the controls; on wider screens it stops short of the dock (QA-B-21).
    if (s instanceof LocalMatch) status.className = "pop-sm pointer-events-none fixed bottom-3 left-3 z-10 max-w-[min(70vw,calc(100vw-320px))] rounded-xl bg-warn px-3 py-1.5 text-sm font-bold text-ink max-sm:hidden";
    status.textContent =
      s instanceof LocalMatch
        ? "Offline practice: real rules, local bots, nothing counts"
        : params.judge === "1"
          ? "Judge Run: a 90 s scenario on a published seed, normal money rules. Here the agents only hunt red blobs, so the lesson is your own loan: hold BOOST, go red, and Drone-1 liquidates you. Will you?"
          : "";
    // The Judge Run changes how agents behave, so it is disclosed in a card, not the grey footer.
    if (params.judge === "1" && !(s instanceof LocalMatch)) {
      // Constant text, so innerHTML is safe; "Drone-1" never splits at its hyphen.
      status.innerHTML = `Judge Run: a 90 s scenario on a published seed, normal money rules. Here the agents only hunt red blobs, so the lesson is your own loan: hold BOOST, go red, and <span class="whitespace-nowrap">Drone-1</span> liquidates you. Will you?`;
      status.className = "pop-sm pointer-events-none fixed bottom-3 left-3 z-10 max-w-[min(44rem,calc(100vw-340px))] rounded-xl bg-card px-3 py-2 text-sm font-semibold leading-snug text-ink";
    }
    if (code && !(s instanceof LocalMatch)) chip = roomChip(root, code);
    receipt = new Receipt(s.me);
    if (import.meta.env.DEV) (window as unknown as { __receipt: Receipt }).__receipt = receipt;
    if (s instanceof MatchConnection) {
      const dog = setInterval(() => {
        if (left || ended) return clearInterval(dog);
        if (performance.now() - s.lastStateAt < STALL_MS) return;
        clearInterval(dog);
        ended = true;
        s.leave(); // the server keeps the seat a while, so Retry can still take it back
        overlay?.remove();
        refusedCard(root, "Lost the connection to the match server.");
      }, 1000);
    }
    // The AI commander only plans for agents: in a room with none (two friends) it stays silent (Q03).
    s.onCommander = (r) => hud.commander(lastFrame?.blobs.some((b) => b.kind !== "human") ? r : null);
    s.onAborted = (reason) => {
      ended = true;
      overlay?.remove();
      overlay = showAborted(root, reason, () => !left && home());
    };
    s.onEvent((e) => {
      receipt?.event(e);
      director.event(e, lastFrame, performance.now() / 1000);
      juice(e, s.me);
      if ((e.type === "pop" || e.type === "eat") && e.victim === s.me && !ended) {
        const death = receipt!.outcome(lastFrame?.blobs ?? []).death!;
        died = true;
        track("match_finished");
        overlay = showDeath(root, death, (a) => {
          if (a === "again") return again();
          if (a === "share") return void shareCertificate({ ...death, matchId: s.matchId });
          overlay?.remove();
          // See receipt: the live estimate now; the bell (finish) swaps in the log-checked one.
          overlay = a === "receipt" ? results(receipt!.outcome(lastFrame?.blobs ?? [])) : null;
        });
      }
      if (e.type === "matchEnd") finish();
    });
  });

  return () => {
    left = true;
    src?.leave?.();
    engine(false);
    repayTone(false);
    controls.destroy();
    hud.destroy();
    overlay?.remove();
    status.remove();
    connecting.remove();
    small.remove();
    loanCost.remove();
    removeEventListener("resize", fit);
    if (mounted) arena.destroy();
  };
};

/** Private room: the code stays on screen with one tap to send the link to a friend. */
function roomChip(root: HTMLElement, code: string): HTMLElement {
  const b = document.createElement("button");
  // Phones: the controls fill the bottom right, so the chip moves up under the clock, left of the board.
  b.className =
    "pop-sm pop-press fixed bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-2xl bg-warn px-4 py-2 font-display text-lg text-ink max-sm:top-[66px] max-sm:bottom-auto max-sm:left-3 max-sm:translate-x-0 max-sm:px-2.5 max-sm:py-1 max-sm:text-sm";
  const num = document.createElement("span");
  num.className = "num";
  num.textContent = code;
  const label = (t: string): void => void b.replaceChildren("Room ", num, ` · ${t}`);
  label("Invite a friend");
  b.addEventListener("click", () =>
    void shareRoom(code).then((r) => label(r === "copied" ? "Link copied" : r === "shared" ? "Sent" : r === "cancelled" ? "Invite a friend" : "Copy failed")),
  );
  root.appendChild(b);
  return b;
}

/** Share from the results screen: the certificate after a liquidation, else a one-line brag + verify link. */
/** The hash-chained log for this match: local practice keeps it in memory, the server serves it. */
async function matchLog(src: unknown): Promise<LogEntry[] | null> {
  if (src instanceof LocalMatch) return src.log();
  const id = (src as { matchId?: string } | null)?.matchId;
  if (!id) return null;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${ENDPOINT}/api/matches/${encodeURIComponent(id)}/log`);
    // The room saves entries as they happen: only a log that reached MATCH_END is the whole match.
    const log = r.ok ? ((await r.json()) as { log: LogEntry[] }).log : null;
    if (log?.at(-1)?.type === "MATCH_END") return log;
    await new Promise((ok) => setTimeout(ok, 600));
  }
  return null;
}

function shareResult(o: Outcome, matchId: string, el: HTMLElement | null): void {
  if (o.death && !o.death.eaten) return void shareCertificate({ ...o.death, matchId });
  const what = o.kind === "cashed" ? `cashed out ${o.end.toFixed(2)}` : o.kind === "survived" ? `survived with ${o.end.toFixed(2)}` : "got eaten";
  // No share sheet (most laptops): the button says Post on X and opens a ready post with the verify link (F16).
  if (!("share" in navigator)) {
    const q = new URLSearchParams({ text: `I ${what} on MARGIN, rank #${o.rank} of ${o.of}. Get greedy. Get liquidated.`, url: verifyUrl(matchId) });
    return void window.open(`https://x.com/intent/post?${q}`, "_blank", "noopener");
  }
  // On a laptop Share copies the link: say so on the button, or the click looks like it did nothing.
  void shareLink(`I ${what} on MARGIN, rank #${o.rank} of ${o.of}. Get greedy. Get liquidated.`, verifyUrl(matchId)).then((r) => {
    // Only the button's text node changes, so its arrow icon stays.
    const label = [...(el?.querySelector("[data-act=share]")?.childNodes ?? [])].find((n) => n.nodeType === Node.TEXT_NODE);
    if (!label || r === "cancelled" || r === "shared") return;
    const was = label.textContent;
    label.textContent = r === "copied" ? "Link copied" : "Copy failed";
    setTimeout(() => (label.textContent = was), 2000);
  });
}

/** The server said no: say why, offer offline practice as an explicit choice, or go home. */
/** One field, one button: the name stays in this browser for every later match. Skipping = "Player N". */
function askName(root: HTMLElement): Promise<void> {
  const el = document.createElement("form");
  el.className = "fixed inset-0 z-20 grid place-items-center bg-ink/55 p-4 backdrop-blur-[3px]";
  el.innerHTML = `<div class="pop w-full max-w-sm rounded-[28px] bg-paper p-6 text-center text-ink shadow-[10px_10px_0_var(--color-ink)]">
    <h2 class="font-display text-4xl">Your name</h2>
    <p class="mt-1 text-sm font-medium text-muted">Your friends see it in the arena and on the leaderboard.</p>
    <input name=n maxlength=15 autocomplete=nickname placeholder="Player" class="pop-sm mt-4 w-full rounded-xl bg-card px-3 py-2 text-center font-display text-2xl" />
    <p data-why role="status" class="mt-2 hidden text-sm font-bold text-[#B42328]"></p>
    <button class="pop pop-press mt-5 w-full rounded-2xl bg-cobalt text-white px-5 py-3 font-display text-2xl">Join room</button></div>`;
  root.appendChild(el);
  const input = el.querySelector<HTMLInputElement>("input")!;
  input.focus();
  // Warn while typing, as on the home page, so one click on Join always joins (F05).
  const why = el.querySelector<HTMLElement>("[data-why]")!;
  input.addEventListener("input", () => {
    const problem = input.value.trim() ? nameProblem(input.value) : null;
    why.textContent = problem ?? "";
    why.classList.toggle("hidden", !problem);
  });
  return new Promise((done) =>
    el.addEventListener("submit", (e) => {
      e.preventDefault();
      setPlayerName(input.value); // keeps the cleaned name, the warning already said what changes
      el.remove();
      done();
    }),
  );
}

/** retry false: a broken link can never work, so no Retry, and offline practice leaves the link. */
function refusedCard(root: HTMLElement, why: string, retry = true): void {
  const el = document.createElement("div");
  el.className = "fixed inset-0 z-20 grid place-items-center bg-ink/55 p-4 backdrop-blur-[3px]";
  el.innerHTML = `<div class="pop max-w-sm rounded-[28px] bg-paper p-6 text-center text-ink shadow-[10px_10px_0_var(--color-ink)]">
    <h2 class="font-display text-4xl">Can't join right now</h2>
    <p data-why class="mt-2 font-medium"></p>
    <div class="mt-5 flex flex-wrap justify-center gap-3">
      <button data-retry class="pop pop-press rounded-2xl bg-cobalt text-white px-5 py-3 font-display text-xl">Retry</button>
      <button data-off class="pop pop-press rounded-2xl bg-card px-5 py-3 font-display text-xl">Practice offline</button>
      <a href="/" class="pop-sm pop-press basis-full rounded-2xl bg-card px-4 py-2 font-display text-lg">Home</a></div>
    <p class="mt-4 text-xs font-medium text-muted">Offline practice runs the real rules against local bots. Nothing counts.</p></div>`;
  el.querySelector("[data-why]")!.textContent = why;
  const again = el.querySelector<HTMLElement>("[data-retry]")!;
  if (retry) again.addEventListener("click", () => rerender());
  else {
    // Nothing to retry: practice becomes the one blue button.
    again.remove();
    el.querySelector("[data-off]")!.classList.replace("bg-card", "bg-cobalt"); el.querySelector("[data-off]")!.classList.add("text-white");
  }
  el.querySelector("[data-off]")!.addEventListener("click", () => {
    offlineOnPurpose = true;
    if (retry) rerender();
    else navigate("/play");
  });
  root.appendChild(el);
}

/** A short centred note that goes away by itself (no button: it only explains what just happened). */
function notice(root: HTMLElement, text: string): void {
  const el = document.createElement("div");
  el.className = "pointer-events-none fixed inset-x-0 top-[13%] z-20 grid place-items-center px-4";
  el.innerHTML = `<span class="pop rounded-2xl bg-warn px-5 py-3 text-center font-display text-xl text-ink"></span>`;
  el.firstElementChild!.textContent = text;
  root.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
