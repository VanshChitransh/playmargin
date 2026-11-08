// One match: WARMUP (ghosts, nothing charged) -> COUNTDOWN 3-2-1 -> GO (seeded fair respawn)
// -> LIVE 90 s -> ENDED -> dispose. Every timer reads this.phase, nothing else (RULES: Warm-up).
// The engine runs only in LIVE; before GO players are ghosts that just move.
import { randomInt } from "node:crypto";
import { Room, type Client } from "colyseus";
import {
  R,
  TICK_MS,
  move,
  sToTicks,
  toUnits,
  type Blob,
  type GameEventMsg,
  type InputCmd,
  type Phase,
  type World,
} from "@margin/core";
// Swap to @margin/core once C3 (newWorld/step) lands on main.
import { ARENA, makeBlob, newWorld, step } from "../engine/stub";
import { RateLimit, parseInput } from "./input";
import { MatchState, leaderboard, syncBlobs, syncWorld } from "./schema";

const WARMUP_TICKS = sToTicks(R.WARMUP_S);
const COUNTDOWN_TICKS = sToTicks(R.COUNTDOWN_S);
const INPUT_EXPIRE_TICKS = sToTicks(R.INPUT_EXPIRE_MS / 1000);
const LEADERBOARD_EVERY = sToTicks(1 / R.LEADERBOARD_HZ);
/** Results stay on screen this long before the room closes. */
const ENDED_HOLD_TICKS = sToTicks(5);
const DT_S = 1 / R.TICK_HZ;

interface Pending {
  cmd: InputCmd;
  at: number;
  boost: boolean;
  repay: boolean;
  cashout: boolean;
}

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
  private ghosts = new Map<string, Blob>();
  private world: World | null = null;
  private pending = new Map<string, Pending>();
  private limits = new Map<string, RateLimit>();
  private lastOwe = new Map<string, number>();

  override onCreate(): void {
    this.state.mode = "free";
    this.onMessage("input", (client, msg: unknown) => this.onInput(client, msg));
    this.setSimulationInterval(() => this.tick(), TICK_MS);
  }

  override onJoin(client: Client): void {
    const id = client.sessionId;
    this.limits.set(id, new RateLimit());
    const p = { id, kind: "human" as const, label: `Player ${this.ghosts.size + 1}`, accountId: null };
    this.ghosts.set(id, makeBlob(p, Math.random() * ARENA.w, Math.random() * ARENA.h, "free"));
  }

  override onLeave(client: Client): void {
    const id = client.sessionId;
    this.limits.delete(id);
    this.pending.delete(id);
    // Before GO leaving is free; after GO the blob stays and stays poppable (S4 adds reconnection).
    this.ghosts.delete(id);
  }

  private onInput(client: Client, msg: unknown): void {
    if (!this.limits.get(client.sessionId)?.allow(Date.now())) return;
    const cmd = parseInput(msg);
    if (!cmd) return;
    const prev = this.pending.get(client.sessionId);
    // Taps are edge-triggered: OR them until a tick consumes them, so none is lost between ticks.
    this.pending.set(client.sessionId, {
      cmd,
      at: this.roomTick,
      boost: cmd.boost || (prev?.boost ?? false),
      repay: cmd.repay || (prev?.repay ?? false),
      cashout: cmd.cashout || (prev?.cashout ?? false),
    });
  }

  /** This tick's commands: direction expires after INPUT_EXPIRE_MS, taps fire once. */
  private takeInputs(): Map<string, InputCmd> {
    const out = new Map<string, InputCmd>();
    for (const [id, p] of this.pending) {
      const fresh = this.roomTick - p.at <= INPUT_EXPIRE_TICKS;
      out.set(id, {
        seq: p.cmd.seq,
        dirX: fresh ? p.cmd.dirX : 0,
        dirY: fresh ? p.cmd.dirY : 0,
        boost: p.boost,
        repay: p.repay,
        cashout: p.cashout,
      });
      p.boost = p.repay = p.cashout = false;
    }
    return out;
  }

  private tick(): void {
    this.roomTick++;
    this.phaseTick++;
    const inputs = this.takeInputs();
    switch (this.phase) {
      case "WARMUP":
      case "COUNTDOWN":
        for (const g of this.ghosts.values()) {
          const cmd = inputs.get(g.id);
          g.dirX = cmd?.dirX ?? 0;
          g.dirY = cmd?.dirY ?? 0;
          move(g, DT_S, 0, ARENA);
        }
        if (this.phase === "WARMUP" && this.phaseTick >= WARMUP_TICKS) {
          void this.lock();
          this.enter("COUNTDOWN");
        } else if (this.phase === "COUNTDOWN" && this.phaseTick >= COUNTDOWN_TICKS) {
          this.go();
        }
        break;
      case "LIVE": {
        const w = this.world!;
        for (const ev of step(w, inputs, w.tick + 1)) this.broadcast("ev", ev);
        if (this.roomTick % LEADERBOARD_EVERY === 0) {
          this.state.leaderboard.clear();
          this.state.leaderboard.push(...leaderboard(w.blobs.values()));
        }
        if (w.phase === "ENDED") this.enter("ENDED");
        break;
      }
      case "ENDED":
        // Settlement (S5) slots in here; until then the room just closes after the results hold.
        if (this.phaseTick >= ENDED_HOLD_TICKS) void this.disconnect();
        break;
    }
  }

  /** GO: seeded fair respawn of everyone still here; from now on the room must not vanish. */
  private go(): void {
    const players = [...this.ghosts.values()].map(({ id, kind, label, accountId }) => ({ id, kind, label, accountId }));
    this.world = newWorld(this.seed, "free", players);
    this.ghosts.clear();
    this.autoDispose = false;
    this.enter("LIVE");
  }

  private enter(phase: Phase): void {
    this.phase = phase;
    this.phaseTick = 0;
    this.state.phase = phase;
    const ev: GameEventMsg = { type: "phase", phase, tick: this.world?.tick ?? 0 };
    this.broadcast("ev", ev);
  }

  override onBeforePatch(): void {
    const left = {
      WARMUP: WARMUP_TICKS - this.phaseTick,
      COUNTDOWN: COUNTDOWN_TICKS - this.phaseTick,
      LIVE: sToTicks(R.MATCH_S) - (this.world?.tick ?? 0),
      ENDED: 0,
    }[this.phase];
    this.state.timeLeftS = Math.max(0, Math.ceil(left / R.TICK_HZ));
    const w = this.world;
    if (!w) {
      syncBlobs(this.state, this.ghosts.values(), 0);
      return;
    }
    syncBlobs(this.state, w.blobs.values(), w.tick);
    syncWorld(this.state, w);
    for (const c of this.clients) {
      const b = w.blobs.get(c.sessionId);
      if (!b) continue;
      const owe = toUnits(b.debt);
      if (this.lastOwe.get(c.sessionId) !== owe) {
        this.lastOwe.set(c.sessionId, owe);
        c.send("me", { owe });
      }
    }
  }
}
