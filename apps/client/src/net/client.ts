// Colyseus connection for one match: joins the "match" room, turns every 20 Hz state
// patch into a plain Frame snapshot, and exposes my private "owe" and the event stream.
// The server is the only authority: money, eats and pops are decided there. Only MY blob's
// position is predicted from my own input (predict.ts), so steering answers this frame.
import { HOME, freeRegion, joinOrder, roomRegion, serverDown, serverFor, type Region } from "./region";
import { seat, type SeatTarget } from "./seat";
import { Client, type Room } from "@colyseus/sdk";
import { R, TICK_MS, type BlobView, type GameEventMsg, type InputCmd, type JoinOpts, type MatchView, type Phase, type RateTier, type Ring } from "@margin/core";
import type { Frame } from "../game/frame";
import { SnapshotBuffer } from "./interp";
import { OwnPredictor, canBoost, motionOf, type Input } from "./predict";

/** Pause before the one retry on the same server (a blip, not a restart). */
const RETRY_SAME_MS = 1000;

const params = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
/** ?lag=300: test mode that adds a 300 ms round trip (half each way) to inputs and patches. */
const LAG_MS = Math.max(0, Number(params.get("lag")) || 0);
/** ?predict=0 turns own-blob prediction off, to compare. */
const PREDICT = params.get("predict") !== "0";

import { ENDPOINT } from "./endpoint";
export { ENDPOINT };

// Structural view of S2's MatchState schema, so the client never imports server code.
interface Each<T> {
  forEach(cb: (v: T, k: string) => void): void;
}
interface RoomState {
  mode: string;
  phase: string;
  tick: number;
  arenaW: number;
  arenaH: number;
  timeLeftS: number;
  rateTier: string;
  zoneX: number;
  zoneY: number;
  zoneR: number;
  blobs: Each<Omit<BlobView, "owe">>;
  food: Each<{ x: number; y: number; radius: number }>;
  spikes: Each<{ x: number; y: number; big: boolean; live: boolean; radius?: number }>;
  leaderboard: Each<string>;
  privateRoom?: boolean;
  host?: string;
}

export class MatchConnection {
  readonly buffer = new SnapshotBuffer();
  owe = 0;
  rateBps?: number;
  /** Client ms minus server tick ms, tracked low so jitter never moves snapshots later. */
  private offset = Infinity;
  private room?: Room;
  private listeners = new Set<(e: GameEventMsg) => void>();
  onCommander?: (rationale: string | null) => void;
  onAborted?: (reason: string) => void;
  /** performance.now() of the last server state: the play screen's stall watchdog reads it. */
  lastStateAt = 0;
  private pred = new OwnPredictor();
  private input: Input = { dirX: 0, dirY: 0, boost: false };
  private lastFrameAt = 0;
  /** Recent round trips (ms) from room.ping, plus the test lag; the median is used. */
  private rtts: number[] = [];
  private pinger = 0;

  /** Join a match (free or paid); rejects if the server is unreachable or refuses the seat. */
  async join(opts: JoinOpts, judge = false): Promise<void> {
    // Server rooms: "judge" = the seeded Judge Run, "private" = filtered by roomCode, else "match".
    const name = judge ? "judge" : opts.roomCode ? "private" : "match";
    // Paid always runs at home (the only box with a settler); a private room where its link says; free
    // play on whichever server answered fastest.
    const key: SeatTarget = judge ? "judge" : (opts.roomCode ?? "play");
    if (opts.mode === "paid" || opts.roomCode) {
      this.server = opts.mode === "paid" ? HOME : roomRegion();
      return this.wire(await new Client(this.server.url).joinOrCreate(name, opts), key);
    }
    // Free play and the Judge Run: a server that is restarting (503 for about 20 s on a deploy) or
    // unreachable gets one more try, then the other region takes the match. A refusal (credits,
    // already playing) is an answer, so it never moves servers.
    let err: unknown;
    for (const [i, region] of joinOrder(await freeRegion()).entries()) {
      if (i === 1) await new Promise((r) => setTimeout(r, RETRY_SAME_MS));
      try {
        this.server = region;
        return this.wire(await new Client(region.url).joinOrCreate(name, opts), key);
      } catch (e) {
        err = e;
        if (!serverDown(e)) throw e;
      }
    }
    throw err;
  }

