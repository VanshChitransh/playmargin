// The disk-full incident (S3 QA): SQLITE_FULL made settle throw "cannot rollback - no transaction is
// active" and the match record was lost or refused. A file DB capped with PRAGMA max_page_count is a
// real SQLITE_FULL: these tests fill it, check nothing throws into the room and nothing is dropped,
// then give the space back and check every record lands exactly once.
import { MATCH_TICKS, newWorld, startMatch, step } from "@margin/core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb, withTx, type Db } from "./db";
import { createMatch, saveEvents } from "./matches";
import { MatchRecord } from "./rooms/matchRecord";
import { CreditsSettlement } from "./settlement/credits";
import { userForGuestKey } from "./db";

const fileDb = (): Db => openDb(join(mkdtempSync(join(tmpdir(), "margin-full-")), "t.sqlite"));
const pages = (db: Db) => (db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count;
const fill = (db: Db) => void db.exec(`PRAGMA max_page_count = ${pages(db) + 1}`); // the disk is full
const free = (db: Db) => void db.exec("PRAGMA max_page_count = 1000000"); // space is back
const big = (seq: number) => ({ seq, tick: 1, type: "X", data: { pad: "x".repeat(4000) }, prevHash: "p", hash: `h${seq}` }) as never;

describe("withTx on a full disk", () => {
  it("surfaces the REAL error (not 'cannot rollback'), leaves no transaction, and the next write works", () => {
    const db = fileDb();
    createMatch(db, { id: "m", mode: "free", seed: 1, pot: 1 });
    fill(db);
    expect(() => saveEvents(db, "m", Array.from({ length: 40 }, (_, i) => big(i)))).toThrow(/full/i);
    expect((db as unknown as { isTransaction: boolean }).isTransaction).toBe(false);
    free(db);
    saveEvents(db, "m", [big(0)]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM events").get()).toEqual({ n: 1 });
  });

  it("still rolls back a normal failure inside the transaction", () => {
    const db = fileDb();
    expect(() =>
      withTx(db, () => {
        createMatch(db, { id: "a", mode: "free", seed: 1, pot: 1 });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(db.prepare("SELECT COUNT(*) AS n FROM matches").get()).toEqual({ n: 0 });
  });
});

describe("credit payouts are all or nothing", () => {
  it("a write failing halfway pays nobody (not half), and the retry pays everyone exactly once", async () => {
    const db = fileDb();
    const users = new Map(Array.from({ length: 6 }, (_, i) => [`b${i}`, userForGuestKey(db, `3f2b8c1e-5d4a-4f7b-9c2e-1a6d8e0f4b7${i}`)] as const));
    const s = new CreditsSettlement(db, users);
    const result = { matchId: "m", payouts: [...users.keys()].map((id) => ({ id, accountId: null, amount: 1_000_000 })) } as never;
    // The 4th payout insert fails after 3 have gone in: without the transaction 3 players would be paid.
    db.exec(`CREATE TEMP TRIGGER fail_4th BEFORE INSERT ON credits_ledger WHEN NEW.user_id = '${users.get("b3")}'
             BEGIN SELECT RAISE(FAIL, 'database or disk is full'); END`);
    await expect(s.settle(result, "h")).rejects.toThrow(/full/i);
    expect(db.prepare("SELECT COUNT(*) AS n FROM credits_ledger WHERE reason = 'payout'").get()).toEqual({ n: 0 });
    db.exec("DROP TRIGGER fail_4th");
    await s.settle(result, "h");
    await s.settle(result, "h"); // idempotent
    expect(db.prepare("SELECT COUNT(*) AS n FROM credits_ledger WHERE reason = 'payout'").get()).toEqual({ n: 6 });
  });
});

describe("MatchRecord on a full disk", () => {
  it("settle never throws, never refuses a valid match, and every record lands once space is back", async () => {
    const db = fileDb();
    const user = userForGuestKey(db, "3f2b8c1e-5d4a-4f7b-9c2e-1a6d8e0f4b7c");
    const users = new Map([["p1", user]]);
    const rec = new MatchRecord(db, "full1", "free", new CreditsSettlement(db, users), () => 5);
    const w = newWorld(7, "free", [{ id: "p1", kind: "human", label: "p", accountId: null }], "full1");
    startMatch(w, 0);
    rec.open(w, 7, users);
    fill(db); // the disk fills mid match
    for (let t = 1; t <= MATCH_TICKS + 1 && w.phase !== "ENDED"; t++) {
      step(w, new Map([["p1", { seq: t, dirX: 1, dirY: 0, boost: false, repay: false, cashout: false }]]), t);
      rec.drain(w);
      if (t % 300 === 0) rec.flushIfIdle();
    }
    const result = await rec.settle(w); // must resolve, not throw
    expect(result).not.toBeNull();
    const status = () => (db.prepare("SELECT status FROM matches WHERE id = 'full1'").get() as { status: string } | undefined)?.status;
    expect(status()).not.toBe("refused");
    free(db);
    await rec.whenWritten();
    expect(status()).toBe("settled");
    const n = (db.prepare("SELECT COUNT(*) AS n FROM events WHERE match_id = 'full1'").get() as { n: number }).n;
    expect(n).toBe(rec.entries.length); // the whole log, nothing dropped
    expect(db.prepare("SELECT COUNT(*) AS n FROM match_players WHERE match_id = 'full1'").get()).toEqual({ n: 1 });
  }, 60_000);
});
