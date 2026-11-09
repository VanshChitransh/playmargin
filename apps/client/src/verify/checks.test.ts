import { describe, expect, it } from "vitest";
import { hashEntry, type LogEntry } from "@margin/core";
import { LocalMatch } from "../game/local";
import { runChecks } from "./checks";

async function playedLog(): Promise<LogEntry[]> {
  const m = new LocalMatch({ seed: 11, withMe: true, bots: 5, warmupS: 0 });
  for (let t = 0; t < 95_000; t += 50) {
    m.send({ seq: t, dirX: 1, dirY: 0, boost: t === 6_000, repay: false, cashout: false });
    m.frameAt(t);
  }
  return m.log();
}

describe("runChecks", () => {
  it("passes an untouched match log end to end", async () => {
    const log = await playedLog();
    const r = await runChecks(log, null);
    expect(r.chain.state).toBe("ok");
    expect(r.books.state).toBe("ok");
    expect(r.anchor.state).toBe("skip");
    expect(r.result!.payouts.length).toBeGreaterThan(0);
    expect((await runChecks(log, r.result!.head)).anchor.state).toBe("ok");
  });

  it("flags the exact seq of a tampered entry", async () => {
    const log = await playedLog();
    const i = log.findIndex((e) => e.type === "BOOST");
    expect(i).toBeGreaterThan(0);
    const t = structuredClone(log);
    const e = t[i] as Extract<LogEntry, { type: "BOOST" }>;
    e.data.borrowed += 1_000_000; // a cheater edits one number
    const r = await runChecks(t, null);
    expect(r.chain).toMatchObject({ state: "bad", seq: i });
    expect(r.books.state).toBe("bad");
  });

  it("catches a re-hashed forgery through the books or the anchor", async () => {
    const log = await playedLog();
    const head = (await runChecks(log, null)).result!.head;
    // Forger edits a payout-relevant number and re-hashes the whole chain so links hold.
    const t = structuredClone(log);
    const i = t.findIndex((e) => e.type === "CHARGE");
    (t[i] as Extract<LogEntry, { type: "CHARGE" }>).data.entry += 1;
    for (let k = i; k < t.length; k++) {
      if (k > 0) t[k]!.prevHash = t[k - 1]!.hash;
      t[k]!.hash = await hashEntry(t[k]!);
    }
    const r = await runChecks(t, head);
    expect(r.chain.state).toBe("ok");
    expect(r.books.state === "bad" || r.anchor.state === "bad").toBe(true);
  });
});
