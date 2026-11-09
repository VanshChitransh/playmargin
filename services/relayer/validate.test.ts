// Allow-list cases from DEVELOPMENT.md N5: only a zero-deposit, gas-bounded enter_arena to our
// contract signed with ed25519 gets through.

import { describe, expect, it } from "vitest";
import { RateLimit, refuseReason, type Policy } from "./validate.ts";

const policy: Policy = { contractId: "playmargin.testnet", methods: ["enter_arena"], maxGas: 30_000_000_000_000n };

type Action = Record<string, unknown>;

function sd(over: { receiverId?: string; actions?: Action[]; key?: object; sig?: object } = {}) {
  const enter = { functionCall: { methodName: "enter_arena", args: new Uint8Array(), gas: 30_000_000_000_000n, deposit: 0n } };
  return {
    delegateAction: {
      senderId: "player1.playmargin.testnet",
      receiverId: over.receiverId ?? "playmargin.testnet",
      actions: over.actions ?? [enter],
      nonce: 1n,
      maxBlockHeight: 100n,
      publicKey: over.key ?? { ed25519Key: { data: [] } },
    },
    signature: over.sig ?? { ed25519Signature: { data: [] } },
  } as unknown as Parameters<typeof refuseReason>[0];
}

const call = (methodName: string, gas = 30_000_000_000_000n, deposit = 0n) => ({
  functionCall: { methodName, args: new Uint8Array(), gas, deposit },
});

describe("relayer allow-list", () => {
  it("accepts a plain enter_arena", () => {
    expect(refuseReason(sd(), policy)).toBeNull();
  });

  it("refuses other receivers, transfers, other methods, deposits, gas, batches and non-ed25519", () => {
    expect(refuseReason(sd({ receiverId: "usdc.playmargin.testnet" }), policy)).toMatch(/receiver/);
    expect(refuseReason(sd({ actions: [{ transfer: { deposit: 1n } }] }), policy)).toMatch(/function calls/);
    expect(refuseReason(sd({ actions: [call("withdraw")] }), policy)).toMatch(/not allowed/);
    expect(refuseReason(sd({ actions: [call("enter_arena", 30_000_000_000_000n, 1n)] }), policy)).toMatch(/deposit/);
    expect(refuseReason(sd({ actions: [call("enter_arena", 300_000_000_000_000n)] }), policy)).toMatch(/gas/);
    expect(refuseReason(sd({ actions: [call("enter_arena"), call("enter_arena")] }), policy)).toMatch(/one action/);
    expect(refuseReason(sd({ key: { secp256k1Key: { data: [] } } }), policy)).toMatch(/ed25519/);
  });

  it("rate-limits per sender", () => {
    const rl = new RateLimit(2_000);
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("a", 1_000)).toBe(false);
    expect(rl.allow("b", 1_000)).toBe(true);
    expect(rl.allow("a", 2_000)).toBe(true);
  });
});
