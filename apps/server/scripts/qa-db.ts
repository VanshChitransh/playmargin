// QA-A5: DB integrity after a blast (read only). For every finished match: one MATCH_END, contiguous
// seq, intact hash chain, and settle(log) payouts == stored payouts == ledger payouts. Credits: no user
// ever below zero in ledger order, one entry charge per (user, match), one daily top-up per user per
// UTC day. Stats: test traffic (qa- keys) never reaches the public numbers.
// Usage: npx tsx apps/server/scripts/qa-db.ts <db.sqlite>
import { DatabaseSync } from "node:sqlite";
import { settleVerified, verifyChain, type LogEntry } from "@margin/core";

const db = new DatabaseSync(process.argv[2]!, { readOnly: true });
const all = <T>(sql: string, ...p: Array<string | number>) => db.prepare(sql).all(...p) as T[];
const fails: string[] = [];
const fail = (m: string) => fails.length < 30 && fails.push(m);

const matches = all<{ id: string; status: string; head: string | null }>("SELECT id, status, head FROM matches WHERE status IN ('settled','retrying')");
let checked = 0;
for (const m of matches) {
  const log = all<{ seq: number; json: string }>("SELECT seq, json FROM events WHERE match_id = ? ORDER BY seq", m.id).map((r) => JSON.parse(r.json) as LogEntry);
  const ends = log.filter((e) => e.type === "MATCH_END").length;
  if (ends !== 1) fail(`${m.id}: ${ends} MATCH_END events`);
  if (log.some((e, i) => e.seq !== i)) fail(`${m.id}: seq not contiguous`);
  const broken = await verifyChain(log);
  if (broken !== null) fail(`${m.id}: hash chain broken at ${broken}`);
  if (m.head !== log.at(-1)?.hash) fail(`${m.id}: stored head != last hash`);
  try {
    const r = await settleVerified(log);
    const byBlob = new Map(r.payouts.map((p) => [p.id, p.amount]));
    const rows = all<{ user_id: string; blob_id: string; payout: number | null }>("SELECT user_id, blob_id, payout FROM match_players WHERE match_id = ?", m.id);
    for (const row of rows) {
      const want = byBlob.get(row.blob_id) ?? 0;
      if ((row.payout ?? 0) !== want) fail(`${m.id}/${row.blob_id}: stored payout ${row.payout} != settle ${want}`);
      const led = all<{ s: number | null }>("SELECT SUM(delta) AS s FROM credits_ledger WHERE match_id = ? AND user_id = ? AND reason = 'payout'", m.id, row.user_id)[0]?.s ?? 0;
      if (led !== want) fail(`${m.id}/${row.blob_id}: ledger payout ${led} != settle ${want}`);
    }
  } catch (e) {
    fail(`${m.id}: settle refused: ${(e as Error).message}`);
  }
  checked++;
}

// Credits: running balance per user in ledger order never below zero.
let users = 0;
let minBalance = Infinity;
for (const { user_id } of all<{ user_id: string }>("SELECT DISTINCT user_id FROM credits_ledger")) {
  users++;
  let bal = 0;
  for (const { delta } of all<{ delta: number }>("SELECT delta FROM credits_ledger WHERE user_id = ? ORDER BY id", user_id)) {
    bal += delta;
    minBalance = Math.min(minBalance, bal);
    if (bal < 0) fail(`user ${user_id}: balance ${bal} < 0`);
  }
}
const dupEntries = all<{ n: number }>("SELECT COUNT(*) AS n FROM (SELECT user_id, match_id FROM credits_ledger WHERE reason = 'entry' GROUP BY user_id, match_id HAVING COUNT(*) > 1)")[0]!.n;
if (dupEntries) fail(`${dupEntries} (user, match) pairs charged twice`);
const entryVsSeats = all<{ a: number; b: number }>("SELECT (SELECT COUNT(*) FROM credits_ledger WHERE reason = 'entry') AS a, (SELECT COUNT(*) FROM match_players) AS b")[0]!;
if (entryVsSeats.a !== entryVsSeats.b) fail(`entry charges ${entryVsSeats.a} != seats ${entryVsSeats.b}`);
const dupTopups = all<{ n: number }>("SELECT COUNT(*) AS n FROM (SELECT user_id, at / 86400000 AS d FROM credits_ledger WHERE reason = 'daily_topup' GROUP BY user_id, d HAVING COUNT(*) > 1)")[0]!.n;
if (dupTopups) fail(`${dupTopups} users topped up twice in one UTC day`);

// Independent recount of the public numbers (not the stats() SQL): real = NEAR account, or a guest key
// that is neither "qa-" nor "ed25519:" (every script uses those). After a pure test blast it must be 0.
const realUsers = all<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE account_id IS NOT NULL OR (guest_key NOT LIKE 'qa-%' AND guest_key NOT LIKE 'ed25519:%')")[0]!.n;
const realMatches = all<{ n: number }>("SELECT COUNT(DISTINCT p.match_id) AS n FROM match_players p JOIN users u ON u.id = p.user_id WHERE u.account_id IS NOT NULL OR (u.guest_key NOT LIKE 'qa-%' AND u.guest_key NOT LIKE 'ed25519:%')")[0]!.n;
const testUsers = all<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE guest_key LIKE 'qa-%'")[0]!.n;
const s = { realUsers, realMatches };
if (realUsers !== 0 || realMatches !== 0) fail(`test traffic would count as real: ${JSON.stringify(s)}`);

console.log(JSON.stringify({ matchesChecked: checked, ledgerUsers: users, minBalanceMicro: minBalance, entryCharges: entryVsSeats.a, seats: entryVsSeats.b, dupEntries, dupTopups, statsWithOnlyTestTraffic: s, testUsers }, null, 1));
console.log(fails.length ? `DB INTEGRITY FAIL (${fails.length}):\n${fails.join("\n")}` : "DB INTEGRITY OK");
process.exit(fails.length ? 1 : 0);
