// Colyseus entry. The monitor is mounted only when MONITOR_PASS is set, so a
// fresh deploy never ships the boilerplate's admin/admin login.
import { defineServer, defineRoom, monitor } from "colyseus";
import { listen } from "@colyseus/tools";
import basicAuth from "express-basic-auth";

import { MATCH_TICKS, toUnits } from "@margin/core";
import { MyRoom } from "./rooms/MyRoom";
import { MatchRoom } from "./rooms/MatchRoom";
import { creditsRepo, isGuestKey, topUpDaily } from "./credits";
import { sharedDb, userForGuestKey } from "./db";

const server = defineServer({
  rooms: {
    // my_room stays until the client switches to "match" (S3), then MyRoom/State/Entity/Player go.
    my_room: defineRoom(MyRoom),
    match: defineRoom(MatchRoom).filterBy(["mode"]),
    private: defineRoom(MatchRoom).filterBy(["mode", "roomCode"]),
  },
  express: (app) => {
    // Balance for the home screen; first visit of the UTC day also applies the daily top-up.
    app.get("/api/credits", (req, res) => {
      res.set("Access-Control-Allow-Origin", "*");
      const key = req.query.guestKey;
      if (!isGuestKey(key)) return void res.status(400).json({ error: "bad guestKey" });
      const db = sharedDb();
      const userId = userForGuestKey(db, key);
      const toppedUp = topUpDaily(db, userId);
      res.json({ balance: toUnits(creditsRepo(db).balance(userId)), toppedUp: toUnits(toppedUp) });
    });
    const pass = process.env.MONITOR_PASS;
    if (pass) {
      app.use("/colyseus", basicAuth({ users: { admin: pass }, challenge: true }), monitor());
    }
  },
});

listen(server).then(() => console.log(`Listening on http://localhost:2567 (match = ${MATCH_TICKS} ticks)`));
