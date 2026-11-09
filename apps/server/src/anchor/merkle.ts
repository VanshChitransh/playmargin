// Merkle tree over match heads for the hourly anchor. Leaves are the heads (hex) sorted, every
// node is sha256Hex(left + right) of the two hex strings, and an unpaired node is carried up
// unchanged (no duplication). Simple enough that the Verify page can recompute it in the browser.
import { sha256Hex } from "@margin/core";

export interface ProofStep {
  hash: string;
  /** True when this sibling sits on the left. */
  left: boolean;
}

/** Root and one proof per leaf (keyed by head). Throws on an empty set. */
export async function merkle(heads: string[]): Promise<{ root: string; proofs: Map<string, ProofStep[]> }> {
  if (heads.length === 0) throw new Error("merkle: no leaves");
  const leaves = [...new Set(heads)].sort();
  const proofs = new Map(leaves.map((h) => [h, [] as ProofStep[]]));
  // members[i] = leaves under node i of the current level, so each level extends their proofs.
  let level = leaves.map((h) => ({ hash: h, members: [h] }));
  while (level.length > 1) {
    const next: typeof level = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]!;
      const b = level[i + 1];
      if (!b) {
        next.push(a);
        continue;
      }
      for (const m of a.members) proofs.get(m)!.push({ hash: b.hash, left: false });
      for (const m of b.members) proofs.get(m)!.push({ hash: a.hash, left: true });
      next.push({ hash: await sha256Hex(a.hash + b.hash), members: [...a.members, ...b.members] });
    }
    level = next;
  }
  return { root: level[0]!.hash, proofs };
}

/** Recompute the root from a head and its proof (what the Verify page does). */
export async function rootFromProof(head: string, proof: ProofStep[]): Promise<string> {
  let h = head;
  for (const s of proof) h = await sha256Hex(s.left ? s.hash + h : h + s.hash);
  return h;
}
