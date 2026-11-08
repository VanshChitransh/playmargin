// Hash-chained match log. Each entry's hash covers its content and the previous hash, so
// editing any entry breaks every hash after it. SHA-256 via crypto.subtle: one code path for
// Node 24 and the browser Verify page.
import { GENESIS_HASH, type LogEntry } from "./events";
import type { PendingLog, World } from "./types";

/** JSON with object keys sorted at every level, so the same data always hashes the same. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") {
    // Log numbers are Micro, bps, ticks and seeds: safe integers only, so a Rust or browser
    // re-hash prints exactly the same digits (no 1e+21, no silent 2^53 rounding).
    if (typeof v === "number" && !Number.isSafeInteger(v)) throw new Error(`cannot hash number ${v}`);
    if (v === undefined || typeof v === "function" || typeof v === "bigint") throw new Error(`cannot hash ${typeof v}`);
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

/** Lowercase hex SHA-256 of a UTF-8 string. */
export async function sha256Hex(s: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The hash an entry must carry, from everything in it except the hash itself. */
export function hashEntry(e: Omit<LogEntry, "hash">): Promise<string> {
  return sha256Hex(canonical({ seq: e.seq, tick: e.tick, type: e.type, data: e.data, prevHash: e.prevHash }));
}

/** Chain pending engine events onto the log in place; returns the new entries. */
export async function appendLog(log: LogEntry[], pending: PendingLog[]): Promise<LogEntry[]> {
  const added: LogEntry[] = [];
  for (const p of pending) {
    const last = log.at(-1);
    const base = { ...p, seq: last ? last.seq + 1 : 0, prevHash: last ? last.hash : GENESIS_HASH } as Omit<LogEntry, "hash">;
    const entry = { ...base, hash: await hashEntry(base) } as LogEntry;
    log.push(entry);
    added.push(entry);
  }
  return added;
}

/** Move the world's pending events into the log (the server calls this once per tick). */
export function drainLog(w: World, log: LogEntry[]): Promise<LogEntry[]> {
  return appendLog(log, w.pendingLog.splice(0));
}

/** First seq whose link or hash is wrong, or null if the whole chain is intact. */
export async function verifyChain(log: LogEntry[]): Promise<number | null> {
  let prev = GENESIS_HASH;
  for (let i = 0; i < log.length; i++) {
    const e = log[i] as LogEntry;
    if (e.seq !== i || e.prevHash !== prev || e.hash !== (await hashEntry(e))) return i;
    prev = e.hash;
  }
  return null;
}
