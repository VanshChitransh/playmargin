// Every head's proof must rebuild the anchored root, for 1 to 9 leaves (odd levels carry up).
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./log";
import { merkle, rootFromProof } from "./merkle";

describe("merkle", () => {
  it("each proof rebuilds the root, and a wrong head does not", async () => {
    for (let n = 1; n <= 9; n++) {
      const heads = await Promise.all(Array.from({ length: n }, (_, i) => sha256Hex(`head-${n}-${i}`)));
      const { root, proofs } = await merkle(heads);
      for (const h of heads) expect(await rootFromProof(h, proofs.get(h)!)).toBe(root);
      if (n > 1) expect(await rootFromProof(heads[1]!, proofs.get(heads[0]!)!)).not.toBe(root);
    }
  });
});
