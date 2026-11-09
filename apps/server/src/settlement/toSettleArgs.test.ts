// The contract rejects any settle that does not conserve value to the base unit, so this
// conversion must be exact for every split the engine can produce.
import type { SettleResult } from "@margin/core";
import { describe, expect, it } from "vitest";
import { MICRO_PER_BASE, toSettleArgs } from "./toSettleArgs";

const STAKE = 100 * 1_000_000; // 1 USDC entry in Micro

/** A random but conserving result: pot + lent split into payouts, vault, fees and reserve. */
function randomResult(seed: number): SettleResult {
  let s = seed;
  const rnd = (n: number) => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s % n;
  };
  const players = 2 + rnd(11);
  const pot = players * STAKE;
  const lent = rnd(pot + 1);
  const vaultRepaid = rnd(lent + 1);
  const interestToVault = rnd(5_000_000);
  const fees = rnd(3_000_000);
  let left = pot + lent - vaultRepaid - interestToVault - fees;
  const payouts = Array.from({ length: players }, (_, i) => {
    const amount = i === players - 1 ? 0 : rnd(Math.floor(left / 2) + 1);
    left -= amount;
    return { id: `b${i}`, accountId: i === 0 ? null : `p${i}.testnet`, amount };
  });
  return { matchId: "m", payouts, lent, vaultRepaid, interestToVault, fees, reserve: left, head: "h", seq: 9 };
}

describe("toSettleArgs", () => {
  it("conserves exactly in base units for 2,000 random matches", () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const r = randomResult(seed);
      const a = toSettleArgs(r);
      const stakes = BigInt((r.payouts.length * STAKE) / MICRO_PER_BASE);
      const out =
        a.payouts.reduce((x, [, v]) => x + BigInt(v), 0n) +
        BigInt(a.vault_repaid) + BigInt(a.interest_to_vault) + BigInt(a.fees) + BigInt(a.reserve);
      expect(out).toBe(stakes + BigInt(a.lent));
      expect(BigInt(a.reserve) >= 0n).toBe(true);
      expect(BigInt(a.vault_repaid) <= BigInt(a.lent)).toBe(true);
      expect(a.payouts.some(([acc]) => !acc)).toBe(false);
      // chain rule: bad debt <= 10% of the 1.5x stakes budget
      expect((BigInt(a.lent) - BigInt(a.vault_repaid)) * 10_000n <= stakes * 15_000n / 10_000n * 1_000n).toBe(true);
    }
  });

  it("repays bad debt above the chain cap from the biggest payout", () => {
    // 2 players, budget 3 USDC, cap 0.3 USDC; 1 USDC of bad debt, so 0.7 comes out of the winner.
    const r: SettleResult = {
      matchId: "m", lent: 150 * 1_000_000, vaultRepaid: 50 * 1_000_000, interestToVault: 0, fees: 0, reserve: 0, head: "h", seq: 1,
      payouts: [{ id: "a", accountId: "a.testnet", amount: 250 * 1_000_000 }, { id: "b", accountId: "b.testnet", amount: 50 * 1_000_000 }],
    };
    const a = toSettleArgs(r);
    expect(a.vault_repaid).toBe("1200000");
    expect(a.payouts).toEqual([["a.testnet", "1800000"], ["b.testnet", "500000"]]);
    expect(a.reserve).toBe("0");
  });

  it("refuses stakes that are not whole base units", () => {
    expect(() => toSettleArgs({ ...randomResult(3), reserve: randomResult(3).reserve + 1 })).toThrow(/base units/);
  });
});
