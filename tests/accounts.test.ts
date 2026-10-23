import { it, expect } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verify } from "@node-rs/argon2";
import { openDb } from "../src/db.js";
it("bootstraps exactly two individual accounts with hidden passwords and refuses a second bootstrap", async () => {
  const dir = mkdtempSync(join(tmpdir(), "leading-accounts-"));
  const path = join(dir, "db.sqlite");
  const secret = "test-only-unique-long-password";
  try {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "bootstrap"],
      {
        env: { ...process.env, APP_MODE: "demo", DATABASE_PATH: path },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let output = "",
      step = 0;
    const prompts = [
      "owner email:",
      "owner password",
      "son email:",
      "son password",
    ];
    const answers = [
      "owner@example.test",
      secret,
      "son@example.test",
      secret + "-son",
    ];
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (step < 4 && output.includes(prompts[step])) {
        child.stdin.write(answers[step] + "\n");
        step++;
      }
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("exit", resolve);
      child.on("error", reject);
    });
    expect(code).toBe(0);
    expect(output).not.toContain(secret);
    const db = openDb(path);
    const users = db
      .prepare("SELECT email,password_hash FROM users ORDER BY email")
      .all() as { email: string; password_hash: string }[];
    expect(users).toHaveLength(2);
    expect(await verify(users[0].password_hash, secret)).toBe(true);
    db.close();
    expect(() =>
      execFileSync(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", "bootstrap"],
        {
          env: { ...process.env, APP_MODE: "demo", DATABASE_PATH: path },
          stdio: "pipe",
        },
      ),
    ).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
