import { openDb } from "./db.js";
import { seedDemo } from "./lifecycle.js";
import { isLive } from "./config.js";
import { hash } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { backupDatabase, restoreDatabase } from "./backup.js";
const command = process.argv[2];
if (command === "restore") {
  await restoreDatabase(process.argv[3]);
} else {
  const db = openDb();
  try {
    if (command === "demo") {
      if (isLive) throw new Error("Refusing demo seed in live mode");
      seedDemo(db);
      console.log("Fictional demo data ready. No real calls or texts.");
    } else if (command === "bootstrap") {
      const n = db.prepare("SELECT COUNT(*) n FROM users").get() as {
        n: number;
      };
      if (n.n)
        throw new Error(
          "Accounts already initialized. Use the documented offline reset procedure.",
        );
      let muted = false;
      const output = new Writable({
        write(chunk, _encoding, cb) {
          if (!muted) process.stdout.write(chunk);
          cb();
        },
      });
      const rl = createInterface({
        input: process.stdin,
        output,
        terminal: true,
      });
      const users: { id: string; email: string; hash: string }[] = [];
      try {
        for (const role of ["owner", "son"]) {
          const email = (await rl.question(`${role} email: `))
            .trim()
            .toLowerCase();
          if (
            !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
            users.some((u) => u.email === email)
          )
            throw new Error("Two distinct valid emails are required.");
          process.stdout.write(
            `${role} password (minimum 14 characters; hidden): `,
          );
          muted = true;
          const password = await rl.question("");
          muted = false;
          process.stdout.write("\n");
          if (password.length < 14)
            throw new Error("Password too short. Nothing saved.");
          users.push({
            id: randomUUID(),
            email,
            hash: await hash(password, {
              memoryCost: 19456,
              timeCost: 2,
              parallelism: 1,
            }),
          });
        }
      } finally {
        muted = false;
        rl.close();
      }
      db.transaction(() => {
        for (const u of users)
          db.prepare("INSERT INTO users VALUES(?,?,?)").run(
            u.id,
            u.email,
            u.hash,
          );
      })();
      console.log("Two individual accounts created. No public signup.");
    } else if (command === "reset-password") {
      const email = (process.argv[3] || "").toLowerCase();
      if (!db.prepare("SELECT id FROM users WHERE email=?").get(email))
        throw new Error("Existing account email required.");
      let muted = false;
      const output = new Writable({
        write(chunk, _encoding, cb) {
          if (!muted) process.stdout.write(chunk);
          cb();
        },
      });
      const rl = createInterface({
        input: process.stdin,
        output,
        terminal: true,
      });
      let password = "";
      try {
        process.stdout.write("New password (minimum 14 characters; hidden): ");
        muted = true;
        password = await rl.question("");
      } finally {
        muted = false;
        rl.close();
        process.stdout.write("\n");
      }
      if (password.length < 14)
        throw new Error("Password too short. Nothing saved.");
      const digest = await hash(password, {
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      db.transaction(() => {
        db.prepare("UPDATE users SET password_hash=? WHERE email=?").run(
          digest,
          email,
        );
        db.prepare("DELETE FROM session_store").run();
      })();
      console.log("Password updated and all sessions revoked.");
    } else if (command === "backup") await backupDatabase(db);
    else
      throw new Error(
        "Commands: demo, bootstrap, backup, restore <encrypted file> --confirm-stopped",
      );
  } finally {
    db.close();
  }
}
