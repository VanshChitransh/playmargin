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

describe("anchorPending against the chain (QA-D-01)", () => {
  const setup = async () => {
    const db = openDb(":memory:");
    createMatch(db, { id: "c1", mode: "free", seed: 1, pot: 1 });
    finishMatch(db, "c1", { status: "settled", head: await sha256Hex("c1") });
    db.prepare("UPDATE matches SET ended = ? WHERE id = 'c1'").run(498 * HOUR_MS + 5);
    await anchorPending(db, null, 500 * HOUR_MS);
    const { root } = db.prepare("SELECT root FROM anchors WHERE hour = 498").get() as { root: string };
    return { db, root };
  };
  const fakeChain = (onchain: { seq: number; head: string } | null) => {
    const calls: unknown[] = [];
    const chain = { view: async () => onchain, call: async (_m: string, args: unknown) => (calls.push(args), "tx-new") };
    return { chain: chain as unknown as Parameters<typeof anchorPending>[1], calls };
  };
  const txOf = (db: ReturnType<typeof openDb>) => (db.prepare("SELECT tx_hash FROM anchors WHERE hour = 498").get() as { tx_hash: string | null }).tx_hash;

  it("marks an hour done only when the chain holds OUR root for it", async () => {
    const { db, root } = await setup();
    const { chain, calls } = fakeChain({ seq: 498, head: root });
    await anchorPending(db, chain, 500 * HOUR_MS);
    expect(txOf(db)).toBe("onchain");
    expect(calls).toHaveLength(0);
  });
  it("never marks done when the chain holds a different root, and does not overwrite it", async () => {
    const { db } = await setup();
    const { chain, calls } = fakeChain({ seq: 498, head: "f".repeat(64) });
    await anchorPending(db, chain, 500 * HOUR_MS);
    expect(txOf(db)).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it("sends the anchor when the chain is behind", async () => {
    const { db, root } = await setup();
    const { chain, calls } = fakeChain({ seq: 497, head: "x" });
    await anchorPending(db, chain, 500 * HOUR_MS);
    expect(calls).toEqual([{ room_id: "free", seq: 498, head: root }]);
    expect(txOf(db)).toBe("tx-new");
  });
});
