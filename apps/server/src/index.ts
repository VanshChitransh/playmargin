// Colyseus entry. The monitor is mounted only when MONITOR_PASS is set, so a
// fresh deploy never ships the boilerplate's admin/admin login.
import { defineServer, defineRoom, monitor } from "colyseus";
import { listen } from "@colyseus/tools";
import basicAuth from "express-basic-auth";

import { MATCH_TICKS } from "@margin/core";
import { MyRoom } from "./rooms/MyRoom";

const server = defineServer({
  rooms: {
    my_room: defineRoom(MyRoom),
  },
  express: (app) => {
    const pass = process.env.MONITOR_PASS;
    if (pass) {
      app.use("/colyseus", basicAuth({ users: { admin: pass }, challenge: true }), monitor());
    }
  },
});

listen(server).then(() => console.log(`Listening on http://localhost:2567 (match = ${MATCH_TICKS} ticks)`));
