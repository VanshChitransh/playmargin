// Leaving a lobby before GO costs nothing (QA P01, P02, B01), on a real in-process Colyseus server.
// The chain is mocked: refundTickets records which tickets the settler would refund. P01 a lone
// paid player gets a clear "no match" message and the refund; P02 leaving a paid lobby refunds at
// once; B01 a player who dropped from a private lobby is not charged when the host starts.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "margin-lobby-")), "t.sqlite");
process.env.SIM_SPEED = "10"; // 20 s of warm-up in about 2 s

const refunds: string[] = [];
vi.mock("./paidMatch", async (orig) => ({
  ...(await orig<typeof import("./paidMatch")>()),
  admitPaid: async (opts: { join?: { accountId?: string } }) => ({ accountId: opts.join?.accountId ?? "" }),
  refundTickets: async (accounts: string[]) => void refunds.push(...accounts),
}));
// Paid rooms need a settlement adapter at create; these never reach GO, so a stub does.
vi.mock("../settlement", async (orig) => {
  const real = await orig<typeof import("../settlement")>();
  return { ...real, settlementFor: (...a: Parameters<typeof real.settlementFor>) => (a[0] === "free" ? real.settlementFor(...a) : ({} as ReturnType<typeof real.settlementFor>)) };
});

const { defineRoom, defineServer } = await import("colyseus");
const { Client } = await import("@colyseus/sdk");
const { MatchRoom, NO_MATCH_PAID } = await import("./MatchRoom");
const { seatedAccounts } = await import("./paidMatch");
const { sharedDb } = await import("../db");
const { creditsRepo } = await import("../credits");

const PORT = 2700 + Math.floor(Math.random() * 200);
const server = defineServer({ rooms: { match: defineRoom(MatchRoom).filterBy(["mode"]), private: defineRoom(MatchRoom).filterBy(["mode", "roomCode"]) } });
const url = `ws://localhost:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (ok: () => boolean, ms = 8000) => {
  for (const t0 = Date.now(); !ok() && Date.now() - t0 < ms; ) await sleep(50);
  return ok();
};
const paid = (accountId: string) => ({ mode: "paid", join: { accountId, signature: "mocked: admitPaid is stubbed" } });

beforeAll(async () => void (await server.listen(PORT)));
// Not awaited: a graceful stop waits out the B01 room's whole LIVE match, and the worker ends anyway.
afterAll(() => void server.gracefullyShutdown(false));

describe("leaving before GO is free", () => {
  it("P01: a lone paid player gets the no-match message, the ticket refund, and the room closes", async () => {
    const r = await new Client(url).joinOrCreate("match", paid("lone.testnet"));
    let reason = "";
    let closed = false;
    r.onMessage("*", () => {});
    r.onMessage("aborted", (m: { reason: string }) => (reason = m.reason));
    r.onLeave(() => (closed = true));
    expect(await until(() => closed, 10_000)).toBe(true);
    expect(reason).toBe(NO_MATCH_PAID);
    expect(refunds).toEqual(["lone.testnet"]);
    expect(await until(() => !seatedAccounts.has("lone.testnet"))).toBe(true);
  }, 15_000);

  it("P02: leaving a paid lobby refunds the ticket once, and the account can join again", async () => {
    refunds.length = 0;
    const a = await new Client(url).joinOrCreate("match", paid("leaver.testnet"));
    a.onMessage("*", () => {});
    await sleep(200);
    await a.leave(true);
    expect(await until(() => refunds.length > 0)).toBe(true);
    expect(refunds).toEqual(["leaver.testnet"]);
    expect(await until(() => !seatedAccounts.has("leaver.testnet"))).toBe(true);
  });

  it("B01: a friend who dropped from a private lobby is not charged when the host starts", async () => {
    const code = "QZXW";
    const opts = (k: string) => ({ mode: "free", roomCode: code, guestKey: `lobbyexit-${k}-0123456789` });
    const host = await new Client(url).joinOrCreate("private", opts("host"));
    const a = await new Client(url).joinOrCreate("private", opts("stay"));
    const gone = await new Client(url).joinOrCreate("private", opts("gone"));
    for (const r of [host, a, gone]) r.onMessage("*", () => {});
    await sleep(300);
    gone.reconnection.enabled = false;
    await gone.leave(false); // a dropped socket: the seat is held for a reload that never comes
    await sleep(300);
    let live = false;
    host.onMessage("ev", (e: { type: string; phase?: string }) => (live ||= e.type === "phase" && e.phase === "LIVE"));
    host.send("startNow");
    expect(await until(() => live)).toBe(true);
    const db = sharedDb();
    const bal = (k: string) => creditsRepo(db).balance((db.prepare("SELECT id FROM users WHERE guest_key = ?").get(`lobbyexit-${k}-0123456789`) as { id: string }).id);
    expect(bal("gone")).toBeGreaterThan(bal("stay")); // charged: the host and the friend who stayed
    expect(bal("host")).toBe(bal("stay"));
    for (const r of [host, a]) await r.leave(true);
  }, 15_000);
});

describe("paid create (B03)", () => {
  it("an unsigned paid matchmake call opens no room", async () => {
    await expect(new Client(url).joinOrCreate("match", { mode: "paid" })).rejects.toThrow(/must be signed/);
  });
});
