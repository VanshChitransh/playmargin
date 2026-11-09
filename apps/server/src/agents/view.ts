// What an agent may see: its own blob plus what is near it, like a human's screen. Bots never
// read the whole world, so a labelled agent has no information edge over the humans it plays.
import { radius, type AgentView, type World } from "@margin/core";

/** Half a human screen width at the agar-style camera (start blob ~5.5% of ~2,100 px), plus own radius. */
export const VIEW_R = 1050;

/** The AgentView for blob `id`, or null if it is not alive. */
export function agentView(w: World, id: string): AgentView | null {
  const self = w.blobs.get(id);
  if (!self || self.state !== "alive") return null;
  const r = VIEW_R + radius(self.mass);
  const near = (p: { x: number; y: number }): boolean => Math.abs(p.x - self.x) < r && Math.abs(p.y - self.y) < r;
  return {
    self,
    others: [...w.blobs.values()].filter((b) => b !== self && b.state === "alive" && near(b)),
    food: w.food.filter(near),
    spikes: w.spikes.filter((s) => s.respawnAt === null && near(s)),
    zone: w.zone,
    phase: w.phase,
  };
}
