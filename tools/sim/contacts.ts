// `npx tsx tools/sim/contacts.ts [matches]`: do players meet? Free 12-agent rooms (the full lobby).
// Reports new blob-to-blob contacts per minute (edges touching, drones excluded), when the first
// contact of the match happens, when the average player first touches anyone, liquidations per
// match, and the closest any GO spawn lands to an arena edge. One JSON line (tools/sim/sweep.ts).
import { R, radius } from "@margin/core";
import { runMatch } from "./match";

const n = Number(process.argv[2] ?? 40);
const firstMatch: number[] = [];
const firstPlayer: number[] = [];
let contacts = 0, liqs = 0, minEdge = Infinity;
for (let m = 1; m <= n; m++) {
  const touching = new Set<string>();
  const met = new Map<string, number>();
  let first = R.MATCH_S;
  const { log } = await runMatch({
    seed: 500 + m, mode: "free", players: 12, drones: 0,
    onTick: (w, tick) => {
      if (w.phase !== "LIVE") return;
      const t = (tick - w.goTick) / R.TICK_HZ;
      if (tick === w.goTick) for (const b of w.blobs.values()) minEdge = Math.min(minEdge, b.x, b.y, w.arena.w - b.x, w.arena.h - b.y);
      const alive = [...w.blobs.values()].filter((b) => b.state === "alive" && b.kind !== "drone");
      for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i]!, b = alive[j]!, key = a.id + b.id;
        if (Math.hypot(a.x - b.x, a.y - b.y) >= radius(a.mass) + radius(b.mass)) { touching.delete(key); continue; }
        if (touching.has(key)) continue;
        touching.add(key);
        contacts++;
        first = Math.min(first, t);
        for (const id of [a.id, b.id]) if (!met.has(id)) met.set(id, t);
      }
    },
  });
  liqs += log.filter((e) => e.type === "POP" || e.type === "KEEPER_POP").length;
  firstMatch.push(first);
  for (let i = 0; i < 12; i++) firstPlayer.push([...met.values()][i] ?? R.MATCH_S);
}
const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
console.log(JSON.stringify({
  matches: n, contactsPerMin: +(contacts / (n * R.MATCH_S / 60)).toFixed(1), liqPerMatch: +(liqs / n).toFixed(2),
  medianFirstContactS: +med(firstMatch).toFixed(1), medianPlayerFirstContactS: +med(firstPlayer).toFixed(1), minSpawnEdgePx: Math.round(minEdge),
}));
