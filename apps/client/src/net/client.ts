// Colyseus connection for one match: joins the "match" room, turns every 20 Hz state
// patch into a plain Frame snapshot, and exposes my private "owe" and the event stream.
// The server is the only authority; this file never computes game state.
import { Client, type Room } from "@colyseus/sdk";
import type { BlobView, GameEventMsg, InputCmd, MatchView, Phase, RateTier, Ring } from "@margin/core";
import type { Frame } from "../game/frame";
import { SnapshotBuffer } from "./interp";

const ENDPOINT = import.meta.env.VITE_SERVER_URL ?? `${location.protocol}//${location.hostname}:2567`;
// ponytail: arena size is not in the room state yet (ICR posted); matches the server stub.
const ARENA = { w: 2000, h: 2000 };

// Structural view of S2's MatchState schema, so the client never imports server code.
interface Each<T> {
  forEach(cb: (v: T, k: string) => void): void;
}
interface RoomState {
  mode: string;
  phase: string;
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
  private room?: Room;
  private listeners = new Set<(e: GameEventMsg) => void>();

  /** Join a free match; rejects if the server is unreachable. */
  async join(guestKey: string, roomCode?: string): Promise<void> {
    this.room = await new Client(ENDPOINT).joinOrCreate("match", { mode: "free", guestKey, roomCode });
    this.room.onStateChange((s) => this.buffer.push({ at: performance.now(), frame: this.toFrame(s as RoomState) }));
    this.room.onMessage("me", (m: { owe: number }) => (this.owe = m.owe));
    this.room.onMessage("ev", (e: GameEventMsg) => this.listeners.forEach((l) => l(e)));
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
    const match: MatchView = {
      mode: s.mode === "paid" ? "paid" : "free",
      phase: s.phase as Phase,
      tick: 0,
      timeLeftS: s.timeLeftS,
      rateTier: s.rateTier as RateTier,
      // No world yet (warm-up) sends r = 0: treat as "no zone" instead of tinting everything red.
      zone: { cx: s.zoneX, cy: s.zoneY, r: s.zoneR || ARENA.w * 2 },
      leaderboard,
    };
    return { me, arena: ARENA, match, blobs, food, spikes };
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
