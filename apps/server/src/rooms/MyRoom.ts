import { Room, Client } from "colyseus";
import { Entity } from "./Entity";
import { State } from "./State";

interface MouseMessage {
  x: number;
  y: number;
}

export class MyRoom extends Room {
  override state = new State();

  override onCreate() {
    this.state.initialize();

    this.onMessage("mouse", (client, message: MouseMessage) => {
      const entity = this.state.entities.get(client.sessionId);

      // skip dead players
      if (!entity) {
        console.log("DEAD PLAYER ACTING...");
        return;
      }

      // change angle
      const dst = Entity.distance(entity, message as Entity);
      entity.speed = (dst < 20) ? 0 : Math.min(dst / 15, 4);
      entity.angle = Math.atan2(entity.y - message.y, entity.x - message.x);
    });

    this.setSimulationInterval(() => this.state.update());
  }

  override onJoin(client: Client) {
    console.log(client.sessionId, "JOINED");
    this.state.createPlayer(client.sessionId);
  }

  override onLeave(client: Client) {
    console.log(client.sessionId, "LEFT!");
    const entity = this.state.entities.get(client.sessionId);

    // entity may be already dead.
    if (entity) { entity.dead = true; }
  }

}
