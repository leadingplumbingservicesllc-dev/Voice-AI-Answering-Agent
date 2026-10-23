import Database from "better-sqlite3";
import { mkdirSync, readFileSync, readdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath, defaults, type Settings } from "./config.js";
export function openDb(path = dbPath) {
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied INTEGER NOT NULL)",
  );
  for (const file of readdirSync(new URL("../migrations/", import.meta.url))
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort()) {
    if (
      !db.prepare("SELECT 1 FROM schema_migrations WHERE version=?").get(file)
    )
      db.transaction(() => {
        db.exec(
          readFileSync(
            new URL("../migrations/" + file, import.meta.url),
            "utf8",
          ),
        );
        db.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(
          file,
          Date.now(),
        );
      })();
  }
  db.prepare("INSERT OR IGNORE INTO settings VALUES(1,?)").run(
    JSON.stringify(defaults),
  );
  return db;
}
export type DB = ReturnType<typeof openDb>;
export function settings(db: DB): Settings {
  return JSON.parse(
    (
      db.prepare("SELECT json FROM settings WHERE id=1").get() as {
        json: string;
      }
    ).json,
  );
}
export type Intake = {
  name?: string;
  callback?: string;
  callbackConfirmed?: boolean;
  address?: string;
  city?: string;
  problem?: string;
  property?: "Residential" | "Commercial" | "Unknown";
  urgency?: "Routine" | "Urgent" | "Immediate danger" | "Unknown";
  urgencyBasis?:
    "caller-reported" | "assistant-inferred" | "safety-rule" | "unknown";
  preferredTime?: string;
  activeLeak?: boolean;
  uncertainty?: string;
};
export type Call = {
  id: string;
  caller: string | null;
  created: number;
  updated: number;
  status: "New" | "Contacted" | "Closed";
  outcome: string;
  consent: string;
  intake: string;
  finalized: number;
  urgent_sent: number;
  summary: string;
  ai_started: number | null;
  ai_seconds: number;
};
export type Outbox = {
  id: string;
  call_id: string;
  kind: string;
  recipient: number;
  destination: string;
  body: string;
  segments: number;
  state: string;
  attempts: number;
  next_attempt: number;
  provider_id: string | null;
  error: string | null;
  updated: number;
};
export const getCall = (db: DB, id: string) =>
  db.prepare("SELECT * FROM calls WHERE id=?").get(id) as Call | undefined;
