// One match: WARMUP (ghosts, nothing charged) -> COUNTDOWN 3-2-1 -> GO -> LIVE 90 s -> ENDED
// -> settle -> dispose. Every timer reads this.phase. Registered as "match" (public, by mode)
// and "private" (also by 4-letter roomCode), so a public joinOrCreate never lands in a friend's room.
// Rules live in @margin/core; this shell owns sockets, timers, credits and the log.
import { randomInt } from "node:crypto";
import { Room, type Client } from "colyseus";
import {
  R,
  TICK_MS,
  addPlayer,
  matchT,
  newWorld,
  removePlayer,
  startMatch,
  step,
  sToTicks,
  toUnits,
  type Brain,
  type GameEventMsg,
  type Phase,
  type PlayerSeed,
  type World,
} from "@margin/core";
import { agentView, createBrain } from "../agents";
import { sharedDb } from "../db";
import { settlementFor } from "../settlement";
import { admitFree, chargeEntry } from "./freeMatch";
import { InputQueue } from "./input";
import { MatchRecord } from "./matchRecord";
import { agentFill, parseRoomKey, warmupNext, type RoomKey } from "./lobby";
import { MatchState, syncState } from "./schema";

const WARMUP_TICKS = sToTicks(R.WARMUP_S);
const PAID_WAIT_TICKS = sToTicks(R.PAID_WAIT_S);
const COUNTDOWN_TICKS = sToTicks(R.COUNTDOWN_S);
const LATE_JOIN_TICKS = sToTicks(R.LATE_JOIN_S);
/** Results stay on screen this long before the room closes. */
const ENDED_HOLD_TICKS = sToTicks(5);
const MAX_CATCHUP_TICKS = 10;
const LOG_FLUSH_TICKS = sToTicks(5);

/** Set when SIGTERM arrives: no new matches start while LIVE ones finish (drain deploys). */
export const drain = { on: false };

export class MatchRoom extends Room {
  override state = new MatchState();
  override maxClients = R.ROOM_SIZE;
  override patchRate = 1000 / R.SEND_HZ;
  /** Far above the 30/s game limit: only a broken or hostile client hits this and gets dropped. */
  override maxMessagesPerSecond = 120;

  private phase: Phase = "WARMUP";
  private phaseTick = 0;
  private roomTick = 0;
  private readonly seed = randomInt(2 ** 31);
  /** Warm-up world for ghosts; replaced at GO by one sized for the final head count. */
  private world!: World;
  private log!: MatchRecord;
  private settled = false;
  private inputs = new InputQueue();
  /** Agent seats only (humans get null from createBrain and are never stored). */
  private brains = new Map<string, Brain>();
  private lastMe = new Map<string, string>();
  /** Blob id (= sessionId) to credits user id, humans in free rooms only. */
  private users = new Map<string, string>();
  private key: RoomKey = { mode: "free", roomCode: null };
  private startNow = false;
  private joined = 0;
  private owedMs = 0;

  private get started(): boolean {
    return this.world.goTick >= 0;
  }

  override onCreate(opts: unknown): void {
    if (drain.on) throw new Error("server is restarting, try again in a moment");
    this.key = parseRoomKey(opts);
    if (this.roomName === "private" && !this.key.roomCode) throw new Error("private room needs a 4-letter roomCode");
    if (this.roomName !== "private") this.key.roomCode = null;
    this.world = newWorld(this.seed, this.key.mode, [], this.roomId);
    const db = sharedDb();
    this.log = new MatchRecord(db, this.roomId, this.key.mode, settlementFor(this.key.mode, db, this.users));
    this.state.mode = this.key.mode;
    this.onMessage("input", (client, msg: unknown) => this.inputs.push(client.sessionId, msg, Date.now()));
    this.onMessage("startNow", () => (this.startNow = true));
    // Fixed timestep: timers fire late under load, so run as many ticks as wall time owes
    // (capped, so a long stall can't freeze the loop) and a match is always 90 real seconds.
    this.setSimulationInterval((dtMs) => {
      this.owedMs = Math.min(this.owedMs + dtMs, MAX_CATCHUP_TICKS * TICK_MS);
      while (this.owedMs >= TICK_MS) {
        this.owedMs -= TICK_MS;
        this.tick();
      }
    }, TICK_MS);
  }

  /** filterBy skips options a client leaves out, so re-check mode and code here. */
  override onAuth(_client: Client, opts: unknown): string | true {
    const k = parseRoomKey(opts);
    if (k.mode !== this.key.mode) throw new Error(`mode mismatch: pass { mode: "${this.key.mode}" }`);
    if (this.key.roomCode && k.roomCode !== this.key.roomCode) throw new Error("wrong room code");
    // Free: the user id becomes client.auth. Paid admission (ticket check) lands with S6.
    return this.key.mode === "free" ? admitFree(sharedDb(), opts) : true;
  }

  override onJoin(client: Client, _opts: unknown, auth?: string | true): void {
    const id = client.sessionId;
    const p: PlayerSeed = { id, kind: "human", label: `Player ${++this.joined}`, accountId: null };
    if (this.started) {
      // Late join (free, first 15 s): pay now, then core charges the pot and shields 10 s.
      if (typeof auth !== "string" || !chargeEntry(sharedDb(), auth, this.roomId)) {
        client.leave(4001, "not enough credits");
        return;
      }
      addPlayer(this.world, p, this.roomTick);
      this.log.seat(auth, id);
    } else {
      addPlayer(this.world, p);
    }
    if (typeof auth === "string") this.users.set(id, auth);
    this.inputs.open(id);
    this.countHeads();
  }

