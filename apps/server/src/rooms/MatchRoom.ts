// One match: WARMUP (ghosts, nothing charged) -> COUNTDOWN 3-2-1 -> GO -> LIVE 90 s -> ENDED
// -> settle -> dispose. Every timer reads this.phase. Registered as "match" (public, by mode)
// and "private" (also by 4-letter roomCode), so a public joinOrCreate never lands in a friend's room.
// "judge" is the Judge Run: one human, the published JUDGE_SEED, judgeLineup and applyJudgeLayout.
// Rules live in @margin/core; this shell owns sockets, timers, credits and the log.
import { randomInt } from "node:crypto";
import { Room, type Client } from "colyseus";
import {
  JUDGE_SEED,
  R,
  TICK_MS,
  addPlayer,
  applyJudgeLayout,
  cleanName,
  judgeLineup,
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
import { Commander, agentView, createBrain, nearAiCall } from "../agents";
import { sharedDb, userForAccount } from "../db";
import { displayLabel } from "./label";
import { socialName } from "../social/profile";
import { settlementFor, sharedChain } from "../settlement";
import { admitFree, chargeEntry } from "./freeMatch";
import { admitPaid, refundTickets, seatedAccounts } from "./paidMatch";
import { boundStake, paidStakeBase, wrongStake } from "../settlement/stake";
import type { Chain } from "../settlement/chain";
import { InputQueue } from "./input";
import { clientIp, joinLimit, rooms } from "./guard";
import { log, ticks } from "../obs";
import { MatchRecord } from "./matchRecord";
import { agentFill, droneFill, parseRoomKey, warmupNext, type RoomKey } from "./lobby";
import { MatchState, syncState } from "./schema";

const WARMUP_TICKS = sToTicks(R.WARMUP_S);
const PAID_WAIT_TICKS = sToTicks(R.PAID_WAIT_S);
const COUNTDOWN_TICKS = sToTicks(R.COUNTDOWN_S);
const LATE_JOIN_TICKS = sToTicks(R.LATE_JOIN_S);
/** Results stay on screen this long before the room closes. */
const ENDED_HOLD_TICKS = sToTicks(5);
const MAX_CATCHUP_TICKS = 10;
const LOG_FLUSH_TICKS = sToTicks(5);
/** Test-only fast forward (e2e:local runs a 90 s match in ~25 s). Ignored in production. */
const SIM_SPEED = process.env.NODE_ENV === "production" ? 1 : Math.max(1, Number(process.env.SIM_SPEED ?? 1));

/** Set when SIGTERM arrives: no new matches start while LIVE ones finish (drain deploys). */
export const drain = { on: false };

/** Seconds a private lobby keeps a dropped seat (a reload takes about 2 s). */
const LOBBY_HOLD_S = 20;

export class MatchRoom extends Room {
  override state = new MatchState();
  override maxClients: number = R.ROOM_SIZE;
  override patchRate = 1000 / R.SEND_HZ;
  /** Far above the 30/s game limit: only a broken or hostile client hits this and gets dropped. */
  override maxMessagesPerSecond = 120;

  private phase: Phase = "WARMUP";
  private phaseTick = 0;
  private roomTick = 0;
  private seed = randomInt(2 ** 31);
  /** Judge Run room: a single human against the published scenario, no late joins. */
  private judge = false;
  /** Warm-up world for ghosts; replaced at GO by one sized for the final head count. */
  private world!: World;
  private log!: MatchRecord;
  private settled = false;
  private inputs = new InputQueue();
  /** Agent seats only (humans get null from createBrain and are never stored). */
  private brains = new Map<string, Brain>();
  /** NEAR AI strategist for this room's agents, only when NEAR_AI_API_KEY is set. Never blocks a tick. */
  private commander = process.env.NEAR_AI_API_KEY ? new Commander(nearAiCall(process.env.NEAR_AI_API_KEY)) : null;
  private lastRationale: string | null = null;
  private lastMe = new Map<string, string>();
  /** Blob id (= sessionId) to credits user id, humans in free rooms only. */
  private users = new Map<string, string>();
  /** Guest users holding a seat here (claimed in onAuth): one seat per guest, so a second tab or a
   *  reload during late join can't double-charge or seat the same user twice. */
  private guests = new Set<string>();
  /** Watch-only clients (#/watch): full state and events, no blob, no charge, no DB row, no input. */
  private spectators = new Set<string>();
  /** Paid accounts this room holds in seatedAccounts; released on leave before GO and on dispose. */
  private accounts = new Set<string>();
  /** Paid: open_match on chain, started at the 3-2-1. GO waits for it, a failure aborts the room. */
  private opening: "none" | "pending" | "ok" | "failed" = "none";
  /** Paid: the contract's entry stake (USDC base units), read fresh at the 3-2-1. Free rooms ignore it. */
  private stakeBase = 1_000_000;
  /** open_match landed: tickets are bound, so only reclaim (not refund_ticket) frees them. */
  private bound = false;
  private key: RoomKey = { mode: "free", roomCode: null };
  private startNow = false;
  private joined = 0;
  /** True once onCreate finished and rooms.live counts this room. */
  private counted = false;
  private owedMs = 0;

  /** Paid roster is final from the 3-2-1 on: open_match names exactly these accounts. */
  private get paidLocked(): boolean {
    return this.key.mode === "paid" && this.phase === "COUNTDOWN";
  }

  private get started(): boolean {
    return this.world.goTick >= 0;
  }

  override onCreate(opts: unknown): void {
    if (drain.on) throw new Error("server is restarting, try again in a moment");
    if (rooms.live >= rooms.max) throw new Error("all arenas are full, try again in a minute");
    this.key = parseRoomKey(opts);
    if (this.roomName === "private" && !this.key.roomCode) throw new Error("private room needs a 4-letter roomCode");
    if (this.roomName !== "private") this.key.roomCode = null;
    if (this.roomName === "judge") {
      this.judge = true;
      this.key = { mode: "free", roomCode: null };
      this.maxClients = 1;
      this.seed = JUDGE_SEED;
    }
    this.world = newWorld(this.seed, this.key.mode, [], this.roomId);
    const db = sharedDb();
    this.log = new MatchRecord(db, this.roomId, this.key.mode, settlementFor(this.key.mode, db, this.users));
    this.state.mode = this.key.mode;
    this.onMessage("input", (client, msg: unknown) => this.inputs.push(client.sessionId, msg, Date.now()));
    // Private rooms: only the host starts, and only with a friend in (lobby.ts checks the count again).
    this.onMessage("startNow", (client) => {
      // Ignored while alone too, so an early tap can't auto-start the moment a friend joins.
      if (this.key.roomCode && (client.sessionId !== this.state.host || this.state.humans < R.PAID_MIN_HUMANS)) return;
      this.startNow = true;
    });
    // Fixed timestep: timers fire late under load, so run as many ticks as wall time owes
    // (capped, so a long stall can't freeze the loop) and a match is always 90 real seconds.
    this.setSimulationInterval((dtMs) => {
      this.owedMs = Math.min(this.owedMs + dtMs * SIM_SPEED, MAX_CATCHUP_TICKS * TICK_MS);
      while (this.owedMs >= TICK_MS) {
        this.owedMs -= TICK_MS;
        const t0 = performance.now();
        this.tick();
        ticks.record(performance.now() - t0);
      }
    }, TICK_MS);
    // Counted last and only here: Colyseus 0.17 still runs onDispose for a create that threw above
    // (refused by the cap, a bad room code, paid off), so onDispose must only undo a counted room.
    rooms.live++;
    this.counted = true;
  }

  /** filterBy skips options a client leaves out, so re-check mode and code here. */
  override async onAuth(
    _client: Client,
    opts: unknown,
    ctx?: { ip?: string | string[] },
  ): Promise<string | { accountId: string; name?: string | null } | { spectator: true }> {
    if (!joinLimit.allow(clientIp(ctx))) throw new Error("too many joins, slow down");
    // Spectators only watch public free rooms: private codes and paid tickets stay private.
    if ((opts as { spectate?: unknown } | null)?.spectate === true) {
      if (this.key.mode !== "free" || this.key.roomCode || this.judge) throw new Error("only public free rooms can be watched");
      return { spectator: true };
    }
    const k = parseRoomKey(opts);
    if (k.mode !== this.key.mode) throw new Error(`mode mismatch: pass { mode: "${this.key.mode}" }`);
    if (this.key.roomCode && k.roomCode !== this.key.roomCode) throw new Error("wrong room code");
    // Free: the credits user id. Paid: the NEAR account holding a live ticket (one seat each).
    if (this.key.mode === "free") {
      const userId = admitFree(sharedDb(), opts);
      if (this.guests.has(userId)) throw new Error("you are already in this match");
      this.guests.add(userId);
      return userId;
    }
    const paid = await admitPaid(opts);
    const name = await socialName(paid.accountId); // near.social display name (mainnet), null keeps the account
    // Claimed synchronously after the last await, so two parallel joins can't both pass.
    if (seatedAccounts.has(paid.accountId)) throw new Error("this account is already in a match");
    seatedAccounts.add(paid.accountId);
    this.accounts.add(paid.accountId);
    return { ...paid, name };
  }

  override onJoin(client: Client, opts: unknown, auth?: string | { accountId: string; name?: string | null } | { spectator: true }): void {
    const id = client.sessionId;
    if (typeof auth === "object" && "spectator" in auth) {
      this.spectators.add(id);
      client.send("commander", { rationale: this.lastRationale });
      this.publish();
      return;
    }
    const accountId = typeof auth === "object" ? auth.accountId : null;
    // Paid seats show their near.social name or the real account (both verified); free players pick a
    // name (cleaned: shown to all and to the agents' LLM).
    const name = typeof auth === "object" ? (auth.name ?? auth.accountId) : cleanName((opts as { name?: unknown } | null)?.name);
    const p: PlayerSeed = { id, kind: "human", label: displayLabel(name ?? `Player ${++this.joined}`), accountId };
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
    if (this.lastRationale) client.send("commander", { rationale: this.lastRationale });
    this.countHeads();
  }

  /** Honest lobby counter: "5/12 · 2 humans · 3 agents". */
  private countHeads(): void {
    const all = [...this.world.blobs.values()];
    this.state.humans = all.filter((b) => b.kind === "human").length;
    this.state.agents = all.filter((b) => b.kind === "agent").length;
    // Host = earliest human still here (Map keeps join order), so a leaving host hands it on.
    this.state.host = this.key.roomCode ? (all.find((b) => b.kind === "human")?.id ?? "") : "";
    this.state.privateRoom = !!this.key.roomCode;
    this.publish();
  }

  /** Dropped mid-match: the blob stays where it is, input expires, still poppable, seat held. */
  /** Listing metadata, read by GET /api/watch to pick the busiest public free room. */
  private publish(): void {
    void this.setMetadata({
      mode: this.key.mode, public: !this.key.roomCode && !this.judge, phase: this.phase,
      humans: this.state.humans, spectators: this.spectators.size,
    });
  }

  override onDrop(client: Client): void {
    if (this.spectators.has(client.sessionId)) return; // watchers just rejoin, nothing to hold
    // Before GO leaving is free (onLeave runs next), except a paid 3-2-1: the ticket is being bound.
    // A private lobby holds a dropped seat briefly, so a reload keeps the blob and the host role
    // (host = earliest human still here) instead of handing START to whoever joined next.
    if (!this.started && !this.paidLocked) {
      if (this.key.roomCode) {
        this.inputs.close(client.sessionId);
        this.allowReconnection(client, LOBBY_HOLD_S);
      }
      return;
    }
    this.inputs.close(client.sessionId);
    const ticksLeft = (this.started ? sToTicks(R.MATCH_S) - matchT(this.world, this.roomTick) : sToTicks(R.MATCH_S + 20)) + ENDED_HOLD_TICKS;
    this.allowReconnection(client, Math.max(1, Math.ceil(ticksLeft / R.TICK_HZ)));
  }

  override onReconnect(client: Client): void {
    this.inputs.open(client.sessionId);
    this.lastMe.delete(client.sessionId);
  }

  override onDispose(): void {
    if (this.counted) rooms.live--;
    for (const a of this.accounts) seatedAccounts.delete(a);
  }

  /** Drain: before GO nobody was charged, so close; LIVE rooms play out, settle and close. */
  override onBeforeShutdown(): void {
    if (!this.started) void this.disconnect();
  }

  override onLeave(client: Client): void {
    const id = client.sessionId;
    if (this.spectators.delete(id)) return void this.publish();
    this.inputs.close(id);
    if (this.started || this.paidLocked) return; // after GO (paid: after the 3-2-1) the blob stays
    this.guests.delete(this.users.get(id) ?? "");
    this.users.delete(id);
    const acc = this.world.blobs.get(id)?.accountId;
    if (acc) (seatedAccounts.delete(acc), this.accounts.delete(acc));
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
    this.commander?.update(w, this.roomTick, this.brains);
    const why = this.commander?.rationale ?? null;
    if (why !== this.lastRationale) {
      this.lastRationale = why;
      this.broadcast("commander", { rationale: why });
    }
    const events = step(w, inputs, this.roomTick);
    for (const ev of events) this.broadcast("ev", ev);
    switch (this.phase) {
      case "WARMUP": {
        const humans = this.state.humans;
        const next = warmupNext({ mode: this.key.mode, private: !!this.key.roomCode, humans, phaseTick: this.phaseTick, startNow: this.startNow });
        if (next === "close") void this.disconnect();
        if (next === "countdown") this.countdown();
        break;
      }
      case "COUNTDOWN":
        if (this.phaseTick < COUNTDOWN_TICKS || this.opening === "pending") break;
        if (this.opening === "failed") this.abort();
        else this.goOnce();
        break;
      case "LIVE":
        this.log.drain(w);
        if (this.phaseTick % LOG_FLUSH_TICKS === 0) this.log.flush();
        if (this.key.mode === "free" && !this.judge && this.phaseTick === LATE_JOIN_TICKS) void this.lock();
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

  /** Lock the room; public free rooms fill the empty seats with labelled agents (private: friends only), paid rooms add liquidator drones. */
  private countdown(): void {
    void this.lock();
    const human = [...this.world.blobs.values()].find((b) => b.kind === "human");
    const fill = this.judge && human ? judgeLineup(human).slice(1) : this.key.mode === "free" ? (this.key.roomCode ? [] : agentFill(this.state.humans, this.seed)) : droneFill(this.state.humans);
    for (const p of fill) addPlayer(this.world, p);
    this.world.phase = "COUNTDOWN";
    if (this.key.mode === "paid") this.openOnChain();
    this.countHeads();
    this.enter("COUNTDOWN");
  }

  /** go() charges entries, so it must never run twice: an unexpected throw closes the room instead. */
  private goOnce(): void {
    try {
      this.go();
    } catch (err) {
      log.error("go_failed", { matchId: this.roomId, err });
      this.enter("ENDED", false);
      void this.disconnect();
    }
  }

  /** GO: charge, build the real world for this head count, seeded fair respawn. No vanishing after this. */
  private go(): void {
    // Entry is charged here and nowhere else; anyone who can no longer pay is sent home uncharged.
    for (const [id, userId] of this.users) {
      if (chargeEntry(sharedDb(), userId, this.roomId)) continue;
      this.users.delete(id);
      this.guests.delete(userId);
      removePlayer(this.world, id);
      this.clients.getById(id)?.leave(4001, "not enough credits");
    }
    const players = this.roster();
    this.world = newWorld(this.seed, this.key.mode, players, this.roomId, this.stakeBase);
    startMatch(this.world, this.roomTick);
    const human = players.find((p) => p.kind === "human");
    if (this.judge && human) applyJudgeLayout(this.world, human.id);
    for (const b of this.world.blobs.values()) {
      const brain = createBrain(b, this.seed);
      if (brain) this.brains.set(b.id, brain);
    }
    this.autoDispose = false;
    if (this.key.mode === "free" && !this.judge) void this.unlock(); // late joins for 15 s
    this.log.drain(this.world);
    this.log.open(this.world, this.seed, this.key.mode === "free" ? this.users : this.accountSeats(), this.opening === "ok");
    this.enter("LIVE");
  }

  /** Bind the tickets and reserve the vault budget during the 3-2-1, sized exactly as GO will be. */
  private openOnChain(): void {
    this.opening = "pending";
    const chain = sharedChain();
    const accounts = this.staked();
    const ready = async () => {
      if (!chain) throw new Error("paid mode is off");
      // Fresh stake, and every ticket must carry it: a mixed-stake match can never settle.
      this.stakeBase = await paidStakeBase(chain, true);
      const wrong = await wrongStake(chain, accounts, this.stakeBase);
      if (wrong.length) throw new Error(`tickets with another stake: ${wrong.join(", ")}`);
      await this.droneAccounts(chain);
      const preview = newWorld(this.seed, this.key.mode, this.roster(), this.roomId, this.stakeBase);
      startMatch(preview, 0);
      await this.log.reserve(preview);
      this.bound = true;
      // Settle at the stake open_match actually bound (a ticket can change after wrongStake).
      this.stakeBase = await boundStake(chain, accounts, this.roomId);
    };
    ready().then(
      () => (this.opening = "ok"),
      (err: unknown) => {
        log.error("open_failed", { matchId: this.roomId, err });
        this.opening = "failed";
      },
    );
  }

  /** open_match failed (vault low, ticket gone): nobody played, so refund every ticket and close. */
  private abort(): void {
    // Tickets bound to an open match only come back by reclaim after the deadline, not by refund.
    const reason = this.bound
      ? "The match could not start on NEAR. Reclaim your stake from your balance in 15 minutes."
      : "The match could not start on NEAR. Your stake is back in your balance.";
    this.broadcast("aborted", { reason });
    void (this.bound ? Promise.resolve() : refundTickets(this.staked())).finally(() => this.disconnect());
    this.enter("ENDED", false);
  }

  /** NEAR accounts holding a ticket in this room (drone accounts hold none). */
  private staked(): string[] {
    return [...this.world.blobs.values()].flatMap((b) => (b.accountId && b.kind !== "drone" ? [b.accountId] : []));
  }

  /** A7: drone-N.<contract> earns its bounties on chain, but only once the contract registered it. */
  private async droneAccounts(chain: Chain): Promise<void> {
    for (const b of this.world.blobs.values()) {
      if (b.kind !== "drone") continue;
      const account = `${b.id}.${chain.cfg.contractId}`;
      const ok = await chain.view<boolean>("is_agent", { account_id: account }).catch(() => false);
      b.accountId = ok === true ? account : null; // unregistered: the bounty goes to the reserve
    }
  }

  private roster(): PlayerSeed[] {
    return [...this.world.blobs.values()].map(({ id, kind, label, accountId }) => ({ id, kind, label, accountId }));
  }

  /** Paid seats: blob id to the user row of its NEAR account. */
  private accountSeats(): Map<string, string> {
    const db = sharedDb();
    const seats = new Map<string, string>();
    for (const b of this.world.blobs.values()) if (b.accountId && b.kind !== "drone") seats.set(b.id, userForAccount(db, b.accountId));
    return seats;
  }

  private async settle(): Promise<void> {
    await this.log.settle(this.world);
    this.settled = true;
  }

  private enter(phase: Phase, announce = true): void {
    this.phase = phase;
    this.phaseTick = 0;
    this.state.phase = phase;
    this.publish();
    const ev: GameEventMsg = { type: "phase", phase, tick: this.roomTick };
    if (announce) this.broadcast("ev", ev);
  }

  override onBeforePatch(): void {
    const w = this.world;
    const left =
      this.phase === "WARMUP" ? (this.key.roomCode ? 0 : (this.key.mode === "paid" ? PAID_WAIT_TICKS : WARMUP_TICKS) - this.phaseTick)
      : this.phase === "COUNTDOWN" ? Math.max(0, COUNTDOWN_TICKS - this.phaseTick)
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
