// `npm run commander`: one free match (1 bot-driven human + 11 agents) with the A6 commander on
// NEAR AI Cloud. Prints each plan as it lands. Needs NEAR_AI_API_KEY (root .env).
import { R } from "@margin/core";
import { Commander, nearAiCall } from "../../apps/server/src/agents/index";
import { runMatch } from "./match";

const key = process.env.NEAR_AI_API_KEY;
if (!key) {
  console.error("npm run commander needs a NEAR AI Cloud key: put NEAR_AI_API_KEY=... in .env (see .env.example). Everything else runs without keys.");
  process.exit(1);
}
const c = new Commander(nearAiCall(key));
let last: unknown = null;
let plans = 0;
const t0 = performance.now();
await runMatch({
  seed: 11, mode: "free", players: 12, humans: 1, drones: 1,
  onTick: async (w, tick, _e, _l, brains) => {
    c.update(w, tick, brains);
    if (c.plan !== last) {
      last = c.plan;
      plans++;
      const t = ((tick - w.goTick) / R.TICK_HZ).toFixed(1);
      console.log(`t=${t}s  ${c.plan?.rationale}  (${c.plan?.agents.length} orders)`);
    }
    // Real time, so the async calls land mid-match as they would in a room.
    await new Promise((r) => setTimeout(r, 1000 / R.TICK_HZ));
  },
});
console.log(`${plans} plans in one 90 s match, ${((performance.now() - t0) / 1000).toFixed(0)} s wall`);
