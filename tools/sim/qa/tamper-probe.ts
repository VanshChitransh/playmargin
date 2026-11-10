// QA-C4: every tamper type through the Verify page's own runChecks, on a real match log from the
// QA server. "anchored" passes the honest head as if NEAR stored it.
import { hashEntry, type LogEntry } from "@margin/core";
import { runChecks } from "../../../apps/client/src/verify/checks";
const id = process.argv[2]!;
const { log } = (await (await fetch(`http://localhost:${process.env.QA_PORT ?? 2601}/api/matches/${id}/log`)).json()) as { log: LogEntry[] };
const honest = await runChecks(log, null);
const head = honest.result!.head;
const rehash = async (t: LogEntry[], from: number) => { for (let k = from; k < t.length; k++) { if (k > 0) t[k]!.prevHash = t[k - 1]!.hash; t[k]!.hash = await hashEntry(t[k]!); } return t; };
const at = (type: string) => log.findIndex((e) => e.type === type);
const cases: Array<[string, () => Promise<LogEntry[]>]> = [
  ["honest", async () => structuredClone(log)],
  ["edit an amount (CASHOUT +1 credit)", async () => { const t = structuredClone(log); const i = at("CASHOUT"); (t[i]!.data as { amount: number }).amount += 1_000_000; return t; }],
  ["reorder two events", async () => { const t = structuredClone(log); const i = Math.floor(t.length / 2); [t[i], t[i + 1]] = [t[i + 1]!, t[i]!]; return t; }],
  ["drop an event", async () => { const t = structuredClone(log); t.splice(Math.floor(t.length / 2), 1); return t; }],
  ["forge the head (last hash)", async () => { const t = structuredClone(log); t.at(-1)!.hash = "f".repeat(64); return t; }],
  ["edit an amount and re-hash the chain", async () => { const t = structuredClone(log); const i = at("CASHOUT"); (t[i]!.data as { amount: number }).amount += 1_000_000; return rehash(t, i); }],
  ["swap a label and re-hash (no money change)", async () => { const t = structuredClone(log); const i = at("JOIN"); (t[i]!.data as { player: { label: string } }).player.label = "Forged"; return rehash(t, i); }],
  ["truncate the end (drop MATCH_END)", async () => structuredClone(log).slice(0, -1)],
];
for (const [name, make] of cases) {
  const t = await make();
  for (const anchored of [false, true]) {
    const r = await runChecks(t, anchored ? head : null);
    const verdict = r.chain.state === "ok" && r.books.state === "ok" && r.anchor.state !== "bad" ? "ACCEPTED" : "REFUSED";
    console.log(JSON.stringify({ case: name, anchored, verdict, chain: r.chain.state, books: r.books.state, anchor: r.anchor.state, why: [r.chain, r.books, r.anchor].filter((c) => c.state === "bad").map((c) => c.detail) }));
  }
}
