// The Brain hook for the room (S2): one brain per agent blob, asked for an InputCmd every tick
// before core.step. Brains throttle themselves and emit each tap for exactly one tick.
import { JUDGE_SEED, type Blob, type Brain } from "@margin/core";
import { Drone } from "./drone";
import { FreeBot } from "./freebot";

export { agentView, VIEW_R } from "./view";
export { FreeBot, type Personality } from "./freebot";
export { Drone } from "./drone";
export { applyPlan, Commander, COMMANDER_MODELS, nearAiCall, parsePlan, roomSummary, type AgentOrder, type Plan } from "./commander";

/** Stable 32-bit hash so a blob id plus the match seed always makes the same bot. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Brain for an agent or drone blob, or null for humans. */
export function createBrain(blob: Blob, matchSeed: number): Brain | null {
  const seed = (matchSeed ^ hashId(blob.id)) >>> 0;
  // The Judge Run room always plays the published JUDGE_SEED: its agents spare the judge (QA-B-07).
  if (blob.kind === "agent") return new FreeBot(seed, matchSeed === JUDGE_SEED ? { spareHumans: true } : undefined);
  if (blob.kind === "drone") return new Drone(seed);
  return null;
}
