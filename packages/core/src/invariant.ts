// Conservation: no Micro is ever created or destroyed. Every bucket a unit can sit in, on
// the left; every source of units (entries and vault loans), on the right. Exact integers.
import type { World } from "./types";

/** Open debt minus what the vault still has out; 0 when every loan is accounted for. */
export function debtGap(w: World): number {
  let open = 0;
  for (const b of w.blobs.values()) open += b.debt;
  return open - (w.vault.lent - w.vault.repaid - w.vault.badDebt);
}

/** Micro held minus Micro that entered the room; 0 when conserved. */
export function leakOf(w: World): number {
  let held = w.cashedOut + w.vault.repaid + w.vault.interest + w.fees + w.reserve;
  for (const b of w.blobs.values()) {
    if (!Number.isSafeInteger(b.mass) || b.mass < 0) throw new Error(`bad mass on ${b.id}: ${b.mass}`);
    held += b.mass;
  }
  for (const f of w.food) {
    if (!Number.isSafeInteger(f.mass) || f.mass <= 0) throw new Error(`bad food ${f.id}: ${f.mass}`);
    held += f.mass;
  }
  return held - (w.pot + w.vault.lent);
}

/** Throws if any Micro was created or destroyed, or the vault lent past its budget. */
export function checkInvariant(w: World): void {
  if (w.phase === "WARMUP" || w.phase === "COUNTDOWN") return; // nothing charged yet
  const leak = leakOf(w);
  if (leak !== 0) throw new Error(`conservation broken at tick ${w.tick}: ${leak} Micro`);
  const gap = debtGap(w);
  if (gap !== 0) throw new Error(`debt unaccounted at tick ${w.tick}: ${gap} Micro`);
  if (w.vault.lent - w.vault.repaid > w.vault.budget) throw new Error("vault lent past budget");
}