  /** Honest lobby counter: "5/12 · 2 humans · 3 agents". */
  private countHeads(): void {
    const all = [...this.world.blobs.values()];
    this.state.humans = all.filter((b) => b.kind === "human").length;
    this.state.agents = all.filter((b) => b.kind === "agent").length;
  }

  /** Dropped mid-match: the blob stays where it is, input expires, still poppable, seat held. */
  override onDrop(client: Client): void {
    if (!this.started) return; // before GO leaving is free: onLeave runs next
    this.inputs.close(client.sessionId);
    const ticksLeft = sToTicks(R.MATCH_S) - matchT(this.world, this.roomTick) + ENDED_HOLD_TICKS;
    this.allowReconnection(client, Math.max(1, Math.ceil(ticksLeft / R.TICK_HZ)));
  }

  override onReconnect(client: Client): void {
    this.inputs.open(client.sessionId);
    this.lastMe.delete(client.sessionId);
  }

  /** Drain: before GO nobody was charged, so close; LIVE rooms play out, settle and close. */
  override onBeforeShutdown(): void {
    if (!this.started) void this.disconnect();
  }

  override onLeave(client: Client): void {
    const id = client.sessionId;
    this.inputs.close(id);
    if (this.started) return; // after GO the blob stays in the arena
    this.users.delete(id);
    removePlayer(this.world, id);
    this.countHeads();
  }

  private tick(): void {
    this.roomTick++;
    this.phaseTick++;
    const w = this.world;
    const inputs = this.inputs.take();
    // Agents see only their own screen (agentView) and answer like a client would.
    for (const [id, brain] of this.brains) {
      const view = agentView(w, id);
      if (view) inputs.set(id, brain.decide(view, this.roomTick));
    }
    const events = step(w, inputs, this.roomTick);
    for (const ev of events) this.broadcast("ev", ev);
    switch (this.phase) {
      case "WARMUP": {
        const humans = this.state.humans;
        const next = warmupNext({ mode: this.key.mode, humans, phaseTick: this.phaseTick, startNow: this.startNow });
        if (next === "close") void this.disconnect();
        if (next === "countdown") this.countdown();
        break;
      }
      case "COUNTDOWN":
        if (this.phaseTick >= COUNTDOWN_TICKS) this.go();
        break;
      case "LIVE":
        this.log.drain(w);
        if (this.phaseTick % LOG_FLUSH_TICKS === 0) this.log.flush();
        if (this.key.mode === "free" && this.phaseTick === LATE_JOIN_TICKS) void this.lock();
        if (w.phase === "ENDED") {
          this.enter("ENDED", false); // core already sent the ENDED phase event
          void this.settle();
        }
        break;
      case "ENDED":
        if (this.phaseTick >= ENDED_HOLD_TICKS && this.settled) void this.disconnect();
        break;
    }
  }

  /** Lock the room; free rooms fill the empty seats with labelled agents who appear for the 3-2-1. */
  private countdown(): void {
    void this.lock();
    if (this.key.mode === "free") for (const p of agentFill(this.state.humans)) addPlayer(this.world, p);
    this.world.phase = "COUNTDOWN";
    this.countHeads();
    this.enter("COUNTDOWN");
  }

  /** GO: charge, build the real world for this head count, seeded fair respawn. No vanishing after this. */
  private go(): void {
    // Entry is charged here and nowhere else; anyone who can no longer pay is sent home uncharged.
    for (const [id, userId] of this.users) {
      if (chargeEntry(sharedDb(), userId, this.roomId)) continue;
      this.users.delete(id);
      removePlayer(this.world, id);
      this.clients.getById(id)?.leave(4001, "not enough credits");
    }
    const players = [...this.world.blobs.values()].map(({ id, kind, label, accountId }) => ({ id, kind, label, accountId }));
    this.world = newWorld(this.seed, this.key.mode, players, this.roomId);
    startMatch(this.world, this.roomTick);
    for (const b of this.world.blobs.values()) {
      const brain = createBrain(b, this.seed);
      if (brain) this.brains.set(b.id, brain);
    }
    this.autoDispose = false;
    if (this.key.mode === "free") void this.unlock(); // late joins for 15 s
    this.log.drain(this.world);
    this.log.open(this.world, this.seed, this.users);
    this.enter("LIVE");
  }

  private async settle(): Promise<void> {
    await this.log.settle(this.world);
    this.settled = true;
  }

  private enter(phase: Phase, announce = true): void {
    this.phase = phase;
    this.phaseTick = 0;
    this.state.phase = phase;
    const ev: GameEventMsg = { type: "phase", phase, tick: this.roomTick };
    if (announce) this.broadcast("ev", ev);
  }

  override onBeforePatch(): void {
    const w = this.world;
    const left =
      this.phase === "WARMUP" ? (this.key.mode === "paid" ? PAID_WAIT_TICKS : WARMUP_TICKS) - this.phaseTick
      : this.phase === "COUNTDOWN" ? COUNTDOWN_TICKS - this.phaseTick
      : 0;
    syncState(this.state, w, this.roomTick, this.started ? null : left / R.TICK_HZ);
    for (const c of this.clients) {
      const b = w.blobs.get(c.sessionId);
      if (!b) continue;
      const me = { owe: toUnits(b.debt), ratePerMinBps: w.ratePerMinBps };
      const key = `${me.owe}|${me.ratePerMinBps}`;
      if (this.lastMe.get(c.sessionId) === key) continue;
      this.lastMe.set(c.sessionId, key);
      c.send("me", me);
    }
  }
}
