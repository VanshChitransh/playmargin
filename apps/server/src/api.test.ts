// Read API numbers must be exactly what the tables say.
import { describe, expect, it } from "vitest";
import { facts, leaderboard, matchLog, matchProof, pickWatchRoom, stats } from "./api";
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
    // An agents-only room (/watch with nobody playing) is not traction: no match, no pops.
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

/** mountApi on an in-memory DB behind a real HTTP port, for route-level tests. */
async function serve(db = openDb(":memory:")) {
  const { default: express } = await import("express");
  const { mountApi } = await import("./api");
  const app = express();
  mountApi(app, () => db);
  const srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  return { db, srv, base: `http://127.0.0.1:${(srv.address() as { port: number }).port}` };
}

describe("stats and facts cost (L2-04)", () => {
  it("serves a cached scan for 30 s instead of rescanning the tables on every hit", async () => {
    const { db, srv, base } = await serve();
    try {
      const get = async (path: string) => (await fetch(base + path, { headers: { "x-real-ip": "10.4.0.1" } })).json() as Promise<{ users: number; matchesWithRealPlayers: { free: number } }>;
      expect((await get("/api/stats")).users).toBe(0);
      expect((await get("/api/facts")).matchesWithRealPlayers.free).toBe(0);
      const u = userForGuestKey(db, "3f2b8c1e-5d4a-4f7b-9c2e-1a6d8e0f4b7c");
      createMatch(db, { id: "c1", mode: "free", seed: 9, pot: 1200 * U });
      addMatchPlayer(db, { matchId: "c1", userId: u, blobId: "g", entry: 100 * U });
      finishMatch(db, "c1", { status: "settled", head: "h", payouts: new Map() });
      expect((await get("/api/stats")).users).toBe(0);
      expect((await get("/api/facts")).matchesWithRealPlayers.free).toBe(0);
    } finally {
      srv.close();
    }
  });

  it("limits each IP to 30 reads a minute, other IPs still get through", async () => {
    const { srv, base } = await serve();
    try {
      const hit = (path: string, ip: string) => fetch(base + path, { headers: { "x-real-ip": ip } }).then((r) => r.status);
      for (let i = 0; i < 15; i++) expect([await hit("/api/stats", "10.4.0.2"), await hit("/api/facts", "10.4.0.2")]).toEqual([200, 200]);
      expect(await hit("/api/stats", "10.4.0.2")).toBe(429);
      expect(await hit("/api/facts", "10.4.0.2")).toBe(429);
      expect(await hit("/api/stats", "10.4.0.3")).toBe(200);
    } finally {
      srv.close();
    }
  });
});

describe("live match log (L4-07)", () => {
  it("refuses the log (seed and loans) while the match is in play, serves it from MATCH_END on", async () => {
    const { db, srv, base } = await serve();
    const entry = (seq: number, type: string) => ({ seq, tick: seq, type, data: { seed: 424242 }, prevHash: "", hash: `h${seq}` }) as unknown as LogEntry;
    try {
      createMatch(db, { id: "live1", mode: "paid", seed: 424242, pot: 200 * U });
      saveEvents(db, "live1", [entry(0, "MATCH_START"), entry(1, "BOOST")]);
      const mid = await fetch(`${base}/api/matches/live1/log`);
      expect(mid.status).toBe(409);
      expect(JSON.stringify(await mid.json())).not.toContain("424242");
      // The bell rang, the paid settle tx is still in flight (status live): the receipt needs it now.
      saveEvents(db, "live1", [entry(2, "MATCH_END")]);
      const end = await fetch(`${base}/api/matches/live1/log`);
      expect(end.status).toBe(200);
      expect(((await end.json()) as { log: LogEntry[] }).log).toHaveLength(3);
      // A match that never reached MATCH_END but was closed (refused) is still verifiable.
      createMatch(db, { id: "r1", mode: "free", seed: 1, pot: 1200 * U });
      saveEvents(db, "r1", [entry(0, "MATCH_START")]);
      finishMatch(db, "r1", { status: "refused", head: "h0" });
      expect((await fetch(`${base}/api/matches/r1/log`)).status).toBe(200);
      expect((await fetch(`${base}/api/matches/nope/log`)).status).toBe(404);
    } finally {
      srv.close();
    }
  });
});

