import { describe, it, expect, afterEach } from "vitest";
import { openDb, settings, getCall, type Outbox } from "../src/db.js";
import {
  capture,
  updateIntake,
  finalize,
  smsSegments,
  prune,
  budgetAvailable,
  alert,
} from "../src/lifecycle.js";
import {
  createWorker,
  delivery,
  recoverSending,
} from "../src/notifications.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function setup(path = ":memory:") {
  const db = openDb(path);
  const s = settings(db);
  s.recipients = [
    { name: "Owner", phone: "+15555550100", optedIn: true },
    { name: "Son", phone: "+15555550101", optedIn: true },
  ];
  db.prepare("UPDATE settings SET json=?").run(JSON.stringify(s));
  return db;
}
const count = (db: ReturnType<typeof setup>, table: string) =>
  (db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;
describe("durable intake and notification intent", () => {
  it("deduplicates capture, urgent and final intents; preserves corrections and partial intake", () => {
    const db = setup();
    capture(db, "A", "+15555550142");
    capture(db, "A", "+15555550188");
    expect(count(db, "calls")).toBe(1);
    updateIntake(
      db,
      "A",
      { callback: "+15555550122", callbackConfirmed: true, urgency: "Urgent" },
      "https://desk.example",
    );
    updateIntake(db, "A", { callback: "+15555550133" }, "https://desk.example");
    expect(JSON.parse(getCall(db, "A")!.intake).callbackConfirmed).toBe(false);
    updateIntake(db, "A", { callbackConfirmed: true }, "https://desk.example");
    updateIntake(db, "A", { urgency: "Urgent" }, "https://desk.example");
    finalize(db, "A", "abandoned", "https://desk.example");
    finalize(db, "A", "completed", "https://desk.example");
    expect(count(db, "outbox")).toBe(4);
    expect(getCall(db, "A")!.outcome).toBe("abandoned");
    expect(alert(getCall(db, "A")!, "final", "https://desk.example")).toContain(
      "+15555550133",
    );
    expect(updateIntake(db, "A", { name: "Late model result" }, "")).toBe(
      false,
    );
    db.close();
  });
  it("keeps blocked identity unknown and alerts on an empty abandoned call", () => {
    const db = setup();
    capture(db, "B", "anonymous");
    finalize(db, "B", "abandoned", "https://desk.example");
    const rows = db.prepare("SELECT * FROM outbox").all() as Outbox[];
    expect(rows).toHaveLength(2);
    expect(rows[0].body).toContain("Unknown callback");
    expect(rows[0].body).toContain("MISSED CALL");
    expect(rows[0].body).not.toContain("spam");
    db.close();
  });
  it("rejects malformed tool fields and never uses model-selected destinations", () => {
    const db = setup();
    capture(db, "C", null);
    expect(() =>
      updateIntake(db, "C", { recipient: "+15555550999" }, ""),
    ).toThrow();
    expect(() => updateIntake(db, "C", { callback: "555" }, "")).toThrow();
    expect(count(db, "outbox")).toBe(0);
    db.close();
  });
  it("prunes only completed expired records with cascading personal-data removal", () => {
    const db = setup();
    capture(db, "old", null, Date.now() - 91 * 86400000);
    finalize(db, "old", "abandoned", "");
    capture(db, "active", null, Date.now() - 91 * 86400000);
    expect(prune(db)).toBe(1);
    expect(count(db, "outbox")).toBe(0);
    expect(getCall(db, "active")).toBeDefined();
    db.close();
  });
  it("enforces zero AI minute budget without suppressing callback intents", () => {
    const db = setup();
    const s = settings(db);
    s.monthlyAiMinutes = 0;
    db.prepare("UPDATE settings SET json=?").run(JSON.stringify(s));
    expect(budgetAvailable(db)).toBe(false);
    capture(db, "D", null);
    finalize(db, "D", "budget-fallback", "");
    expect(count(db, "outbox")).toBe(2);
    db.close();
  });
});
describe("financial side effects", () => {
  it("tracks each recipient independently, permanent opt-out, and ordered callbacks", async () => {
    const db = setup();
    capture(db, "A", null);
    finalize(db, "A", "abandoned", "");
    await createWorker(db, async (r) => {
      if (r.recipient === 1) throw { status: 400, code: 21610 };
      return { id: "SM-one", status: "sent" };
    })();
    let rows = db
      .prepare("SELECT * FROM outbox ORDER BY recipient")
      .all() as Outbox[];
    expect(rows.map((r) => r.state)).toEqual(["sent", "failed"]);
    delivery(db, rows[0].id, "SM-one", "delivered");
    delivery(db, rows[0].id, "SM-one", "queued");
    delivery(db, rows[0].id, "SM-one", "delivered");
    delivery(db, rows[0].id, "SM-foreign", "failed");
    rows = db
      .prepare("SELECT * FROM outbox ORDER BY recipient")
      .all() as Outbox[];
    expect(rows.map((r) => r.state)).toEqual(["delivered", "failed"]);
    db.close();
  });
  it("retries rate limits after a real database restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lcd-test-"));
    dirs.push(dir);
    const path = join(dir, "db.sqlite");
    let db = setup(path);
    capture(db, "A", null);
    finalize(db, "A", "completed", "");
    await createWorker(db, async () => {
      throw { status: 429 };
    })();
    expect(
      (db.prepare("SELECT state FROM outbox LIMIT 1").get() as Outbox).state,
    ).toBe("retry");
    db.close();
    db = setup(path);
    db.prepare("UPDATE outbox SET next_attempt=0").run();
    await createWorker(db, async (r) => ({
      id: "SM-" + r.id,
      status: "queued",
    }))();
    expect(
      (db.prepare("SELECT state FROM outbox LIMIT 1").get() as Outbox).state,
    ).toBe("queued");
    db.close();
  });
  it("does not blindly resend uncertain network acceptance after restart", async () => {
    const db = setup();
    capture(db, "A", null);
    finalize(db, "A", "completed", "");
    await createWorker(db, async () => {
      throw new Error("timeout");
    })();
    expect(
      (db.prepare("SELECT state FROM outbox LIMIT 1").get() as Outbox).state,
    ).toBe("ambiguous");
    let sends = 0;
    await createWorker(db, async () => {
      sends++;
      return { id: "x", status: "sent" };
    })();
    expect(sends).toBe(0);
    db.prepare("UPDATE outbox SET state='sending'").run();
    recoverSending(db);
    expect(
      (db.prepare("SELECT state FROM outbox LIMIT 1").get() as Outbox).state,
    ).toBe("ambiguous");
    db.close();
  });
  it("blocks unconsented recipient changes instead of sending to a new number", async () => {
    const db = setup();
    capture(db, "A", null);
    finalize(db, "A", "completed", "");
    const s = settings(db);
    s.recipients[0].phone = "+15555550199";
    db.prepare("UPDATE settings SET json=?").run(JSON.stringify(s));
    const sends: number[] = [];
    await createWorker(db, async (r) => {
      sends.push(r.recipient);
      return { id: "SM-two", status: "sent" };
    })();
    expect(sends).toEqual([1]);
    db.close();
  });
  it("estimates GSM-7 extension and UCS-2 multipart boundaries correctly", () => {
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("^".repeat(81))).toBe(2);
    expect(smsSegments("á".repeat(70))).toBe(1);
    expect(smsSegments("á".repeat(71))).toBe(2);
    expect(smsSegments("🚰".repeat(36))).toBe(2);
  });
});
