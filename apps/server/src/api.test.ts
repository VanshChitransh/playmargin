// Read API numbers must be exactly what the tables say.
import { describe, expect, it } from "vitest";
import { leaderboard, matchLog, matchProof, pickWatchRoom, stats } from "./api";
import { openDb, userForAccount, userForGuestKey } from "./db";
import { addMatchPlayer, createMatch, finishMatch, saveEvents } from "./matches";
import type { LogEntry } from "@margin/core";

const U = 1_000_000;

describe("read api", () => {
  it("counts users, multi-human matches and agent pops; ranks verified accounts only", () => {
    const db = openDb(":memory:");
    const alice = userForAccount(db, "alice.testnet");
    const bob = userForAccount(db, "bob.testnet");
    const guest = userForGuestKey(db, "ed25519:guestguestguest1");
    createMatch(db, { id: "m1", mode: "paid", seed: 1, pot: 200 * U });
    addMatchPlayer(db, { matchId: "m1", userId: alice, blobId: "a", entry: 100 * U });
    addMatchPlayer(db, { matchId: "m1", userId: bob, blobId: "b", entry: 100 * U });
    createMatch(db, { id: "m2", mode: "free", seed: 2, pot: 1200 * U });
    addMatchPlayer(db, { matchId: "m2", userId: guest, blobId: "g", entry: 100 * U });
    finishMatch(db, "m1", { status: "settled", head: "h1", txHash: "tx1", payouts: new Map([["a", 150 * U], ["b", 20 * U]]) });
    finishMatch(db, "m2", { status: "settled", head: "h2", payouts: new Map([["g", 500 * U]]) });
    const pop = (by: string, seq: number) => ({ seq, tick: 1, type: "POP", data: { by }, prevHash: "", hash: `x${seq}` }) as unknown as LogEntry;
    saveEvents(db, "m2", [pop("agent-3", 0), pop("drone-1", 1), pop("someone", 2)]);
    // An agents-only room (#/watch with nobody playing) is not traction: no match, no pops.
    createMatch(db, { id: "bots", mode: "free", seed: 3, pot: 1200 * U });
    finishMatch(db, "bots", { status: "settled", head: "h3", payouts: new Map() });
    saveEvents(db, "bots", [pop("agent-1", 0)]);

    expect(stats(db)).toEqual({ users: 3, players: 3, matches: 2, multiHumanPct: 50, agentPops: 2 });
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
