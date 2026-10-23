import { it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDecipheriv, scryptSync } from "node:crypto";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { openDb } from "../src/db.js";
import { capture, finalize } from "../src/lifecycle.js";
import { backupDatabase } from "../src/backup.js";
it("migrates repeatably and creates a consistent encrypted online backup with WAL data", async () => {
  const dir = mkdtempSync(join(tmpdir(), "leading-backup-"));
  const password = "test-only-long-random-passphrase-not-a-real-secret";
  vi.stubEnv("BACKUP_PASSPHRASE", password);
  vi.stubEnv("BACKUP_DIR", join(dir, "backups"));
  try {
    let db = openDb(join(dir, "source.sqlite"));
    capture(db, "WAL-RECORD", null);
    finalize(db, "WAL-RECORD", "abandoned", "");
    const file = await backupDatabase(db);
    const bytes = readFileSync(file);
    expect(bytes.includes(Buffer.from("SQLite format 3"))).toBe(false);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      scryptSync(password, bytes.subarray(4, 20), 32),
      bytes.subarray(20, 32),
    );
    decipher.setAuthTag(bytes.subarray(32, 48));
    const plain = Buffer.concat([
      decipher.update(bytes.subarray(48)),
      decipher.final(),
    ]);
    expect(plain.subarray(0, 16).toString()).toBe("SQLite format 3\0");
    const restoredPath = join(dir, "restored.sqlite");
    execFileSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "restore", file, "--confirm-stopped"],
      { env: { ...process.env, DATABASE_PATH: restoredPath }, stdio: "pipe" },
    );
    const restored = new Database(restoredPath);
    expect(restored.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    expect(restored.prepare("SELECT id FROM calls").get()).toEqual({
      id: "WAL-RECORD",
    });
    expect(restored.prepare("SELECT * FROM outbox").all()).toHaveLength(2);
    restored.close();
    const corrupt = Buffer.from(bytes);
    corrupt[corrupt.length - 1] ^= 1;
    const bad = createDecipheriv(
      "aes-256-gcm",
      scryptSync(password, corrupt.subarray(4, 20), 32),
      corrupt.subarray(20, 32),
    );
    bad.setAuthTag(corrupt.subarray(32, 48));
    bad.update(corrupt.subarray(48));
    expect(() => bad.final()).toThrow();
    db.close();
    db = openDb(join(dir, "source.sqlite"));
    expect(db.prepare("SELECT * FROM schema_migrations").all()).toHaveLength(1);
    expect(db.prepare("SELECT * FROM calls").all()).toHaveLength(1);
    db.close();
  } finally {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
});
