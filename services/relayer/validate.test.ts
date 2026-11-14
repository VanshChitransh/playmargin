// Allow-list cases from DEVELOPMENT.md N5: only a zero-deposit, gas-bounded enter_arena to our
// contract signed with ed25519 gets through.

import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { DELEGATE_ACTION_PREFIX, decodeSignedDelegateAction, encodeSignedDelegateAction, type SignedDelegateAction } from "near-kit";
import { describe, expect, it } from "vitest";
import { KeyedCap, RateLimit, WindowCap, delegateKey, entryRefusal, keyRefusal, refuseReason, signatureOk, type KeyView, type Policy } from "./validate.ts";

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

  it("verifies the NEP-366 signature locally, so forged delegates are never paid for", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const raw = Array.from(Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url"));
    const unsigned = { signedDelegate: sd({ key: { ed25519Key: { data: raw } }, sig: { ed25519Signature: { data: Array(64).fill(0) } } }) };
    // Sign exactly what NEAR signs: sha256(u32 LE prefix || borsh(DelegateAction)).
    const bytes = Buffer.from(encodeSignedDelegateAction(unsigned as unknown as SignedDelegateAction, "bytes"));
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32LE(DELEGATE_ACTION_PREFIX);
    const sig = sign(null, createHash("sha256").update(Buffer.concat([prefix, bytes.subarray(0, bytes.length - 65)])).digest(), privateKey);
    const good = { signedDelegate: { ...unsigned.signedDelegate, signature: { ed25519Signature: { data: Array.from(sig) } } } };
    const payload = encodeSignedDelegateAction(good as unknown as SignedDelegateAction);
    const decoded = decodeSignedDelegateAction(payload).signedDelegate as unknown as Parameters<typeof signatureOk>[1];
    expect(signatureOk(payload, decoded)).toBe(true);
    expect(delegateKey(decoded)).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(signatureOk(encodeSignedDelegateAction(unsigned as unknown as SignedDelegateAction), decoded)).toBe(false); // zero signature
    const swapped = { signedDelegate: { ...good.signedDelegate, delegateAction: { ...good.signedDelegate.delegateAction, senderId: "victim.testnet" } } };
    expect(signatureOk(encodeSignedDelegateAction(swapped as unknown as SignedDelegateAction), decoded)).toBe(false); // sender swapped
    // RT L3-02: junk embedded signature + a valid signature appended after it. The decoder ignores
    // the tail, so the chain would see the junk one: refuse anything that is not exactly the encoding.
    const junk = Buffer.from(encodeSignedDelegateAction(unsigned as unknown as SignedDelegateAction, "bytes"));
    const tail = sign(null, createHash("sha256").update(Buffer.concat([prefix, junk])).digest(), privateKey);
    const forged = Buffer.concat([junk, Buffer.from([0]), tail]).toString("base64");
    const forgedSd = decodeSignedDelegateAction(forged).signedDelegate as unknown as Parameters<typeof signatureOk>[1];
    expect(signatureOk(forged, forgedSd)).toBe(false);
    expect(signatureOk(Buffer.concat([Buffer.from(payload, "base64"), Buffer.from([1])]).toString("base64"), decoded)).toBe(false); // any trailing byte
  });

  it("needs a live, unexpired, scoped key with a fresh nonce", () => {
    const scoped: KeyView = { nonce: 0, permission: { FunctionCall: { receiver_id: "playmargin.testnet", method_names: ["enter_arena"] } } };
    const ok = (k: KeyView | null, height = 50n) => keyRefusal(sd(), k, height, "playmargin.testnet", "enter_arena");
    expect(ok(scoped)).toBeNull();
    expect(ok({ nonce: 0, permission: "FullAccess" })).toBeNull();
    expect(ok(null)).toMatch(/unknown key/);
    expect(ok(scoped, 100n)).toMatch(/expired/);
    expect(ok({ ...scoped, nonce: 1 })).toMatch(/nonce/);
    const far = sd();
    (far.delegateAction as { nonce: bigint }).nonce = 50_000_001n; // above height 50 x 1e6
    expect(keyRefusal(far, scoped, 50n, "playmargin.testnet", "enter_arena")).toMatch(/too large/);
    expect(ok({ nonce: 0, permission: { FunctionCall: { receiver_id: "evil.testnet", method_names: [] } } })).toMatch(/scoped/);
    expect(ok({ nonce: 0, permission: { FunctionCall: { receiver_id: "playmargin.testnet", method_names: ["withdraw"] } } })).toMatch(/method/);
  });

  it("caps paid relays per window and prunes the limiter", () => {
    const cap = new WindowCap(2, 60_000);
    expect([cap.take(0), cap.take(1), cap.take(2)]).toEqual([true, true, false]);
    expect(cap.hitAt).toBe(2);
    expect(cap.take(60_000)).toBe(true);
    const rl = new RateLimit(1_000);
    for (let i = 0; i < 10_002; i++) rl.allow(`spoof-${i}`, 0);
    expect(rl.allow("late", 5_000)).toBe(true);
    expect((rl as unknown as { last: Map<string, number> }).last.size).toBeLessThan(100);
  });

  it("never pays for an enter_arena the contract would refuse (RT L3-01)", () => {
    const args = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
    const stake = "1000000";
    expect(entryRefusal(args({ stake }), stake, "1000000", null)).toBeNull();
    expect(entryRefusal(args({ stake: "100000" }), stake, "5000000", null)).toMatch(/entry stake/); // wrong stake
    expect(entryRefusal(args({ stake: 1000000 }), stake, "5000000", null)).toMatch(/entry stake/); // U128 is a string
    expect(entryRefusal(args({ stake }), stake, "999999", null)).toMatch(/balance/); // cannot cover it
    expect(entryRefusal(args({ stake }), stake, "5000000", { stake, match_id: null })).toMatch(/ticket/); // one ticket each
    expect(entryRefusal(new TextEncoder().encode("not json"), stake, "5000000", null)).toMatch(/JSON/);
    expect(entryRefusal(args(null), stake, "5000000", null)).toMatch(/JSON/);
    expect(entryRefusal(args({ stake: "undefined" }), "undefined", "0", null)).toMatch(/cannot read/); // config unread
  });

  it("caps each sender and each IP per day, apart from the others (RT L3-01)", () => {
    const day = 86_400_000;
    const cap = new KeyedCap(2, day);
    expect([cap.take("ip-a", 0), cap.take("ip-a", 1), cap.take("ip-a", 2)]).toEqual([true, true, false]);
    expect(cap.take("ip-b", 3)).toBe(true); // a flood from one IP leaves everyone else alone
    expect(cap.take("ip-a", day)).toBe(true); // next UTC day
  });
});
