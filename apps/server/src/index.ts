// Colyseus entry. The monitor is mounted only when MONITOR_PASS is set, so a
// fresh deploy never ships the boilerplate's admin/admin login.
import { defineServer, defineRoom, monitor } from "colyseus";
import { listen } from "@colyseus/tools";
import basicAuth from "express-basic-auth";

import { MATCH_TICKS } from "@margin/core";
import { MatchRoom, drain } from "./rooms/MatchRoom";
import { mountApi } from "./api";
import { mountAnalytics } from "./analytics";
import { guardMatchmake } from "./matchmakeGuard";
import { quietLogger } from "./refusal";
import { sharedDb } from "./db";
import { anchorPending } from "./anchor/job";
import { sharedChain } from "./settlement";
import { paidStakeBase } from "./settlement/stake";
import { DISK_LOW_MB, SETTLER_LOW_NEAR, diskFree, log, settler } from "./obs";

const server = defineServer({
  // Expected refusals become one structured line instead of a stack (refusal.ts, QA-A-07).
  logger: quietLogger,
  rooms: {
    match: defineRoom(MatchRoom).filterBy(["mode"]),
    private: defineRoom(MatchRoom).filterBy(["mode", "roomCode"]),
    judge: defineRoom(MatchRoom),
  },
  express: (app) => {
    mountAnalytics(app, sharedDb); // before mountApi: its /api 404 catch-all would swallow these routes
    mountApi(app, sharedDb);
    const pass = process.env.MONITOR_PASS;
    if (pass) {
      app.use("/colyseus", basicAuth({ users: { admin: pass }, challenge: true }), monitor());
    }
  },
});

// SIGTERM: Colyseus locks every room and waits for them to close; drain also blocks new rooms.
server.onBeforeShutdown(() => {
  drain.on = true;
  log.info("drain", { note: "no new matches, LIVE matches finish first" });
});

// Hourly anchor: checked every 5 min so a finished hour goes on chain within minutes. unref() so a
// drain exit never waits on it.
const anchor = () => anchorPending(sharedDb(), sharedChain()).catch((err: unknown) => log.error("anchor_failed", { err }));
setInterval(anchor, 5 * 60_000).unref();

// Settler balance alarm: every 5 min, cached for /health so it never waits on an RPC.
const checkSettler = async () => {
  const chain = sharedChain();
  if (!chain) return;
  try {
    settler.near = await chain.settlerNear();
    settler.low = settler.near < SETTLER_LOW_NEAR;
    settler.checkedAt = Date.now();
    if (settler.low) log.warn("settler_low", { account: chain.cfg.settlerId, near: settler.near, min: SETTLER_LOW_NEAR });
  } catch (err) {
    log.error("settler_balance_failed", { err });
  }
};
setInterval(checkSettler, 5 * 60_000).unref();

// Disk alarm, same cadence: a full disk stalls every DB write (they queue and retry, see matchRecord.ts).
const checkDisk = () => {
  const d = diskFree();
  if (d?.low) log.warn("disk_low", { freeMB: d.freeMB, minMB: DISK_LOW_MB });
};
setInterval(checkDisk, 5 * 60_000).unref();
checkDisk();
void checkSettler();
// Paid stake from the contract at boot (logs paid_stake, or paid_stake_failed for a stake core cannot settle).
const ch = sharedChain();
if (ch) void paidStakeBase(ch).catch((err: unknown) => log.error("paid_stake_failed", { err }));
void anchor();

listen(server).then((s) => {
  // After listen, so it wraps the router Colyseus just bound. No http server = nothing to guard.
  if (s.transport.server) guardMatchmake(s.transport.server, undefined, () => drain.on);
  else log.warn("matchmake_unguarded", { note: "transport has no http server" });
  log.info("up", { port: Number(process.env.PORT ?? 2567), network: sharedChain()?.cfg.network ?? "off", matchTicks: MATCH_TICKS });
});
