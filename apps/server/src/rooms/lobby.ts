// Matchmaking rules. The warm-up IS the lobby window: Colyseus joinOrCreate keeps putting
// players into the same unlocked room, filtered by mode and private room code, so no
// separate LobbyRoom is needed. Pure functions here, so the rules are testable without sockets.
import { R, botNames, sToTicks, type Mode, type PlayerSeed } from "@margin/core";

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

/** A private lobby nobody starts closes after this (nobody is charged before GO). */
export const PRIVATE_WAIT_S = 600;

/**
 * When warm-up ends. Free: after WARMUP_S, agents fill the rest. Paid: humans only, needs
 * PAID_MIN_HUMANS; waits up to PAID_WAIT_S for more unless someone taps start-now or the
 * room is full; closes with nobody charged if it never reaches the minimum.
 */
export function warmupNext(s: { mode: Mode; private?: boolean; humans: number; phaseTick: number; startNow: boolean }): WarmupNext {
  // Private (PUBG custom room): no timer, the host starts once a friend is in, or it starts when full.
  if (s.private) {
    if (s.humans >= R.ROOM_SIZE || (s.startNow && s.humans >= R.PAID_MIN_HUMANS)) return "countdown";
    return s.phaseTick < sToTicks(PRIVATE_WAIT_S) ? "wait" : "close";
  }
  if (s.mode === "free") return s.phaseTick >= sToTicks(R.WARMUP_S) ? "countdown" : "wait";
  const enough = s.humans >= R.PAID_MIN_HUMANS;
  if (enough && (s.humans >= R.ROOM_SIZE || (s.startNow && s.phaseTick >= sToTicks(R.WARMUP_S)))) return "countdown";
  if (s.phaseTick < sToTicks(R.PAID_WAIT_S)) return "wait";
  return enough ? "countdown" : "close";
}

/** Labelled agents that fill a free room up to ROOM_SIZE (never hidden: kind and the robot glyph say so).
 *  Names come from core BOT_NAMES with the room seed, so the client hero and practice use the same list. */
export function agentFill(humans: number, seed: number): PlayerSeed[] {
  const names = botNames(seed, Math.max(0, R.ROOM_SIZE - humans));
  return names.map((name, i) => ({
    id: `agent-${i + 1}`,
    kind: "agent" as const,
    label: `${name} \u{1F916}`,
    accountId: null,
  }));
}

/** Paid rooms: unstaked liquidator drones, DRONES_PER_ROOM = min(3, ceil(humans / 3)), labelled. */
export function droneFill(humans: number): PlayerSeed[] {
  return Array.from({ length: Math.min(3, Math.ceil(humans / 3)) }, (_, i) => ({
    id: `drone-${i + 1}`,
    kind: "drone" as const,
    label: `Drone-${i + 1} (liquidator)`,
    accountId: null,
  }));
}
