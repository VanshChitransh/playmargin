// The Brain hook for the room (S2): one brain per agent blob, asked for an InputCmd every tick
// before core.step. Brains throttle themselves and emit each tap for exactly one tick.
import type { Blob, Brain } from "@margin/core";
import { FreeBot } from "./freebot";

export { agentView, VIEW_R } from "./view";
export { FreeBot, type Personality } from "./freebot";

/** Stable 32-bit hash so a blob id plus the match seed always makes the same bot. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Brain for an agent blob, or null for humans (and drones until A2). */
export function createBrain(blob: Blob, matchSeed: number): Brain | null {
  const seed = (matchSeed ^ hashId(blob.id)) >>> 0;
  if (blob.kind === "agent") return new FreeBot(seed);
  return null;
}
