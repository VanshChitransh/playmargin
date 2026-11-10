// Read API numbers must be exactly what the tables say.
import { describe, expect, it } from "vitest";
import { leaderboard, matchLog, matchProof, pickWatchRoom, stats } from "./api";
import { openDb, userForAccount, userForGuestKey } from "./db";
import { addMatchPlayer, createMatch, finishMatch, saveEvents } from "./matches";
import { JUDGE_SEED, type LogEntry } from "@margin/core";

const U = 1_000_000;

describe("read api", () => {
  it("counts users, multi-human matches and agent pops; ranks verified accounts only", () => {
    const db = openDb(":memory:");
    const alice = userForAccount(db, "alice.testnet");
    const bob = userForAccount(db, "bob.testnet");
    const guest = userForGuestKey(db, "3f2b8c1e-5d4a-4f7b-9c2e-1a6d8e0f4b7c"); // real client keys are UUIDs
    createMatch(db, { id: "m1", mode: "paid", seed: 1, pot: 200 * U });
    addMatchPlayer(db, { matchId: "m1", userId: alice, blobId: "a", entry: 100 * U });
    addMatchPlayer(db, { matchId: "m1", userId: bob, blobId: "b", entry: 100 * U });
    createMatch(db, { id: "m2", mode: "free", seed: 2, pot: 1200 * U });
    addMatchPlayer(db, { matchId: "m2", userId: guest, blobId: "g", entry: 100 * U });
    finishMatch(db, "m1", { status: "settled", head: "h1", txHash: "tx1", payouts: new Map([["a", 150 * U], ["b", 20 * U]]) });
    finishMatch(db, "m2", { status: "settled", head: "h2", payouts: new Map([["g", 500 * U]]) });
    const pop = (by: string, seq: number) => ({ seq, tick: 1, type: "POP", data: { by }, prevHash: "", hash: `x${seq}` }) as unknown as LogEntry;
    saveEvents(db, "m2", [pop("agent-3", 0), pop("drone-1", 1), pop("someone", 2)]);
    // Test traffic (ed25519: and qa- guest keys) and Judge Runs (JUDGE_SEED) never count.
    const tester = userForGuestKey(db, "ed25519:smokekey000001");
    const judgeGuest = userForGuestKey(db, "9a1c3e5f-7b2d-4c6e-8f0a-2b4d6f8a0c1e");
    createMatch(db, { id: "t", mode: "free", seed: 4, pot: 1200 * U });
    addMatchPlayer(db, { matchId: "t", userId: tester, blobId: "x", entry: 100 * U });
    finishMatch(db, "t", { status: "settled", head: "h4", payouts: new Map() });
    saveEvents(db, "t", [pop("agent-2", 0)]);
    createMatch(db, { id: "j", mode: "free", seed: JUDGE_SEED, pot: 1200 * U });
    addMatchPlayer(db, { matchId: "j", userId: judgeGuest, blobId: "y", entry: 100 * U });
    finishMatch(db, "j", { status: "settled", head: "h5", payouts: new Map() });
    saveEvents(db, "j", [pop("drone-1", 0)]);
    // An agents-only room (#/watch with nobody playing) is not traction: no match, no pops.
    createMatch(db, { id: "bots", mode: "free", seed: 3, pot: 1200 * U });
    finishMatch(db, "bots", { status: "settled", head: "h3", payouts: new Map() });
    saveEvents(db, "bots", [pop("agent-1", 0)]);

    // users 4: alice, bob, guest and the judge-run guest (a real person); the tester never counts.
    expect(stats(db)).toEqual({ users: 4, players: 3, matches: 2, multiHumanPct: 50, agentPops: 2 });
    expect(leaderboard(db)).toEqual([
      { account: "alice.testnet", net: 50, matches: 1 },
      { account: "bob.testnet", net: -80, matches: 1 },
    ]);
    expect(matchProof(db, "m1")).toMatchObject({ mode: "paid", settleTx: "tx1" });
    expect(matchProof(db, "m2")).toMatchObject({ mode: "free", anchor: null });
    expect(matchProof(db, "nope")).toBeNull();
    // Verify page shape: paid head is vouched for by its settle tx, free head only once anchored.
    expect(matchLog(db, "m1", "testnet")).toMatchObject({ anchorHead: "h1", tx: "tx1", network: "testnet" });
    expect(matchLog(db, "m2", "testnet")).toMatchObject({ log: expect.any(Array), anchorHead: null, tx: null });
    expect(matchLog(db, "nope")).toBeNull();
  });
});

describe("pickWatchRoom", () => {
  const room = (roomId: string, phase: string, humans: number, extra: object = {}) => ({
    roomId, clients: humans, maxClients: 12, metadata: { mode: "free", public: true, phase, humans, ...extra },
  });
  it("prefers LIVE, then more humans, and skips paid, private, ended and full rooms", () => {
    const rooms = [
      room("warm", "WARMUP", 5),
      room("live1", "LIVE", 1),
      room("live3", "LIVE", 3),
      room("paid", "LIVE", 9, { mode: "paid" }),
      room("priv", "LIVE", 9, { public: false }),
      room("ended", "ENDED", 9),
      { ...room("full", "LIVE", 12), clients: 12 },
    ];
    expect(pickWatchRoom(rooms)?.roomId).toBe("live3");
    expect(pickWatchRoom([room("ended", "ENDED", 2)])).toBeNull();
  });
});

describe("api errors over HTTP", () => {
  it("unknown /api paths and methods answer a JSON 404, not Express's HTML (QA-A-02)", async () => {
    const { default: express } = await import("express");
    const { mountApi } = await import("./api");
    const app = express();
    const db = openDb(":memory:");
    mountApi(app, () => db);
    const srv = app.listen(0);
    await new Promise((r) => srv.once("listening", r));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    try {
      for (const [method, path] of [["GET", "/api/nope"], ["POST", "/api/stats"], ["DELETE", "/api/credits"]] as const) {
        const r = await fetch(base + path, { method });
        expect(r.status).toBe(404);
        expect(r.headers.get("content-type")).toMatch(/application\/json/);
        expect(await r.json()).toEqual({ error: "not found" });
      }
      expect((await fetch(`${base}/api/stats`)).status).toBe(200);
    } finally {
      srv.close();
    }
  });
});
