// C5 done-when: tampering fails at that seq; three hand logs (normal, liquidation, cash-out)
// settle to hand-computed numbers; settle(log) equals the live world for 20 fuzzed matches.
import { describe, expect, it } from "vitest";
import { MICRO } from "./constants";
import type { LogEntry } from "./events";
import { appendLog, canonical, hashEntry, verifyChain } from "./log";
import { settle, settleVerified } from "./settle";
import { playMatch } from "./step.test";
import type { PendingLog } from "./types";

const u = (x: number) => Math.round(x * MICRO);
const player = (id: string) => ({ id, kind: "human" as const, label: id, accountId: `${id}.testnet` });

function open(): PendingLog[] {
  return [
    { type: "JOIN", tick: 0, data: { player: player("a") } },
    { type: "JOIN", tick: 0, data: { player: player("b") } },
    { type: "MATCH_START", tick: 1, data: { matchId: "hand", seed: 1, mode: "free", ratePerMinBps: 600 } },
    { type: "CHARGE", tick: 1, data: { blob: "a", entry: u(100) } },
    { type: "CHARGE", tick: 1, data: { blob: "b", entry: u(100) } },
  ];
}

async function chain(events: PendingLog[]): Promise<LogEntry[]> {
  const log: LogEntry[] = [];
  await appendLog(log, events);
  return log;
}

describe("hand logs", () => {
  it("normal: one BOOST, a second of interest, repaid at the bell", async () => {
    const log = await chain([
      ...open(),
      { type: "BOOST", tick: 10, data: { blob: "a", borrowed: u(40), fee: u(0.4) } },
      { type: "INTEREST", tick: 61, data: { blob: "a", amount: u(0.12), toFood: u(0.096), toVault: u(0.018), toReserve: u(0.006) } },
      { type: "REPAY", tick: 5401, data: { blob: "a", amount: u(40) } },
      { type: "CASHOUT", tick: 5401, data: { blob: "a", amount: u(120) } },
      { type: "CASHOUT", tick: 5401, data: { blob: "b", amount: u(79.576) } },
      { type: "MATCH_END", tick: 5401, data: { tick: 5401, finalMasses: { a: u(120), b: u(79.576) }, dust: 0 } },
    ]);
    expect(settle(log)).toMatchObject({
      matchId: "hand", vaultRepaid: u(40), interestToVault: u(0.018), fees: u(0.3), reserve: u(0.106),
      payouts: [{ id: "a", accountId: "a.testnet", amount: u(120) }, { id: "b", accountId: "b.testnet", amount: u(79.576) }],
      seq: 10,
    });
  });

  it("liquidation: the RULES pop, vault 120 / popper 9.6 / reserve 2.4", async () => {
    const log = await chain([
      ...open(),
      ...[10, 11, 12].map((tick): PendingLog => ({ type: "BOOST", tick, data: { blob: "a", borrowed: u(40), fee: u(0.4) } })),
      { type: "SPIKE", tick: 100, data: { blob: "a", spike: 7, damage: u(56.3) } },
      { type: "POP", tick: 130, data: { by: "b", victim: "a", debtRepaid: u(120), badDebt: 0, bounty: u(9.6), fee: u(2.4), scattered: u(10.5) } },
      { type: "CASHOUT", tick: 5401, data: { blob: "b", amount: u(196.4) } },
      { type: "MATCH_END", tick: 5401, data: { tick: 5401, finalMasses: { a: 0, b: u(196.4) }, dust: 0 } },
    ]);
    expect(settle(log)).toMatchObject({
      vaultRepaid: u(120), fees: u(0.9), reserve: u(2.7), payouts: [{ id: "b", amount: u(196.4) }],
    });
  });

  it("cash-out: leaves with equity, leftover split with 1 Micro of dust to reserve", async () => {
    const log = await chain([
      ...open(),
      { type: "BOOST", tick: 10, data: { blob: "a", borrowed: u(40), fee: u(0.4) } },
      { type: "REPAY", tick: 3000, data: { blob: "a", amount: u(40) } },
      { type: "CASHOUT", tick: 3000, data: { blob: "a", amount: u(79.6) } },
      { type: "CASHOUT", tick: 5401, data: { blob: "b", amount: u(119.999999) } },
      { type: "MATCH_END", tick: 5401, data: { tick: 5401, finalMasses: { a: u(79.6), b: u(119.999999) }, dust: 1 } },
    ]);
    expect(settle(log)).toMatchObject({ vaultRepaid: u(40), fees: u(0.3), reserve: u(0.1) + 1 });
  });
});

describe("tamper", () => {
  it("editing any entry fails verifyChain at exactly that seq", async () => {
    const { w } = playMatch(11, 4);
    const log = await chain(w.pendingLog);
    expect(await verifyChain(log)).toBeNull();
    for (const k of [0, 5, Math.floor(log.length / 2), log.length - 1]) {
      const copy = log.map((e) => ({ ...e, data: structuredClone(e.data) })) as LogEntry[];
      (copy[k] as { tick: number }).tick += 1;
      expect(await verifyChain(copy)).toBe(k);
    }
  });

  it("a rehashed but unbalanced log is refused by settle", async () => {
    const log = await chain([
      ...open(),
      { type: "CASHOUT", tick: 5401, data: { blob: "a", amount: u(101) } },
      { type: "CASHOUT", tick: 5401, data: { blob: "b", amount: u(99) } },
      { type: "MATCH_END", tick: 5401, data: { tick: 5401, finalMasses: { a: u(101), b: u(99) }, dust: 0 } },
    ]);
    expect(settle(log).payouts).toHaveLength(2);
    const forged = await chain(log.map(({ seq: _s, prevHash: _p, hash: _h, ...e }) => e as PendingLog).map((e) =>
      e.type === "CASHOUT" && e.data.blob === "a" ? { ...e, data: { ...e.data, amount: u(102) } } : e,
    ));
    expect(await verifyChain(forged)).toBeNull(); // a self-consistent forgery...
    expect(() => settle(forged)).toThrow(); // ...still cannot make the books balance
    expect(await hashEntry(log[0] as LogEntry)).toBe(log[0]?.hash);
  });
});

