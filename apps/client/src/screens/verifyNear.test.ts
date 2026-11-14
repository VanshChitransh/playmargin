// QA-C-02: the anchor check reads NEAR and trusts nothing the server says.
import { merkle, sha256Hex } from "@margin/core";
import { describe, expect, it } from "vitest";
import { anchorOnNear, type NearReaders } from "./verifyNear";

const RPC = "https://rpc.testnet.fastnear.com";
const readers = (o: { view?: unknown; tx?: { method: string; args: unknown; status: "ok" | "failed" }; fail?: boolean }): NearReaders => ({
  view: async <T,>() => {
    if (o.fail) throw new Error("every RPC unreachable");
    return { value: o.view as T, rpc: RPC };
  },
  tx: async () => {
    if (o.fail) throw new Error("every RPC unreachable");
    return { receiver: "margin.testnet", ...o.tx!, block: 277046485, rpc: RPC };
  },
});

describe("anchorOnNear, paid", () => {
  const claim = { mode: "paid" as const, matchId: "m1" };
  it("ok only when the contract holds the same head and is Settled", async () => {
    const c = await anchorOnNear("h1", claim, readers({ view: { status: "Settled", head: "h1" } }), "testnet", "margin.testnet");
    expect(c.state).toBe("ok");
    expect(c.detail).toContain("rpc.testnet.fastnear.com");
  });
  it("bad for a different head, skip while Open or unknown", async () => {
    expect((await anchorOnNear("h1", claim, readers({ view: { status: "Settled", head: "h2" } }), "testnet", "c")).state).toBe("bad");
    expect((await anchorOnNear("h1", claim, readers({ view: { status: "Open", head: "h1" } }), "testnet", "c")).state).toBe("skip");
    expect((await anchorOnNear("h1", claim, readers({ view: null }), "testnet", "c")).state).toBe("skip");
  });
});

describe("anchorOnNear, free", async () => {
  const heads = await Promise.all(["a", "b", "c"].map((x) => sha256Hex(x)));
  const { root, proofs } = await merkle(heads);
  const head = heads[1]!;
  const claim = { mode: "free" as const, matchId: "m2", anchor: { hour: 498416, proof: proofs.get(head)!, tx: "4BJj" } };
  const anchorTx = (args: object, status: "ok" | "failed" = "ok", method = "anchor") => readers({ tx: { method, args, status } });

  it("ok when the settler's anchor tx for that hour wrote the root this match is in", async () => {
    const c = await anchorOnNear(head, claim, anchorTx({ room_id: "free", seq: 498416, head: root }), "testnet", "margin.testnet");
    expect(c.state).toBe("ok");
    expect(c.detail).toContain("block 277046485");
  });
  it("bad for a forged head, another hour, a failed tx or another method", async () => {
    const forged = await sha256Hex("forged");
    expect((await anchorOnNear(forged, claim, anchorTx({ room_id: "free", seq: 498416, head: root }), "testnet", "margin.testnet")).state).toBe("bad");
    expect((await anchorOnNear(head, claim, anchorTx({ room_id: "free", seq: 498415, head: root }), "testnet", "margin.testnet")).state).toBe("bad");
    expect((await anchorOnNear(head, claim, anchorTx({ room_id: "free", seq: 498416, head: root }, "failed"), "testnet", "margin.testnet")).state).toBe("bad");
    expect((await anchorOnNear(head, claim, anchorTx({ room_id: "free", seq: 498416, head: root }, "ok", "settle"), "testnet", "margin.testnet")).state).toBe("bad");
  });
  it("bad when the anchor call went to another contract, and reads markers instead of fetching them (L4-06, L4-10)", async () => {
    expect((await anchorOnNear(head, claim, anchorTx({ room_id: "free", seq: 498416, head: root }), "testnet", "other.testnet")).state).toBe("bad");
    expect((await anchorOnNear(head, { ...claim, anchor: { ...claim.anchor, tx: "skipped" } }, readers({}), "testnet", "c")).state).toBe("skip");
    const onchain = { ...claim, anchor: { ...claim.anchor, tx: "onchain" } };
    expect((await anchorOnNear(head, onchain, readers({ view: { seq: 498416, head: root } }), "testnet", "c")).state).toBe("ok");
    expect((await anchorOnNear(head, onchain, readers({ view: { seq: 498417, head: root } }), "testnet", "c")).state).toBe("skip");
  });
  it("skip, never ok, before the hour is anchored or when NEAR cannot be reached", async () => {
    expect((await anchorOnNear(head, { ...claim, anchor: null }, readers({}), "testnet", "c")).state).toBe("skip");
    const down = await anchorOnNear(head, claim, readers({ fail: true }), "testnet", "c");
    expect(down.state).toBe("skip");
    expect(down.detail).toContain("Could not reach NEAR");
  });
});

// After the mainnet switch, published links still point at testnet matches (no network column).
describe("anchorOnNear, match from the other network", async () => {
  const heads = await Promise.all(["a", "b", "c"].map((x) => sha256Hex(x)));
  const { root, proofs } = await merkle(heads);
  const head = heads[0]!;
  const claim = { mode: "free" as const, matchId: "m3", anchor: { hour: 498416, proof: proofs.get(head)!, tx: "4BJj" } };
  const testnet = { net: "testnet" as const, contract: "playmargin.testnet" };
  const mainnet = { net: "mainnet" as const, contract: "playmargin.near" };
  // Only testnet knows the tx (mainnet RPC says it does not exist), sent to `receiver`.
  const onlyTestnet = (receiver: string): NearReaders => ({
    view: async <T,>(net: string) => ({ value: (net === "testnet" ? { status: "Settled", head } : null) as T, rpc: `https://rpc.${net}.x` }),
    tx: async (net) => {
      if (net !== "testnet") throw new Error("UNKNOWN_TRANSACTION");
      return { method: "anchor", args: { room_id: "free", seq: 498416, head: root }, status: "ok", block: 7, rpc: "https://rpc.testnet.x", receiver };
    },
  });

  it("a testnet build reads testnet exactly as before: no fallback note, no network field", async () => {
    const c = await anchorOnNear(head, claim, onlyTestnet("playmargin.testnet"), "testnet", "playmargin.testnet", mainnet);
    expect(c).toEqual({ state: "ok", detail: "This match is inside the Merkle root the settler anchored for its hour. Read from NEAR via rpc.testnet.x, block 7.", rpc: "https://rpc.testnet.x" });
  });
  it("a mainnet build finds an old testnet anchor and says so", async () => {
    const c = await anchorOnNear(head, claim, onlyTestnet("playmargin.testnet"), "mainnet", "playmargin.near", testnet);
    expect(c.state).toBe("ok");
    expect(c.network).toBe("testnet");
    expect(c.detail).toMatch(/Found on NEAR testnet\.$/);
  });
  it("checks the receiver against the other network's own contract", async () => {
    expect((await anchorOnNear(head, claim, onlyTestnet("evil.testnet"), "mainnet", "playmargin.near", testnet)).state).toBe("bad");
  });
  it("a paid match settled on testnet is found from a mainnet build", async () => {
    const c = await anchorOnNear(head, { mode: "paid", matchId: "p1" }, onlyTestnet("x"), "mainnet", "playmargin.near", testnet);
    expect([c.state, c.network]).toEqual(["ok", "testnet"]);
  });
});
