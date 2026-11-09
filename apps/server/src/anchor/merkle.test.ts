// Every leaf's proof must lead back to the root, for any count (odd counts carry up).
import { sha256Hex } from "@margin/core";
import { describe, expect, it } from "vitest";
import { merkle, rootFromProof } from "./merkle";

describe("merkle", () => {
  it("proves every leaf for 1 to 9 leaves", async () => {
    for (let n = 1; n <= 9; n++) {
      const heads = await Promise.all(Array.from({ length: n }, (_, i) => sha256Hex(`match-${i}`)));
      const { root, proofs } = await merkle(heads);
      for (const h of heads) expect(await rootFromProof(h, proofs.get(h)!)).toBe(root);
    }
  });

  it("is order independent and catches a wrong leaf", async () => {
    const heads = await Promise.all(["a", "b", "c"].map((x) => sha256Hex(x)));
    const one = await merkle(heads);
    const two = await merkle([...heads].reverse());
    expect(two.root).toBe(one.root);
    expect(await rootFromProof(await sha256Hex("evil"), one.proofs.get(heads[0]!)!)).not.toBe(one.root);
  });
});