  /** Private room host: start the match now (the server ignores it from anyone else). */
  startNow(): void {
    this.room?.send("startNow");
  }

  /**
   * After a reload mid-match, take the same seat back (the server holds it with
   * allowReconnection). Resolves false when there is no seat to resume on this route; a seat
   * from another route is kept (going back to it still resumes).
   */
  async resume(target: SeatTarget): Promise<boolean> {
    const token = seat.get(target);
    if (!token) return false;
    try {
      // The seat token starts with its room id, and a US room id starts with "u-".
      this.server = serverFor(token.split(":")[0]);
      this.wire(await new Client(this.server.url).reconnect(token), target);
      return true;
    } catch {
      seat.clear(); // the match is over or the hold expired: join fresh
      return false;
    }
  }

  /** Watch a live room as a spectator (S2 /api/watch): no blob, no credits, full state and events. */
  async spectate(): Promise<void> {
    const r = await fetch(`${ENDPOINT}/api/watch`);
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
    this.wire(await new Client(ENDPOINT).consumeSeatReservation(await r.json()), null);
  }

  /** at: the route this seat belongs to, null for a spectator (no seat to come back to). */
  private wire(room: Room, at: SeatTarget | null): void {
    this.room = room;
    this.lastStateAt = performance.now(); // the clock for "no state yet" starts at the seat
    if (at !== null) seat.set(room.reconnectionToken, at);
    let markedLive = false;
    this.room.onStateChange((raw) => {
      const s = raw as RoomState;
      // From GO on, a lost seat means a blob left in the arena: remember that for the resume note.
      if (at !== null && !markedLive && s.phase === "LIVE") {
        markedLive = true;
        seat.set(room.reconnectionToken, at, true);
      }
      const frame = this.toFrame(s);
      const take = (): void => {
        this.lastStateAt = performance.now();
        this.buffer.push({ at: this.stamp(s.tick), frame });
        this.reconcile(frame);
      };
      if (LAG_MS) setTimeout(take, LAG_MS / 2);
      else take();
    });
    // Round trip for reconciliation: a ping now and then (cheap, one tiny message).
    const ping = (): void => this.room?.ping((ms) => {
      this.rtts.push(ms + LAG_MS);
      if (this.rtts.length > 5) this.rtts.shift();
    });
    ping();
    this.pinger = window.setInterval(ping, 2000);
    this.room.onMessage("me", (m: { owe: number; ratePerMinBps?: number }) => {
      this.owe = m.owe;
      this.rateBps = m.ratePerMinBps;
    });
    this.room.onMessage("ev", (e: GameEventMsg) => {
      // Nothing left to come back to: the match is over, or my blob is (a resume would land a
      // "Play again" back in this match as a dead blob).
      if (e.type === "matchEnd" || ((e.type === "pop" || e.type === "eat") && e.victim === room.sessionId)) seat.clear();
      this.listeners.forEach((l) => l(e));
    });
    // The NEAR AI commander's one-line plan for the agents (S1 A6), null until the first plan.
    // Paid room cancelled before GO (open_match failed): every ticket is refunded.
    this.room.onMessage("aborted", (m: { reason?: string }) => this.onAborted?.(m.reason ?? ""));
    this.room.onMessage("commander", (m: { rationale: string | null }) => this.onCommander?.(m.rationale));
  }

  /** The server this seat is on (shown in the lobby, so the choice is honest). */
  server: Region = HOME;

  /** The server uses the room id as the match id in the log and on chain. */
  get matchId(): string {
    return this.room?.roomId ?? "";
  }

  get me(): string {
    return this.room?.sessionId ?? "";
  }

  frameAt(nowMs: number): Frame | null {
    const f = this.buffer.frameAt(nowMs);
    const dt = Math.min(0.1, (nowMs - (this.lastFrameAt || nowMs)) / 1000);
    this.lastFrameAt = nowMs;
    const live = this.buffer.latest();
    const me = live?.blobs.find((b) => b.id === live.me);
    if (!f || !me || !this.pred.ready) return f;
    // My blob moves on my input now; everyone else stays interpolated in the past.
    this.pred.step(dt, nowMs, this.input, motionOf(me, canBoost(me, live!.match.phase, this.input)), me.radius, live!.arena);
    return { ...f, blobs: f.blobs.map((b) => (b.id === me.id ? { ...b, x: this.pred.x, y: this.pred.y } : b)) };
  }

