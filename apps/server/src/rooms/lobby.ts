// Matchmaking rules. The warm-up IS the lobby window: Colyseus joinOrCreate keeps putting
// players into the same unlocked room, filtered by mode and private room code, so no
// separate LobbyRoom is needed. Pure functions here, so the rules are testable without sockets.
import { R, sToTicks, type Mode, type PlayerSeed } from "@margin/core";

export interface RoomKey {
  mode: Mode;
  /** 4 capital letters for a private room; null = public matchmaking. */
  roomCode: string | null;
}

/** Validate join/create options; anything unknown falls back to a public free room. */
export function parseRoomKey(opts: unknown): RoomKey {
  const o = (typeof opts === "object" && opts !== null ? opts : {}) as Record<string, unknown>;
  const mode: Mode = o.mode === "paid" ? "paid" : "free";
  const code = typeof o.roomCode === "string" && /^[A-Z]{4}$/.test(o.roomCode) ? o.roomCode : null;
  return { mode, roomCode: code };
}

export type WarmupNext = "wait" | "countdown" | "close";

/**
 * When warm-up ends. Free: after WARMUP_S, agents fill the rest. Paid: humans only, needs
 * PAID_MIN_HUMANS; waits up to PAID_WAIT_S for more unless someone taps start-now or the
 * room is full; closes with nobody charged if it never reaches the minimum.
 */
export function warmupNext(s: { mode: Mode; humans: number; phaseTick: number; startNow: boolean }): WarmupNext {
  if (s.mode === "free") return s.phaseTick >= sToTicks(R.WARMUP_S) ? "countdown" : "wait";
  const enough = s.humans >= R.PAID_MIN_HUMANS;
  if (enough && (s.humans >= R.ROOM_SIZE || (s.startNow && s.phaseTick >= sToTicks(R.WARMUP_S)))) return "countdown";
  if (s.phaseTick < sToTicks(R.PAID_WAIT_S)) return "wait";
  return enough ? "countdown" : "close";
}

/** Labelled agents that fill a free room up to ROOM_SIZE (never hidden: kind and label say so). */
export function agentFill(humans: number): PlayerSeed[] {
  return Array.from({ length: Math.max(0, R.ROOM_SIZE - humans) }, (_, i) => ({
    id: `agent-${i + 1}`,
    kind: "agent" as const,
    label: `Agent-${i + 1} \u{1F916}`,
    accountId: null,
  }));
}
