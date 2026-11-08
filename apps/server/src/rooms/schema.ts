// Colyseus state the client reads, plus the Mapper that fills it from engine blobs/world.
// Only display fields (protocol.ts BlobView) cross the wire; debt never does. A player's own
// "owe" number goes to that client alone as a private "me" message.
import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import { R, radius, toUnits, type Blob, type World } from "@margin/core";
import { ring } from "../engine/stub";

export class BlobState extends Schema {
  @type("string") id = "";
  @type("string") kind = "human";
  @type("string") label = "";
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") radius = 0;
  @type("string") ring = "green";
  @type("uint8") pips = 0;
  @type("float32") equity = 0;
  @type("boolean") shielded = false;
  @type("boolean") cashingOut = false;
  @type("string") state = "alive";
}

export class FoodState extends Schema {
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") radius = 0;
}

export class SpikeState extends Schema {
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("boolean") big = false;
  @type("boolean") live = true;
}

export class MatchState extends Schema {
  @type("string") mode = "free";
  @type("string") phase = "WARMUP";
  /** Whole seconds left in the current phase (warm-up, 3-2-1, or the 90 s match). */
  @type("uint8") timeLeftS = 0;
  @type("string") rateTier = "LOW";
  @type("float32") zoneX = 0;
  @type("float32") zoneY = 0;
  @type("float32") zoneR = 0;
  @type({ map: BlobState }) blobs = new MapSchema<BlobState>();
  @type({ map: FoodState }) food = new MapSchema<FoodState>();
  @type({ map: SpikeState }) spikes = new MapSchema<SpikeState>();
  /** Top LEADERBOARD_TOP blob ids by equity. */
  @type(["string"]) leaderboard = new ArraySchema<string>();
}

/** Copy display fields of these blobs into state.blobs; drop blobs no longer present. */
export function syncBlobs(state: MatchState, blobs: Iterable<Blob>, tick: number): void {
  const seen = new Set<string>();
  for (const b of blobs) {
    seen.add(b.id);
    let s = state.blobs.get(b.id);
    if (!s) {
      s = new BlobState().assign({ id: b.id, kind: b.kind, label: b.label });
      state.blobs.set(b.id, s);
    }
    s.x = b.x;
    s.y = b.y;
    s.radius = radius(b.mass);
    s.ring = ring(b);
    s.pips = b.pips;
    s.equity = toUnits(b.mass - b.debt);
    s.shielded = tick < b.shieldUntil;
    s.cashingOut = b.cashout !== null;
    s.state = b.state;
  }
  for (const id of [...state.blobs.keys()]) if (!seen.has(id)) state.blobs.delete(id);
}

/** Copy zone, food and spikes from the world (LIVE only). */
export function syncWorld(state: MatchState, w: World): void {
  state.zoneX = w.zone.cx;
  state.zoneY = w.zone.cy;
  state.zoneR = w.zone.r;
  syncById(state.food, w.food, FoodState, (s, f) => s.assign({ x: f.x, y: f.y, radius: radius(f.mass) }));
  syncById(state.spikes, w.spikes, SpikeState, (s, k) => s.assign({ x: k.x, y: k.y, big: k.big, live: k.respawnAt === null }));
}

function syncById<T extends { id: number }, S extends Schema>(
  map: MapSchema<S>,
  items: T[],
  Ctor: new () => S,
  fill: (s: S, item: T) => void,
): void {
  const seen = new Set<string>();
  for (const item of items) {
    const key = String(item.id);
    seen.add(key);
    let s = map.get(key);
    if (!s) {
      s = new Ctor();
      map.set(key, s);
    }
    fill(s, item);
  }
  for (const key of [...map.keys()]) if (!seen.has(key)) map.delete(key);
}

/** Top LEADERBOARD_TOP alive blob ids by equity, highest first. */
export function leaderboard(blobs: Iterable<Blob>): string[] {
  return [...blobs]
    .filter((b) => b.state === "alive")
    .sort((a, b) => b.mass - b.debt - (a.mass - a.debt))
    .slice(0, R.LEADERBOARD_TOP)
    .map((b) => b.id);
}
