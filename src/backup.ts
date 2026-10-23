import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  readdirSync,
  statSync,
  renameSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import type { DB } from "./db.js";
import { dbPath } from "./config.js";
export async function backupDatabase(db: DB) {
  const password = process.env.BACKUP_PASSPHRASE;
  if (!password || password.length < 24)
    throw new Error(
      "Set BACKUP_PASSPHRASE with at least 24 characters securely.",
    );
  const dir = resolve(process.env.BACKUP_DIR || "data/backups");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = resolve(
    dir,
    `snapshot-${randomBytes(8).toString("hex")}.sqlite`,
  );
  try {
    await db.backup(temp);
    const salt = randomBytes(16),
      iv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      scryptSync(password, salt, 32),
      iv,
    );
    const payload = Buffer.concat([
      cipher.update(readFileSync(temp)),
      cipher.final(),
    ]);
    const encrypted = Buffer.concat([
      Buffer.from("LCD1"),
      salt,
      iv,
      cipher.getAuthTag(),
      payload,
    ]);
    const file = resolve(dir, `leading-${Date.now()}.lcd`);
    writeFileSync(file, encrypted, { mode: 0o600 });
    if (process.env.BACKUP_UPLOAD_URL) {
      const url = new URL(process.env.BACKUP_UPLOAD_URL);
      if (url.protocol !== "https:")
        throw new Error("Off-host backup requires HTTPS");
      const response = await fetch(url, {
        method: "PUT",
        body: encrypted,
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error("Off-host upload failed");
      db.prepare("INSERT OR REPLACE INTO meta VALUES('backup_ok',?)").run(
        String(Date.now()),
      );
    }
    for (const name of readdirSync(dir)) {
      if (
        /^leading-\d+\.lcd$/.test(name) &&
        statSync(resolve(dir, name)).mtimeMs < Date.now() - 7 * 86400000
      )
        unlinkSync(resolve(dir, name));
    }
    return file;
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}
export async function restoreDatabase(file: string | undefined) {
  if (!file || !process.argv.includes("--confirm-stopped"))
    throw new Error("Stop the app first; restore <file> --confirm-stopped");
  const password = process.env.BACKUP_PASSPHRASE;
  if (!password) throw new Error("BACKUP_PASSPHRASE required");
  if (existsSync(dbPath))
    throw new Error(
      "Preserve existing database, WAL and SHM first. Target must not exist.",
    );
  const bytes = readFileSync(file);
  if (bytes.subarray(0, 4).toString() !== "LCD1")
    throw new Error("Not a Leading Call Desk encrypted backup");
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
  if (plain.subarray(0, 16).toString() !== "SQLite format 3\0")
    throw new Error("Invalid SQLite backup");
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const temp = dbPath + ".restore";
  writeFileSync(temp, plain, { mode: 0o600 });
  renameSync(temp, dbPath);
  console.log(
    "Backup restored. Validate the inbox before enabling live routing.",
  );
}