  /** Median round trip in ms (the first second before a ping answers: assume 150). */
  private rtt(): number {
    if (!this.rtts.length) return 150 + LAG_MS;
    const s = [...this.rtts].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  }

  /** A new server state: fold my true position into the prediction, or (re)start / stop it. */
  private reconcile(f: Frame): void {
    const me = f.blobs.find((b) => b.id === f.me);
    const moving = f.match.phase === "WARMUP" || f.match.phase === "LIVE";
    if (!PREDICT || !me || me.state !== "alive" || !moving) {
      this.pred.ready = false; // dead, cashed out, countdown, the bell: show the server as is
      return;
    }
    const now = performance.now();
    if (!this.pred.ready) this.pred.snap(me.x, me.y, now);
    else this.pred.reconcile(me.x, me.y, now, this.rtt(), now);
  }

  onEvent(cb: (e: GameEventMsg) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  send(cmd: InputCmd): void {
    this.input = { dirX: cmd.dirX, dirY: cmd.dirY, boost: cmd.boost };
    if (LAG_MS) setTimeout(() => this.room?.send("input", cmd), LAG_MS / 2);
    else this.room?.send("input", cmd);
  }

  leave(): void {
    // The seat token stays: after GO my blob stays in the match, so coming back resumes it.
    // Not "consented": after GO the server then holds my seat (allowReconnection) for coming back.
    // The SDK's own auto-reconnect is switched off first, or this closed tab would grab it back.
    clearInterval(this.pinger);
    if (this.room) this.room.reconnection.enabled = false;
    void this.room?.leave(false);
    this.listeners.clear();
  }

  /** Snapshot time on the client clock from the server tick, so Wi-Fi jitter does not wobble motion. */
  private stamp(tick: number): number {
    const now = performance.now();
    const serverMs = tick * TICK_MS;
    // Min-filter the offset, but let it creep up 1 ms per patch in case the path got slower.
    this.offset = Math.min(now - serverMs, this.offset + 1);
    return serverMs + this.offset;
  }

  private toFrame(s: RoomState): Frame {
    const me = this.room!.sessionId;
    const blobs: BlobView[] = [];
    s.blobs.forEach((b) =>
      blobs.push({
        id: b.id, kind: b.kind, label: b.label, x: b.x, y: b.y, radius: b.radius,
        ring: b.ring as Ring, pips: b.pips, fuel: (b as { fuel?: number }).fuel, equity: b.equity, shielded: b.shielded,
        cashingOut: b.cashingOut, state: b.state, owe: b.id === me ? this.owe : 0,
      }),
    );
    const food: Frame["food"] = [];
    // The schema sends core hitbox radii (S2 b784118); older servers sent a mass radius, so fall back.
    s.food.forEach((f, k) => food.push({ id: Number(k), x: f.x, y: f.y, r: f.radius >= R.FOOD_RADIUS_PX ? f.radius : R.FOOD_RADIUS_PX }));
    const spikes: Frame["spikes"] = [];
    s.spikes.forEach((p, k) => p.live && spikes.push({ id: Number(k), x: p.x, y: p.y, big: p.big, r: p.radius || (p.big ? R.SPIKE_RADIUS_BIG_PX : R.SPIKE_RADIUS_SMALL_PX) }));
    const leaderboard: string[] = [];
    s.leaderboard.forEach((id) => leaderboard.push(id));
    const arena = { w: s.arenaW || 2000, h: s.arenaH || 2000 };
    const match: MatchView = {
      mode: s.mode === "paid" ? "paid" : "free",
      phase: s.phase as Phase,
      tick: s.tick,
      timeLeftS: s.timeLeftS,
      rateTier: s.rateTier as RateTier,
      // No world yet (warm-up) sends r = 0: treat as "no zone" instead of tinting everything red.
      zone: { cx: s.zoneX, cy: s.zoneY, r: s.zoneR || arena.w * 2 },
      leaderboard,
    };
    const lobby = s.privateRoom ? { host: s.host === me } : undefined;
    return { me, arena, match, blobs, food, spikes, rateBps: this.rateBps, lobby };
  }
}

export { guestKey } from "./guest";
