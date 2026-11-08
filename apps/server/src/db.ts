// SQLite storage on the built-in node:sqlite (no native build step). The credits ledger is
// append-only, enforced by triggers, so a balance is always SUM(delta) and never a mutable column.
// Migrations are keyed on PRAGMA user_version and run on open.
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Micro } from "@margin/core";

export type Db = DatabaseSync;

const MIGRATIONS: string[] = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     guest_key TEXT UNIQUE,
     account_id TEXT UNIQUE,
     created INTEGER NOT NULL
   );
   CREATE TABLE credits_ledger (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id TEXT NOT NULL REFERENCES users(id),
     delta INTEGER NOT NULL,
     reason TEXT NOT NULL,
     match_id TEXT,
     at INTEGER NOT NULL
   );
   CREATE INDEX credits_ledger_user ON credits_ledger(user_id);
   CREATE TRIGGER credits_ledger_no_update BEFORE UPDATE ON credits_ledger
     BEGIN SELECT RAISE(ABORT, 'credits_ledger is append-only'); END;
   CREATE TRIGGER credits_ledger_no_delete BEFORE DELETE ON credits_ledger
     BEGIN SELECT RAISE(ABORT, 'credits_ledger is append-only'); END;
   CREATE TABLE matches (
     id TEXT PRIMARY KEY,
     mode TEXT NOT NULL CHECK (mode IN ('free', 'paid')),
     seed INTEGER NOT NULL,
     status TEXT NOT NULL,
     pot INTEGER NOT NULL DEFAULT 0,
     head TEXT,
     tx_hash TEXT,
     created INTEGER NOT NULL,
     ended INTEGER
   );
   CREATE TABLE match_players (
     match_id TEXT NOT NULL REFERENCES matches(id),
     user_id TEXT NOT NULL REFERENCES users(id),
     blob_id TEXT NOT NULL,
     entry INTEGER NOT NULL,
     payout INTEGER,
     PRIMARY KEY (match_id, user_id)
   );
   CREATE TABLE events (
     match_id TEXT NOT NULL REFERENCES matches(id),
     seq INTEGER NOT NULL,
     json TEXT NOT NULL,
     hash TEXT NOT NULL,
     PRIMARY KEY (match_id, seq)
   );
   CREATE TABLE anchors (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     hour INTEGER NOT NULL UNIQUE,
     root TEXT NOT NULL,
     tx_hash TEXT,
     created INTEGER NOT NULL
   );`,
];

/** Open (or create) the database and apply pending migrations. Use ":memory:" in tests. */
export function openDb(path = process.env.DB_PATH ?? "margin.sqlite"): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return db;
}

/** Find the user for a browser guest key, creating one on first visit. Returns the user id. */
export function userForGuestKey(db: Db, guestKey: string): string {
  const row = db.prepare("SELECT id FROM users WHERE guest_key = ?").get(guestKey) as
    | { id: string }
    | undefined;
  if (row) return row.id;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, guest_key, created) VALUES (?, ?, ?)").run(id, guestKey, Date.now());
  return id;
}

/** Append one ledger row; delta is signed Micro. */
export function appendCredit(
  db: Db,
  entry: { userId: string; delta: Micro; reason: string; matchId?: string },
): void {
  if (!Number.isSafeInteger(entry.delta)) throw new Error(`delta must be an integer Micro: ${entry.delta}`);
  db.prepare("INSERT INTO credits_ledger (user_id, delta, reason, match_id, at) VALUES (?, ?, ?, ?, ?)").run(
    entry.userId,
    entry.delta,
    entry.reason,
    entry.matchId ?? null,
    Date.now(),
  );
}

/** Current credit balance in Micro: the sum of every ledger row. */
export function creditBalance(db: Db, userId: string): Micro {
  const row = db.prepare("SELECT COALESCE(SUM(delta), 0) AS b FROM credits_ledger WHERE user_id = ?").get(
    userId,
  ) as { b: number };
  return row.b;
}
