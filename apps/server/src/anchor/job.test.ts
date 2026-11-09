// Roots per finished hour, proofs stored per match, the current hour left alone.
import { rootFromProof, sha256Hex, type ProofStep } from "@margin/core";
import { describe, expect, it } from "vitest";
import { openDb } from "../db";
import { createMatch, finishMatch } from "../matches";
import { HOUR_MS, anchorPending } from "./job";

describe("anchorPending", () => {
  it("anchors finished hours only and every proof leads to its root", async () => {
    const db = openDb(":memory:");
    const now = 500 * HOUR_MS + 1000;
    const ends = [498 * HOUR_MS + 5, 499 * HOUR_MS + 1, 499 * HOUR_MS + 9, 500 * HOUR_MS + 2];
    for (const [i, ended] of ends.entries()) {
      createMatch(db, { id: `m${i}`, mode: "free", seed: i, pot: 1 });
      finishMatch(db, `m${i}`, { status: "settled", head: await sha256Hex(`h${i}`) });
      db.prepare("UPDATE matches SET ended = ? WHERE id = ?").run(ended, `m${i}`);
    }
    expect(await anchorPending(db, null, now)).toBe(0);
    const anchors = db.prepare("SELECT hour, root FROM anchors ORDER BY hour").all() as Array<{ hour: number; root: string }>;
    expect(anchors.map((a) => a.hour)).toEqual([498, 499]);
    const rows = db.prepare("SELECT head, anchor_hour, proof FROM matches WHERE proof IS NOT NULL").all() as Array<{ head: string; anchor_hour: number; proof: string }>;
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      const root = anchors.find((a) => a.hour === r.anchor_hour)!.root;
      expect(await rootFromProof(r.head, JSON.parse(r.proof) as ProofStep[])).toBe(root);
    }
    await anchorPending(db, null, now); // idempotent
    expect(db.prepare("SELECT COUNT(*) AS n FROM anchors").get()).toEqual({ n: 2 });
  });
});
