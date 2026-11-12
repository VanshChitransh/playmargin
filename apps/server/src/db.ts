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
  // v2: each free match remembers which hourly anchor covers it and its Merkle proof (JSON).
  `ALTER TABLE matches ADD COLUMN anchor_hour INTEGER;
   ALTER TABLE matches ADD COLUMN proof TEXT;`,
];

/**
 * fn inside one transaction. On some errors (SQLITE_FULL, IOERR, NOMEM) SQLite has ALREADY rolled the
 * transaction back by itself, and a second ROLLBACK then throws "cannot rollback - no transaction is
 * active", hiding the real error (the disk-full incident). So: roll back only if still open, never let
 * the rollback's own error replace the real one, and leave the connection clean for the next write.
 */
export function withTx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    if ((db as unknown as { isTransaction?: boolean }).isTransaction !== false) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* already rolled back by SQLite: the real error below is what matters */
      }
    }
    throw err;
  }
}

/** Open (or create) the database and apply pending migrations. Use ":memory:" in tests. */
export function openDb(path = process.env.DB_PATH ?? "margin.sqlite"): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    withTx(db, () => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
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

/** Find or create the user row for a NEAR account (paid players, verified leaderboard). */
export function userForAccount(db: Db, accountId: string): string {
  const row = db.prepare("SELECT id FROM users WHERE account_id = ?").get(accountId) as { id: string } | undefined;
  if (row) return row.id;
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, account_id, created) VALUES (?, ?, ?)").run(id, accountId, Date.now());
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

let shared: Db | null = null;

/** The process-wide database (DB_PATH, default margin.sqlite), opened on first use. */
export function sharedDb(): Db {
  return (shared ??= openDb());
}
