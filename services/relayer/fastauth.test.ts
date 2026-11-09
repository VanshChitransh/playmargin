// Email-login relay checks: real near-api-js 5 tx bytes (what the fast-auth SDK puts in fatxn).

import { KeyPair } from "near-api-js";
import { createTransaction, encodeTransaction, functionCall } from "near-api-js/lib/transaction";
import { describe, expect, it } from "vitest";
import { createError, signError, txParties } from "./fastauth.ts";

const pk = KeyPair.fromRandom("ed25519").getPublicKey();
const tx = (signer: string, receiver: string) =>
  Array.from(encodeTransaction(createTransaction(signer, pk, receiver, 7n, [functionCall("m", {}, 1n, 0n)], new Uint8Array(32))));
const guard = "jwt#https://login.testnet.fast-auth.com/";
const body = (payload: number[]) => ({ guardId: guard, verifyPayload: "a.b.c", signPayload: payload });
const ALLOWED = ["playmargin.testnet", "usdc.playmargin.testnet"];

describe("fastauth relay", () => {
  it("reads signer and receiver from borsh", () => {
    expect(txParties(Uint8Array.from(tx("bob.testnet", "playmargin.testnet")))).toEqual({
      signerId: "bob.testnet",
      receiverId: "playmargin.testnet",
    });
  });

  it("signs only txs to our contract, USDC, or the account itself", () => {
    expect(signError(body(tx("bob.testnet", "playmargin.testnet")), guard, ALLOWED)).toBeNull();
    expect(signError(body(tx("bob.testnet", "usdc.playmargin.testnet")), guard, ALLOWED)).toBeNull();
    expect(signError(body(tx("bob.testnet", "bob.testnet")), guard, ALLOWED)).toBeNull();
    expect(signError(body(tx("bob.testnet", "evil.testnet")), guard, ALLOWED)).toMatch(/not allowed/);
    expect(signError({ ...body(tx("bob.testnet", "bob.testnet")), guardId: "x" }, guard, ALLOWED)).toBe("unknown guard");
    expect(signError(body([1, 2, 3]), guard, ALLOWED)).toBe("payload is not a transaction");
  });

  it("creates only top-level names under the registrar", () => {
    const key = pk.toString();
    expect(createError({ accountId: "riya.testnet", publicKey: key }, "testnet")).toBeNull();
    expect(createError({ accountId: "a.riya.testnet", publicKey: key }, "testnet")).toBe("no sub-accounts");
    expect(createError({ accountId: "riya.near", publicKey: key }, "testnet")).toMatch(/must be/);
    expect(createError({ accountId: "riya.testnet", publicKey: "secp256k1:x" }, "testnet")).toMatch(/ed25519/);
  });
});
