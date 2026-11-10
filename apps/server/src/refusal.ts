// Expected refusals (room full, bad room code, too many joins, a frame too big) are normal traffic,
// not bugs: they log ONE structured warn line (reason, hashed ip, room), identical lines folded for a
// while, and never a stack trace. QA-A-07: before this, 75% of the log was Colyseus stacks for them,
// burying real alarms like settle_revert. Real errors keep their full stacks.
import { createHash, randomBytes } from "node:crypto";
import { ErrorCode, ServerError } from "colyseus";
import { log } from "./obs";

/** Per process, so hashes group one attacker within a run but never identify a player. */
const SALT = randomBytes(16).toString("hex");
const FOLD_MS = 10_000;
const seen = new Map<string, { at: number; folded: number }>();

export const ipHash = (ip: string | undefined): string | null => (ip ? createHash("sha256").update(SALT + ip).digest("hex").slice(0, 12) : null);

/** Log a refusal, at most once per FOLD_MS per (reason, ip); the next line reports how many were folded. */
export function logRefusal(reason: string, f: { ip?: string; room?: string } = {}, now = Date.now()): boolean {
  const ip = ipHash(f.ip);
  const key = `${reason}|${ip}`;
  const s = seen.get(key);
  if (s && now - s.at < FOLD_MS) return void s.folded++, false;
  if (seen.size > 5_000) for (const [k, v] of seen) if (now - v.at >= FOLD_MS) seen.delete(k);
  log.warn("refused", { reason, ip, room: f.room ?? null, folded: s?.folded ?? 0 });
  seen.set(key, { at: now, folded: 0 });
  return true;
}

/** Log and throw a refusal the client sees exactly as before, minus the server-side stack. */
export function refuse(reason: string, f: { ip?: string; room?: string } = {}): never {
  logRefusal(reason, f);
  // ServerError: Colyseus prints no stack for it (debugAndPrintError), and 523 is the code a plain
  // Error already produced, so clients see the same status and message.
  throw new ServerError(ErrorCode.MATCHMAKE_UNHANDLED, reason);
}

/**
 * A plain Error thrown on a join path is one of OUR deliberate refusals (every guard throws a bare
 * Error with a message for the player). Subclasses (TypeError, NetworkError...) are real faults.
 */
export const isRefusal = (e: unknown): e is Error => e instanceof Error && e.constructor === Error;

const FRAME_TOO_BIG = /Max payload size exceeded/;

/** Colyseus logger: the ws "frame too big" stack becomes a refusal line, everything else unchanged. */
export const quietLogger = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  trace: console.trace.bind(console),
  warn: console.warn.bind(console),
  error: (...args: unknown[]) => {
    if (typeof args[0] === "string" && FRAME_TOO_BIG.test(args[0])) return void logRefusal("frame too large");
    console.error(...args);
  },
};
