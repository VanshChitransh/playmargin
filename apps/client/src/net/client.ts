// Colyseus connection for one match: joins the "match" room, turns every 20 Hz state
// patch into a plain Frame snapshot, and exposes my private "owe" and the event stream.
// The server is the only authority; this file never computes game state.
import { Client, type Room } from "@colyseus/sdk";
import { TICK_MS, type BlobView, type GameEventMsg, type InputCmd, type JoinOpts, type MatchView, type Phase, type RateTier, type Ring } from "@margin/core";
import type { Frame } from "../game/frame";
import { SnapshotBuffer } from "./interp";

export const ENDPOINT = import.meta.env.VITE_SERVER_URL ?? `${location.protocol}//${location.hostname}:2567`;

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
  spikes: Each<{ x: number; y: number; big: boolean; live: boolean }>;
  leaderboard: Each<string>;
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

  /** Join a match (free or paid); rejects if the server is unreachable or refuses the seat. */
  async join(opts: JoinOpts): Promise<void> {
    this.room = await new Client(ENDPOINT).joinOrCreate("match", opts);
    this.room.onStateChange((raw) => {
      const s = raw as RoomState;
      this.buffer.push({ at: this.stamp(s.tick), frame: this.toFrame(s) });
    });
    this.room.onMessage("me", (m: { owe: number; ratePerMinBps?: number }) => {
      this.owe = m.owe;
      this.rateBps = m.ratePerMinBps;
    });
    this.room.onMessage("ev", (e: GameEventMsg) => this.listeners.forEach((l) => l(e)));
    // The NEAR AI commander's one-line plan for the agents (S1 A6), null until the first plan.
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
    void this.room?.leave();
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
        ring: b.ring as Ring, pips: b.pips, equity: b.equity, shielded: b.shielded,
        cashingOut: b.cashingOut, state: b.state, owe: b.id === me ? this.owe : 0,
      }),
    );
    const food: Frame["food"] = [];
    s.food.forEach((f, k) => food.push({ id: Number(k), x: f.x, y: f.y, r: f.radius }));
    const spikes: Frame["spikes"] = [];
    s.spikes.forEach((p, k) => p.live && spikes.push({ id: Number(k), x: p.x, y: p.y, big: p.big }));
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
    return { me, arena, match, blobs, food, spikes, rateBps: this.rateBps };
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