describe("finishMatch payouts", () => {
  it("stores 0, never NULL, for a player who got nothing (QA-D-06)", () => {
    const db = openDb(":memory:");
    const a = userForGuestKey(db, "qa-d06-a");
    const b = userForGuestKey(db, "qa-d06-b");
    createMatch(db, { id: "d6", mode: "free", seed: 1, pot: 200 * U });
    addMatchPlayer(db, { matchId: "d6", userId: a, blobId: "a", entry: 100 * U });
    addMatchPlayer(db, { matchId: "d6", userId: b, blobId: "b", entry: 100 * U });
    finishMatch(db, "d6", { status: "settled", head: "h", payouts: new Map([["a", 180 * U]]) });
    const rows = db.prepare("SELECT blob_id, payout FROM match_players WHERE match_id = 'd6' ORDER BY blob_id").all();
    expect(rows).toEqual([{ blob_id: "a", payout: 180 * U }, { blob_id: "b", payout: 0 }]);
  });
});

describe("facts", () => {
  it("counts real users only and hands out pointers, not on-chain claims", () => {
    const db = openDb(":memory:");
    const w = userForAccount(db, "w.testnet");
    const g = userForGuestKey(db, "3f2b8c1e-5d4a-4f7b-9c2e-1a6d8e0f4b7c");
    const qa = userForGuestKey(db, "qa-bot-1");
    createMatch(db, { id: "p1", mode: "paid", seed: 1, pot: 200 * U });
    addMatchPlayer(db, { matchId: "p1", userId: w, blobId: "a", entry: 100 * U });
    finishMatch(db, "p1", { status: "settled", head: "hp", txHash: "TxHash11111111111111111111", payouts: new Map() });
    createMatch(db, { id: "f1", mode: "free", seed: 2, pot: 100 * U });
    addMatchPlayer(db, { matchId: "f1", userId: g, blobId: "g", entry: 100 * U });
    finishMatch(db, "f1", { status: "settled", head: "hf", payouts: new Map() });
    createMatch(db, { id: "q1", mode: "free", seed: 3, pot: 100 * U });
    addMatchPlayer(db, { matchId: "q1", userId: qa, blobId: "q", entry: 100 * U });
    finishMatch(db, "q1", { status: "settled", head: "hq", payouts: new Map() });
    const f = facts(db, "testnet", "margin.testnet");
    expect(f.matchesWithRealPlayers).toEqual({ free: 1, paid: 1 }); // the qa- match never counts
    expect(f.players).toEqual({ freeGuests: 1, wallets: 1 });
    expect(f.paidSettled).toEqual([{ id: "p1", head: "hp", tx: "TxHash11111111111111111111", team: false }]);
    expect(f.wallets).toEqual(["w.testnet"]);
  });
});

describe("facts: our own paid match (screener read 'paid: 0' next to one paid tx)", () => {
  it("lists it in paidSettled marked team: true and keeps it out of matchesWithRealPlayers", () => {
    const db = openDb(":memory:");
    const qa1 = userForAccount(db, "qa1.rehearsal.testnet");
    const qa2 = userForAccount(db, "qa2.rehearsal.testnet");
    for (const id of ["qa1.rehearsal.testnet", "qa2.rehearsal.testnet"]) db.prepare("INSERT INTO team (kind, id, added) VALUES ('account', ?, 0)").run(id);
    createMatch(db, { id: "x6f", mode: "paid", seed: 5, pot: 200 * U });
    addMatchPlayer(db, { matchId: "x6f", userId: qa1, blobId: "a", entry: 100 * U });
    addMatchPlayer(db, { matchId: "x6f", userId: qa2, blobId: "b", entry: 100 * U });
    finishMatch(db, "x6f", { status: "settled", head: "hx", txHash: "3XigYdGzVvQ4Mv8qtqkq1VEWHtJyDpuAEW5h", payouts: new Map() });
    const f = facts(db, "testnet");
    expect(f).not.toHaveProperty("matches");
    expect(f.matchesWithRealPlayers.paid).toBe(0);
    expect(f.paidSettled).toEqual([{ id: "x6f", head: "hx", tx: "3XigYdGzVvQ4Mv8qtqkq1VEWHtJyDpuAEW5h", team: true }]);
    expect(f.wallets).toEqual([]);
  });
});
