// Colyseus state the client reads, plus the Mapper that fills it from engine blobs/world.
// Only display fields (protocol.ts BlobView) cross the wire; debt never does. A player's own
// "owe" number goes to that client alone as a private "me" message.
import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import { spikeRadius, blobView, foodView, matchView, type World } from "@margin/core";

export class BlobState extends Schema {
  @type("string") id = "";
  @type("string") kind = "human";
  @type("string") label = "";
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") radius = 0;
  @type("string") ring = "green";
  @type("uint8") pips = 0;
  /** BOOST capacity left, 0 to 1 (the fuel ring). */
  @type("float32") fuel = 0;
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
  /** Core hitbox radius in px, so the client draws exactly what hurts. */
  @type("float32") radius = 0;
}

export class MatchState extends Schema {
  @type("string") mode = "free";
  @type("string") phase = "WARMUP";
  /** Server tick, monotonic across all phases (60 Hz), for client interpolation. */
  @type("uint32") tick = 0;
  @type("uint16") arenaW = 0;
  @type("uint16") arenaH = 0;
  /** Whole seconds left in the current phase (warm-up, 3-2-1, or the 90 s match). */
  @type("uint8") timeLeftS = 0;
  @type("string") rateTier = "LOW";
  /** Lobby counter; agents are always counted separately, never passed off as people. */
  @type("uint8") humans = 0;
  @type("uint8") agents = 0;
  /** Private room lobby: no timer, the host (earliest human here) taps START. */
  @type("boolean") privateRoom = false;
  @type("string") host = "";
  @type("float32") zoneX = 0;
  @type("float32") zoneY = 0;
  @type("float32") zoneR = 0;
  @type({ map: BlobState }) blobs = new MapSchema<BlobState>();
  @type({ map: FoodState }) food = new MapSchema<FoodState>();
  @type({ map: SpikeState }) spikes = new MapSchema<SpikeState>();
  /** Top LEADERBOARD_TOP blob ids by equity. */
  @type(["string"]) leaderboard = new ArraySchema<string>();
}

/** Copy core's blobView (display fields only, owe stays private) into state.blobs. */
export function syncBlobs(state: MatchState, w: World): void {
  for (const b of w.blobs.values()) {
    const { owe: _owe, ...v } = blobView(b, w.tick);
    const s = state.blobs.get(b.id);
    if (s) s.assign(v);
    else state.blobs.set(b.id, new BlobState().assign(v));
  }
  for (const id of [...state.blobs.keys()]) if (!w.blobs.has(id)) state.blobs.delete(id);
}

/** Copy zone, food and spikes from the world (LIVE only). */
export function syncWorld(state: MatchState, w: World): void {
  state.zoneX = w.zone.cx;
  state.zoneY = w.zone.cy;
  state.zoneR = w.zone.r;
  syncById(state.food, w.food, FoodState, (s, f) => s.assign({ x: f.x, y: f.y, radius: foodView(f).r }));
  syncById(state.spikes, w.spikes, SpikeState, (s, k) => s.assign({ x: k.x, y: k.y, big: k.big, live: k.respawnAt === null, radius: spikeRadius(k) }));
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

/** Everything the clients see, refreshed before each patch. preGoS = warm-up/3-2-1 seconds left. */
export function syncState(state: MatchState, w: World, roomTick: number, preGoS: number | null): void {
  const view = matchView(w);
  state.timeLeftS = Math.max(0, Math.ceil(preGoS ?? view.timeLeftS));
  state.tick = roomTick;
  state.rateTier = view.rateTier;
  state.arenaW = w.arena.w;
  state.arenaH = w.arena.h;
  if (state.leaderboard.join() !== view.leaderboard.join()) {
    state.leaderboard.clear();
    state.leaderboard.push(...view.leaderboard);
  }
  syncBlobs(state, w);
  syncWorld(state, w);
}
