// RPC fallback: an unreachable provider moves to the next one, anything else is final, so a
// contract panic is not retried and a sent tx is never sent twice.
import { FunctionCallError, NetworkError, type Near } from "near-kit";
import { describe, expect, it } from "vitest";
import { accessKey, firstCall, nearClients, rpcUrls, withFallback, type TxView } from "./rpc";

const fake = (n: number) => ({ id: n }) as unknown as Near;
const id = (near: Near) => (near as unknown as { id: number }).id;

describe("rpc fallback", () => {
  it("puts env RPCs first, then FastNEAR, then NEAR's own, per network, without duplicates", () => {
    expect(rpcUrls("testnet")).toEqual(["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"]);
    expect(rpcUrls("mainnet", " https://keyed.example , https://rpc.mainnet.near.org")).toEqual([
      "https://keyed.example",
      "https://rpc.mainnet.near.org",
      "https://rpc.mainnet.fastnear.com",
    ]);
    expect(nearClients("testnet")).toHaveLength(2);
  });

  it("moves on only when an RPC is unreachable", async () => {
    const calls: number[] = [];
    const out = await withFallback([fake(1), fake(2)], async (n) => {
      calls.push(id(n));
      if (id(n) === 1) throw new NetworkError("Network request failed: fetch failed");
      return "ok";
    });
    expect([out, calls]).toEqual(["ok", [1, 2]]);
  });

  it("never retries a contract panic, and throws the last error when every RPC is down", async () => {
    const calls: number[] = [];
    const panic = withFallback([fake(1), fake(2)], async (n) => {
      calls.push(id(n));
      throw new FunctionCallError("playmargin.testnet", "settle", "stake must equal the entry stake");
    });
    await expect(panic).rejects.toBeInstanceOf(FunctionCallError);
    expect(calls).toEqual([1]);
    const down = withFallback([fake(1), fake(2)], async (n) => {
      throw new NetworkError(`down ${id(n)}`);
    });
    await expect(down).rejects.toThrow("down 2");
  });
});

describe("accessKey", () => {
  const withRpc = (getAccessKey: () => Promise<unknown>) => ({ rpc: { getAccessKey } }) as unknown as Near;

  it("is null for a missing key but throws when the RPC is down, so the next RPC is tried", async () => {
    expect(await accessKey(withRpc(async () => Promise.reject(new Error("UNKNOWN_ACCESS_KEY"))), "a.testnet", "ed25519:x")).toBeNull();
    await expect(accessKey(withRpc(async () => Promise.reject(new NetworkError("fetch failed"))), "a.testnet", "ed25519:x")).rejects.toBeInstanceOf(NetworkError);
    expect(await accessKey(withRpc(async () => ({ nonce: 1 })), "a.testnet", "ed25519:x")).toEqual({ nonce: 1 });
  });
});

describe("firstCall (Verify reads the anchor or settle tx itself)", () => {
  const tx = (status: unknown, actions: TxView["transaction"]["actions"]): TxView => ({
    transaction: { actions },
    transaction_outcome: { block_hash: "h" },
    receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }, { outcome: { status } }],
  });
  const anchor = { FunctionCall: { method_name: "anchor", args: btoa('{"room_id":"free","seq":498416,"head":"f971"}') } };

  it("decodes the first function call and its JSON args", () => {
    expect(firstCall(tx({ SuccessValue: "" }, ["CreateAccount", anchor]))).toEqual({ method: "anchor", args: { room_id: "free", seq: 498416, head: "f971" }, status: "ok" });
  });

  it("is failed when any receipt failed, and refuses a tx with no function call", () => {
    expect(firstCall(tx({ Failure: { ActionError: {} } }, [anchor])).status).toBe("failed");
    expect(() => firstCall(tx({ SuccessValue: "" }, ["Transfer"]))).toThrow(/not a function call/);
  });
});
