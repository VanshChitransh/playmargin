// Trust boundary for client input. Anything malformed is dropped (never thrown), and each
// client gets at most INPUT_MAX_PER_S commands per second so a flood can't speed anyone up.
import { R, sToTicks, type InputCmd } from "@margin/core";

export const INPUT_MAX_PER_S = 30;

/** The command if every field is the right type and |dir| <= 1, else null. */
export function parseInput(msg: unknown): InputCmd | null {
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  const { seq, dirX, dirY, boost, repay, cashout } = m;
  if (!Number.isSafeInteger(seq)) return null;
  if (typeof dirX !== "number" || typeof dirY !== "number") return null;
  if (!Number.isFinite(dirX) || !Number.isFinite(dirY) || Math.hypot(dirX, dirY) > 1.0001) return null;
  if (typeof boost !== "boolean" || typeof repay !== "boolean" || typeof cashout !== "boolean") return null;
  return { seq: seq as number, dirX, dirY, boost, repay, cashout };
}

/** Fixed one-second window counter; returns false once the client is over the limit. */
export class RateLimit {
  private windowStart = 0;
  private count = 0;

  allow(nowMs: number): boolean {
    if (nowMs - this.windowStart >= 1000) {
      this.windowStart = nowMs;
      this.count = 0;
    }
    return ++this.count <= INPUT_MAX_PER_S;
  }
}

const INPUT_EXPIRE_TICKS = sToTicks(R.INPUT_EXPIRE_MS / 1000);

interface Pending {
  cmd: InputCmd;
  at: number;
  boost: boolean;
  repay: boolean;
  cashout: boolean;
}

/** Latest command per connected player, rate-limited, turned into one InputCmd per tick. */
export class InputQueue {
  private pending = new Map<string, Pending>();
  private limits = new Map<string, RateLimit>();

  open(id: string): void {
    this.limits.set(id, new RateLimit());
  }

  /** Forget the player's input (zeroes their direction) and stop accepting more. */
  close(id: string): void {
    this.limits.delete(id);
    this.pending.delete(id);
  }

  push(id: string, msg: unknown, nowMs: number, tick: number): void {
    if (!this.limits.get(id)?.allow(nowMs)) return;
    const cmd = parseInput(msg);
    if (!cmd) return;
    const prev = this.pending.get(id);
    // Taps are edge-triggered: OR them until a tick consumes them, so none is lost between ticks.
    this.pending.set(id, {
      cmd,
      at: tick,
      boost: cmd.boost || (prev?.boost ?? false),
      repay: cmd.repay || (prev?.repay ?? false),
      cashout: cmd.cashout || (prev?.cashout ?? false),
    });
  }

  /** This tick's commands: direction expires after INPUT_EXPIRE_MS, taps fire once. */
  take(tick: number): Map<string, InputCmd> {
    const out = new Map<string, InputCmd>();
    for (const [id, p] of this.pending) {
      const fresh = tick - p.at <= INPUT_EXPIRE_TICKS;
      out.set(id, {
        seq: p.cmd.seq,
        dirX: fresh ? p.cmd.dirX : 0,
        dirY: fresh ? p.cmd.dirY : 0,
        boost: p.boost,
        repay: p.repay,
        cashout: p.cashout,
      });
      p.boost = p.repay = p.cashout = false;
    }
    return out;
  }
}
