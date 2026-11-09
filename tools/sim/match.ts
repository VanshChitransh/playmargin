// One headless match driven by the real brains, shared by `npm run demo` and `npm run sim`.
// Same engine, same order and same log as a live room; only the clock and the sockets are fake.
import {
  appendLog, newWorld, R, startMatch, step, type GameEventMsg, type InputCmd, type LogEntry, type Mode, type PlayerSeed, type World,
} from "@margin/core";
import { agentView, createBrain, FreeBot } from "../../apps/server/src/agents/index";

export interface MatchOpts {
  seed: number;
  mode: Mode;
  /** Players that are not drones; paid rooms play them as FreeBot-driven "humans". */
  players: number;
  drones: number;
  /** Called after every tick with what clients would have seen. */
  onTick?: (w: World, tick: number, events: GameEventMsg[], logged: LogEntry[]) => void | Promise<void>;
}

const WARMUP_TICKS = R.WARMUP_S * R.TICK_HZ;

/** FNV-1a, so each bot-driven human gets its own stable seed. */
const fnv = (s: string): number => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;

/** Who plays: paid rooms are humans (bot-driven here) plus drones, free rooms are agents. */
export function lineup(o: MatchOpts): PlayerSeed[] {
  const kind = o.mode === "paid" ? "human" : "agent";
  const ps: PlayerSeed[] = Array.from({ length: o.players }, (_, i) => ({
    id: `${kind === "human" ? "player" : "agent"}-${i + 1}`,
    kind, label: kind === "human" ? `Player-${i + 1}` : `Agent-${i + 1}`,
    accountId: o.mode === "paid" ? `player-${i + 1}.testnet` : null,
  }));
  for (let i = 0; i < o.drones; i++) {
    ps.push({ id: `drone-${i + 1}`, kind: "drone", label: `Drone-${i + 1}`, accountId: `agent-${i + 1}.playmargin.testnet` });
  }
  return ps;
}

/** Play a whole match from warm-up to the bell. Returns the world, its chained log and tick count. */
export async function runMatch(o: MatchOpts): Promise<{ w: World; log: LogEntry[]; ticks: number }> {
  const w = newWorld(o.seed, o.mode, lineup(o), `${o.mode}-${o.seed}`);
  const brains = new Map([...w.blobs.values()].map((b) => [b.id, createBrain(b, o.seed) ?? new FreeBot((o.seed ^ fnv(b.id)) >>> 0)]));
  const log: LogEntry[] = [];
  let tick = 0;
  for (; w.phase !== "ENDED"; ) {
    tick++;
    let events: GameEventMsg[] = [];
    const inputs = new Map<string, InputCmd>();
    for (const [id, brain] of brains) {
      const v = agentView(w, id);
      if (v) inputs.set(id, brain.decide(v, tick));
    }
    if (tick === WARMUP_TICKS) startMatch(w, tick);
    else events = step(w, inputs, tick);
    const logged = await appendLog(log, w.pendingLog.splice(0));
    await o.onTick?.(w, tick, events, logged);
  }
  return { w, log, ticks: tick };
}
