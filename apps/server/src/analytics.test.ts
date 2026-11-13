// Anonymous funnel analytics: only allow-listed events are kept, ids are hashed, the private page
// needs the key, and player numbers use the same "real player" filter as /api/stats.
import { describe, expect, it } from "vitest";
import { openDb, type Db } from "./db";
import { ensureTables, insights, keyOk, markTeam, recordEvents } from "./analytics";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 10, 12);
const ID = "4f8c2d1e-aaaa-bbbb-cccc-1234567890ab";

function fresh(): Db {
  const db = openDb(":memory:");
  ensureTables(db);
  ensureTables(db); // idempotent: safe on every boot
  return db;
}

describe("recordEvents", () => {
  it("keeps only allow-listed names, counts per day, and stores no raw id", () => {
    const db = fresh();
    expect(recordEvents(db, { id: ID, events: ["home_view", "practice_click", "rm -rf", "home_view"] }, T0)).toBe(3);
    const counts = db.prepare("SELECT event, n FROM analytics_counts ORDER BY event").all();
    expect(counts).toEqual([{ event: "home_view", n: 2 }, { event: "practice_click", n: 1 }]);
    const guests = db.prepare("SELECT DISTINCT guest FROM analytics_seen").all() as Array<{ guest: string }>;
    expect(guests).toHaveLength(1);
    expect(guests[0]!.guest).not.toContain(ID.slice(0, 8)); // hashed, never the raw browser id
  });
  it("refuses bad bodies: missing or odd id, no array, nothing allowed", () => {
    const db = fresh();
    for (const body of [null, "x", { id: "short", events: ["home_view"] }, { id: "<script>alert(1)</script>", events: ["home_view"] }, { id: ID }, { id: ID, events: ["nope"] }])
      expect(recordEvents(db, body, T0)).toBe(0);
  });
  it("caps a batch at 50 events", () => {
    expect(recordEvents(fresh(), { id: ID, events: Array(500).fill("home_view") }, T0)).toBe(50);
  });
});

describe("keyOk", () => {
  it("needs STATS_KEY set and an exact match", () => {
    expect(keyOk("abc", undefined)).toBe(false);
    expect(keyOk(undefined, "secret-key")).toBe(false);
    expect(keyOk("secret-ke", "secret-key")).toBe(false);
    expect(keyOk("secret-key", "secret-key")).toBe(true);
  });
});

describe("insights", () => {
  it("funnel per day with unique guests, and real players, returning, multi-human and paid from the game tables", () => {
    const db = fresh();
    recordEvents(db, { id: ID, events: ["home_view", "home_view"] }, T0 - DAY);
    recordEvents(db, { id: ID, events: ["home_view"] }, T0);
    recordEvents(db, { id: "another-browser-id-0001", events: ["home_view", "practice_click"] }, T0);
    const user = (id: string, key: string) => db.prepare("INSERT INTO users (id, guest_key, created) VALUES (?, ?, 0)").run(id, key);
    user("u1", "7b0f1c9a-real-guest-one");
    user("u2", "8c1e2d3f-real-guest-two");
    user("qa", "qa-test-harness"); // test traffic never counts
    const match = (id: string, mode: string, ended: number, who: string[]) => {
      db.prepare("INSERT INTO matches (id, mode, seed, status, created, ended) VALUES (?, ?, 1, 'settled', 0, ?)").run(id, mode, ended);
      for (const u of who) db.prepare("INSERT INTO match_players (match_id, user_id, blob_id, entry) VALUES (?, ?, ?, 0)").run(id, u, u);
    };
    match("m1", "free", T0 - DAY, ["u1"]);
    match("m2", "free", T0, ["u1", "u2", "qa"]);
    match("m3", "paid", T0, ["u2"]);
    const r = insights(db, T0, 7);
    expect(r.funnel.find((f) => f.day === "2026-11-10" && f.event === "home_view")).toEqual({ day: "2026-11-10", event: "home_view", n: 2, guests: 2 });
    expect(r.totals.find((t) => t.event === "home_view")).toEqual({ event: "home_view", guests: 2, guestDays: 3 });
    expect(r.players).toEqual([{ day: "2026-11-09", n: 1 }, { day: "2026-11-10", n: 2 }]);
    expect(r.returning).toBe(1); // u1 played on two days
    expect(r.multi).toEqual([{ day: "2026-11-10", n: 1 }]); // m2: u1 + u2 (the qa seat is not real)
    expect(r.paid).toEqual([{ day: "2026-11-10", n: 1 }]);
    expect(r.stats.players).toBe(2);
  });
});

describe("markTeam", () => {
  it("team browsers, guests and wallets stay in the DB but leave every count, past seats included", () => {
    const db = fresh();
    const TEAM = "1a2b3c4d-team-browser-01";
    recordEvents(db, { id: ID, events: ["home_view"] }, T0);
    recordEvents(db, { id: TEAM, events: ["home_view"] }, T0);
    const user = (id: string, key: string | null, acc: string | null) =>
      db.prepare("INSERT INTO users (id, guest_key, account_id, created) VALUES (?, ?, ?, 0)").run(id, key, acc);
    user("out", "7b0f1c9a-outside-player", null);
    user("dev", "9d8e7f6a-team-guest-key", null);
    user("qa2-user-0001", "5e4d3c2b-qa-agent-guest", null);
    user("w", null, "vanshverse.near");
    db.prepare("INSERT INTO matches (id, mode, seed, status, created, ended) VALUES ('m', 'free', 1, 'settled', 0, ?)").run(T0);
    for (const u of ["out", "dev", "qa2-user-0001", "w"]) db.prepare("INSERT INTO match_players (match_id, user_id, blob_id, entry) VALUES ('m', ?, ?, 0)").run(u, u);
    expect(insights(db, T0, 7).stats).toMatchObject({ users: 4, players: 4, matches: 1, multiHumanPct: 100 });
    // A ?team visit sends the browser id and guest key; wallets and old QA users are marked by hand.
    expect(markTeam(db, { browserId: TEAM, guestKey: "9d8e7f6a-team-guest-key", accountId: "vanshverse.near", userIds: ["qa2-user-0001", "x;drop"] }, T0)).toBe(4);
    expect(markTeam(db, { guestKey: "9d8e7f6a-team-guest-key" }, T0)).toBe(0); // idempotent
    const r = insights(db, T0, 7);
    expect(r.stats).toMatchObject({ users: 1, players: 1, matches: 1, multiHumanPct: 0 });
    expect(r.totals.find((t) => t.event === "home_view")?.guests).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM match_players").get()).toEqual({ n: 4 }); // excluded, never deleted
  });
});
