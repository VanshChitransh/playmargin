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
import { log } from "./obs";

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
void anchor();

listen(server).then(() =>
  log.info("up", { port: Number(process.env.PORT ?? 2567), network: sharedChain()?.cfg.network ?? "off", matchTicks: MATCH_TICKS }),
);
