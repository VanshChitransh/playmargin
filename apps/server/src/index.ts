// Colyseus entry. The monitor is mounted only when MONITOR_PASS is set, so a
// fresh deploy never ships the boilerplate's admin/admin login.
import { defineServer, defineRoom, monitor } from "colyseus";
import { listen } from "@colyseus/tools";
import basicAuth from "express-basic-auth";

import { MATCH_TICKS } from "@margin/core";
import { MatchRoom, drain } from "./rooms/MatchRoom";
import { mountApi } from "./api";
import { sharedDb } from "./db";
import { anchorPending } from "./anchor/job";
import { sharedChain } from "./settlement";
import { SETTLER_LOW_NEAR, log, settler } from "./obs";

const server = defineServer({
  rooms: {
    match: defineRoom(MatchRoom).filterBy(["mode"]),
    private: defineRoom(MatchRoom).filterBy(["mode", "roomCode"]),
    judge: defineRoom(MatchRoom),
  },
  express: (app) => {
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
void checkSettler();
void anchor();

listen(server).then(() =>
  log.info("up", { port: Number(process.env.PORT ?? 2567), network: sharedChain()?.cfg.network ?? "off", matchTicks: MATCH_TICKS }),
);
