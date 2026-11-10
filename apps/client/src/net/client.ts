// Colyseus connection for one match: joins the "match" room, turns every 20 Hz state
// patch into a plain Frame snapshot, and exposes my private "owe" and the event stream.
// The server is the only authority; this file never computes game state.
import { seat, type SeatTarget } from "./seat";
import { Client, type Room } from "@colyseus/sdk";
import { R, TICK_MS, type BlobView, type GameEventMsg, type InputCmd, type JoinOpts, type MatchView, type Phase, type RateTier, type Ring } from "@margin/core";
import type { Frame } from "../game/frame";
import { SnapshotBuffer } from "./interp";

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

  /** Join a match (free or paid); rejects if the server is unreachable or refuses the seat. */
  async join(opts: JoinOpts, judge = false): Promise<void> {
    // Server rooms: "judge" = the seeded Judge Run, "private" = filtered by roomCode, else "match".
    const name = judge ? "judge" : opts.roomCode ? "private" : "match";
    this.wire(await new Client(ENDPOINT).joinOrCreate(name, opts), judge ? "judge" : (opts.roomCode ?? "play"));
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
      this.wire(await new Client(ENDPOINT).reconnect(token), target);
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
      this.lastStateAt = performance.now();
      this.buffer.push({ at: this.stamp(s.tick), frame: this.toFrame(s) });
    });
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

  /** The server uses the room id as the match id in the log and on chain. */
  get matchId(): string {
    return this.room?.roomId ?? "";
  }

  get me(): string {
    return this.room?.sessionId ?? "";
  }

  frameAt(nowMs: number): Frame | null {
    return this.buffer.frameAt(nowMs);
  }

  onEvent(cb: (e: GameEventMsg) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  send(cmd: InputCmd): void {
    this.room?.send("input", cmd);
  }

  leave(): void {
    // The seat token stays: after GO my blob stays in the match, so coming back resumes it.
    // Not "consented": after GO the server then holds my seat (allowReconnection) for coming back.
    // The SDK's own auto-reconnect is switched off first, or this closed tab would grab it back.
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

/** Stable per-browser guest key; storage can be blocked (private mode), so fall back to memory. */
export function guestKey(): string {
  try {
    const k = localStorage.getItem("margin.guest") ?? crypto.randomUUID();
    localStorage.setItem("margin.guest", k);
    return k;
  } catch {
    return crypto.randomUUID();
  }
}
