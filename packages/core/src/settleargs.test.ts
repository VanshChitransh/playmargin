// toSettleArgs must satisfy the contract's exact check (arena.rs settle) for real paid matches.
import { describe, expect, it } from "vitest";
import type { LogEntry } from "./events";
import { appendLog } from "./log";
import type { InputCmd } from "./protocol";
import { rand, seedRng } from "./rng";
import { settle } from "./settle";
import { microPerBase, toSettleArgs } from "./settleargs";
import { step } from "./step";
import type { PlayerSeed } from "./types";
import { newWorld, startMatch } from "./world";

async function paidMatch(seed: number, stakeBase: number) {
  const players: PlayerSeed[] = Array.from({ length: 4 }, (_, i) => ({
    id: `p${i}`, kind: i < 3 ? "human" : "drone", label: `P${i}`, accountId: `p${i}.testnet`,
  }));
  const w = newWorld(seed, "paid", players, `m${seed}`, stakeBase);
  startMatch(w, 1);
  const r = { rngState: seedRng(seed) };
  for (let t = 2; w.phase !== "ENDED"; t++) {
    const inputs = new Map<string, InputCmd>();
    for (const id of w.blobs.keys()) {
      const a = rand(r) * Math.PI * 2;
      inputs.set(id, { seq: t, dirX: Math.cos(a), dirY: Math.sin(a), boost: rand(r) < 0.05, repay: rand(r) < 0.03, cashout: rand(r) < 0.01 });
    }
    step(w, inputs, t);
  }
  const log: LogEntry[] = [];
  await appendLog(log, w.pendingLog);
  return { w, result: settle(log) };
}

describe("toSettleArgs", () => {
  // 1 USDC (the default) and 0.10 USDC (deploy-day rehearsal): the game is identical, only the rate differs.
  it.each([[1_000_000], [100_000]])("passes the contract's checks (arena.rs settle) on 10 paid matches at stake %i", async (stakeBase) => {
    let revolving = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { w, result } = await paidMatch(seed, stakeBase);
      expect(result.stakeBase).toBe(stakeBase);
      const a = toSettleArgs(result);
      const stakes = 3n * BigInt(stakeBase);
      const budget = (stakes * 15_000n) / 10_000n;
      const out = a.payouts.reduce((s, [, v]) => s + BigInt(v), 0n) + BigInt(a.vault_repaid) + BigInt(a.interest_to_vault) + BigInt(a.fees) + BigInt(a.reserve);
      expect(out).toBe(stakes + BigInt(a.lent));
      // The budget revolves (repay then BOOST again), so total lent may pass it; bad debt never can.
      expect(BigInt(a.lent) - BigInt(a.vault_repaid) <= budget).toBe(true);
      if (BigInt(a.lent) > budget) revolving++;
      expect(BigInt(a.vault_repaid) <= BigInt(a.lent)).toBe(true);
      expect(a.payouts.every(([acct]) => acct.endsWith(".testnet"))).toBe(true);
      expect(w.vault.budget).toBe(Number(budget) * microPerBase(stakeBase));
    }
    // At least one real match lends more than its budget in total: the contract must allow it.
    expect(revolving).toBeGreaterThan(0);
  });

  it("refuses a stake that does not divide one entry exactly", () => {
    expect(() => microPerBase(300_001)).toThrow(/bad stake/);
    expect(microPerBase(100_000)).toBe(1000);
    expect(microPerBase(1_000_000)).toBe(100);
  });

  it("refuses a payout with no account", () => {
    expect(() =>
      toSettleArgs({ matchId: "m", payouts: [{ id: "g", accountId: null, amount: 100_000_000 }], lent: 0, vaultRepaid: 0, interestToVault: 0, reserve: 0, fees: 0, head: "h", seq: 1 }),
    ).toThrow(/no NEAR account/);
  });
});
