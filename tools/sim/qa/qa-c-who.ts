// QA-C: per-player outcome in a match by label prefix (start 80, payout, fate) from the log.
import { MICRO, type LogEntry } from "@margin/core";
import { receiptFromLog } from "../../../apps/client/src/game/receipt";
const base = `http://localhost:${process.env.QA_PORT ?? 2601}`;
const [id, prefix = ""] = process.argv.slice(2);
const { log } = (await (await fetch(`${base}/api/matches/${id}/log`)).json()) as { log: LogEntry[] };
for (const e of log) if (e.type === "JOIN" && e.data.player.label.startsWith(prefix)) {
  const r = receiptFromLog(log, e.data.player.id);
  console.log(JSON.stringify({ who: e.data.player.label, kind: r?.kind, fate: r?.fate, aliveS: r?.aliveS, start: r?.start, end: r && +r.end.toFixed(2), lines: r?.lines.map((l) => `${l.label} ${l.amount.toFixed(2)}`) }));
}
const keepers = log.filter((e) => e.type === "KEEPER_POP").map((e) => ({ victim: e.data.victim, tick: e.tick, debtRepaid: e.data.debtRepaid / MICRO, badDebt: e.data.badDebt / MICRO }));
if (keepers.length) console.log(JSON.stringify({ keepers }));
