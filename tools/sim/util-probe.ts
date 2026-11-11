// How full does a match's vault budget get? Per free match: total borrowed / budget, and the peak
// outstanding loan / budget. Decides which utilisation the rate curve should read.
import { runMatch } from "./match";
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)]!;
const tot: number[] = [], peak: number[] = [];
for (let m = 1; m <= 60; m++) {
  let pk = 0;
  const { w } = await runMatch({ seed: 4000 + m, mode: "free", players: 12, humans: 0, drones: 0, onTick: (w) => { pk = Math.max(pk, w.vault.lent - w.vault.repaid); } });
  tot.push(w.vault.lent / w.vault.budget);
  peak.push(pk / w.vault.budget);
}
const f = (xs: number[]) => `p10 ${q(xs, 0.1).toFixed(3)} median ${q(xs, 0.5).toFixed(3)} p90 ${q(xs, 0.9).toFixed(3)} max ${Math.max(...xs).toFixed(3)}`;
console.log(JSON.stringify({ matches: 60, totalBorrowedOverBudget: f(tot), peakOutstandingOverBudget: f(peak) }));