describe("settle(log) == live world", () => {
  it("for 20 fuzzed matches", async () => {
    for (let seed = 100; seed < 120; seed++) {
      const { w } = playMatch(seed, 6 + (seed % 5));
      const log = await chain(w.pendingLog);
      const r = settle(log);
      expect(r.lent).toBe(w.vault.lent);
      expect(r.vaultRepaid).toBe(w.vault.repaid);
      expect(r.interestToVault).toBe(w.vault.interest);
      expect(r.fees).toBe(w.fees);
      expect(r.reserve).toBe(w.reserve);
      for (const b of w.blobs.values()) {
        expect(r.payouts.find((p) => p.id === b.id)?.amount ?? 0).toBe(b.payout);
      }
    }
  }, 30_000);
});

describe("forgeries a live room cannot produce (money-auditor C5)", () => {
  const end = (fm: Record<string, number>, dust = 0): PendingLog => ({ type: "MATCH_END", tick: 5401, data: { tick: 5401, finalMasses: fm, dust } });
  const cash = (blob: string, amount: number, tick = 5401): PendingLog => ({ type: "CASHOUT", tick, data: { blob, amount } });
  const bad: Array<[string, PendingLog[]]> = [
    ["borrow and walk away", [{ type: "BOOST", tick: 10, data: { blob: "a", borrowed: u(150), fee: u(1.5) } }, cash("a", u(248.5)), cash("b", u(100)), end({ a: u(248.5), b: u(100) })]],
    ["negative repay", [{ type: "REPAY", tick: 10, data: { blob: "a", amount: -u(50) } }, cash("a", u(150)), cash("b", u(100)), end({ a: u(150), b: u(100) })]],
    ["payout to a blob that never joined", [cash("zz", u(1)), cash("a", u(99)), cash("b", u(100)), end({ zz: u(1), a: u(99), b: u(100) })]],
    ["second JOIN hijacks an account", [{ type: "JOIN", tick: 2, data: { player: { ...player("a"), accountId: "mallory.near" } } }, cash("a", u(100)), cash("b", u(100)), end({ a: u(100), b: u(100) })]],
    ["second MATCH_START", [{ type: "MATCH_START", tick: 2, data: { matchId: "other", seed: 1, mode: "free", ratePerMinBps: 600 } }, cash("a", u(100)), cash("b", u(100)), end({ a: u(100), b: u(100) })]],
    ["zero borrow fee", [{ type: "BOOST", tick: 10, data: { blob: "a", borrowed: u(40), fee: 0 } }, { type: "REPAY", tick: 11, data: { blob: "a", amount: u(40) } }, cash("a", u(100)), cash("b", u(100)), end({ a: u(100), b: u(100) })]],
    ["interest split skimmed", [
      { type: "BOOST", tick: 10, data: { blob: "a", borrowed: u(40), fee: u(0.4) } },
      { type: "INTEREST", tick: 61, data: { blob: "a", amount: u(1), toFood: u(1), toVault: 0, toReserve: 0 } },
      { type: "REPAY", tick: 5401, data: { blob: "a", amount: u(40) } },
      cash("a", u(99.6)), cash("b", u(100)), end({ a: u(99.6), b: u(100) })]],
    ["cash-out after being popped, before the bell", [
      { type: "BOOST", tick: 10, data: { blob: "a", borrowed: u(40), fee: u(0.4) } },
      { type: "POP", tick: 100, data: { by: "b", victim: "a", debtRepaid: u(40), badDebt: 0, bounty: u(3.2), fee: u(0.8) } as never },
      cash("a", u(10), 200), cash("b", u(149.6)), end({ a: u(10), b: u(149.6) })]],
    ["non-integer charge", [{ type: "CHARGE", tick: 1, data: { blob: "a", entry: 0.5 } }, cash("a", u(100)), cash("b", u(100)), end({ a: u(100), b: u(100) })]],
  ];
  for (const [name, tail] of bad) {
    it(`refuses: ${name}`, async () => {
      const events = name === "non-integer charge" ? [...open().slice(0, 4), ...tail] : [...open(), ...tail];
      await expect(chain(events).then(settle)).rejects.toThrow();
    });
  }

  it("settleVerified refuses a broken chain even when the books balance", async () => {
    const log = await chain([...open(), cash("a", u(100)), cash("b", u(100)), end({ a: u(100), b: u(100) })]);
    await expect(settleVerified(log)).resolves.toMatchObject({ seq: 7 });
    (log[3] as LogEntry & { tick: number }).tick = 9;
    await expect(settleVerified(log)).rejects.toThrow(/seq 3/);
  });

  it("canonical refuses numbers another language would print differently", () => {
    expect(canonical({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(() => canonical({ x: 2 ** 53 + 2 })).toThrow();
    expect(() => canonical({ x: 0.5 })).toThrow();
    expect(() => canonical([1, undefined])).toThrow();
  });
});
