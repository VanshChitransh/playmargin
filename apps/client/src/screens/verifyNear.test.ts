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
