// QA-C rule analyzer: reads finished match logs from the server and checks rule facts per match.
// Usage: QA_PORT=2601 npx tsx tools/sim/qa/qa-c-rules.ts <matchId>...
import { BELL_BONUS_CAP_BPS, MICRO, R, mulBps, type LogEntry } from "@margin/core";

const base = `http://localhost:${process.env.QA_PORT ?? 2601}`;
const u = (x: number) => +(x / MICRO).toFixed(4);
for (const id of process.argv.slice(2)) {
  const { log } = (await (await fetch(`${base}/api/matches/${id}/log`)).json()) as { log: LogEntry[] };
  const go = log.find((e) => e.type === "MATCH_START")!.tick;
  const end = log.at(-1)!;
  const s = (t: number) => +((t - go) / R.TICK_HZ).toFixed(2);
  const kinds = new Map<string, string>();
  const labels = new Map<string, string>();
  for (const e of log) if (e.type === "JOIN") (kinds.set(e.data.player.id, e.data.player.kind), labels.set(e.data.player.id, e.data.player.label));
  const out: Record<string, unknown> = { id, players: [...kinds.values()].reduce((a, k) => ({ ...a, [k]: ((a as Record<string, number>)[k] ?? 0) + 1 }), {}) };
  // Mid-match cash-outs: tick relative to GO (the window is 45 to 80 s to START, plus a 4 s channel).
  const first = new Map<string, LogEntry>();
  for (const e of log) if (e.type === "CASHOUT" && !first.has(e.data.blob)) first.set(e.data.blob, e);
  out.midCashouts = [...first.values()].filter((e) => e.tick < end.tick).map((e) => ({ who: labels.get((e.data as { blob: string }).blob), atS: s(e.tick) }));
  out.cashoutOutsideWindow = (out.midCashouts as Array<{ atS: number }>).filter((c) => c.atS < R.CASHOUT_OPEN_S + R.CASHOUT_CHANNEL_S || c.atS > R.CASHOUT_CLOSE_S + R.CASHOUT_CHANNEL_S);
  // Human-on-human eats (collusion / borrow-and-feed) with the debt repaid first.
  out.humanEats = log.filter((e) => e.type === "EAT" && kinds.get(e.data.victim) === "human" && kinds.get(e.data.by) === "human").map((e) => {
    const d = e.data as { by: string; victim: string; debtRepaid: number; gained: number; scattered: number; badDebt: number };
    return { atS: s(e.tick), by: labels.get(d.by), victim: labels.get(d.victim), debtRepaid: u(d.debtRepaid), gained: u(d.gained), scattered: u(d.scattered), badDebt: u(d.badDebt), gainedShare: +(d.gained / Math.max(1, d.gained + d.scattered)).toFixed(3) };
  });
  // Agent eats a human: must be at or after 30 s past max(GO, that human's charge).
  const charged = new Map<string, number>();
  for (const e of log) if (e.type === "CHARGE") charged.set(e.data.blob, e.tick);
  out.agentEatsHumanEarly = log.filter((e) => e.type === "EAT" && kinds.get(e.data.victim) === "human" && kinds.get(e.data.by) === "agent").map((e) => ({ atS: s(e.tick), sinceJoinS: +((e.tick - Math.max(go, charged.get((e.data as { victim: string }).victim) ?? go)) / R.TICK_HZ).toFixed(2) })).filter((x) => x.sinceJoinS < R.AGENT_NO_EAT_HUMAN_S);
  // Spikes never pop: no POP or KEEPER_POP on the same tick as a SPIKE for that blob.
  const spikeTicks = new Set(log.filter((e) => e.type === "SPIKE").map((e) => `${e.data.blob}@${e.tick}`));
  out.spikeHits = spikeTicks.size;
  out.popOnSpikeTick = log.filter((e) => (e.type === "KEEPER_POP" || e.type === "POP") && spikeTicks.has(`${(e.data as { victim: string }).victim}@${e.tick}`)).length;
  out.keeperPops = log.filter((e) => e.type === "KEEPER_POP").length;
  // Bell: the cap holds for every survivor.
  const bell = new Map<string, number[]>();
  for (const e of log) if (e.type === "CASHOUT" && e.tick === end.tick) bell.set(e.data.blob, [...(bell.get(e.data.blob) ?? []), e.data.amount]);
  out.bell = [...bell].map(([b, [eq = 0, share = 0]]) => ({ who: labels.get(b), equity: u(eq), share: u(share), capOk: share <= mulBps(eq, BELL_BONUS_CAP_BPS) }));
  const me = end.type === "MATCH_END" ? end.data : null;
  out.toVault = me ? u(me.toVault) : null;
  out.rankingFirst = me?.ranking.slice(0, 3).map((b) => labels.get(b));
  console.log(JSON.stringify(out));
}
