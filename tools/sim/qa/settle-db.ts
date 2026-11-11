// Re-settle every finished match log stored in one or more server DBs with the current core settle.
import { DatabaseSync } from "node:sqlite";
import { settle, type LogEntry } from "@margin/core";
let ok = 0, bad = 0;
const byVer = new Map<string, string[]>();
for (const path of process.argv.slice(2)) {
  const db = new DatabaseSync(path, { readOnly: true });
  const ids = db.prepare("SELECT id FROM matches WHERE status = 'settled'").all() as Array<{ id: string }>;
  for (const { id } of ids) {
    const rows = db.prepare("SELECT json AS body FROM events WHERE match_id = ? ORDER BY seq").all(id) as Array<{ body: string }>;
    const log = rows.map((r) => JSON.parse(r.body) as LogEntry);
    try { const r = settle(log); ok++; byVer.set(`v${r.rulesVersion}${r.legacy ? " legacy" : ""}`, [...(byVer.get(`v${r.rulesVersion}${r.legacy ? " legacy" : ""}`) ?? []), id]); } catch (e) { bad++; console.log(JSON.stringify({ db: path.split("/").pop(), id, error: (e as Error).message })); }
  }
  db.close();
}
for (const [v, ids] of byVer) console.log(`${v}: ${ids.length} (${ids.slice(0, 12).join(", ")}${ids.length > 12 ? ", ..." : ""})`);
console.log(`${ok} settled logs pass, ${bad} refused`);
