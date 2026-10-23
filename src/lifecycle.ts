import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type DB, type Intake, getCall, settings, type Call } from "./db.js";
import { e164, isLive } from "./config.js";
export const intakeSchema = z
  .object({
    name: z.string().max(100).optional(),
    callback: e164.optional(),
    callbackConfirmed: z.boolean().optional(),
    address: z.string().max(250).optional(),
    city: z.string().max(100).optional(),
    problem: z.string().max(500).optional(),
    property: z.enum(["Residential", "Commercial", "Unknown"]).optional(),
    urgency: z
      .enum(["Routine", "Urgent", "Immediate danger", "Unknown"])
      .optional(),
    urgencyBasis: z
      .enum(["caller-reported", "assistant-inferred", "safety-rule", "unknown"])
      .optional(),
    preferredTime: z.string().max(100).optional(),
    activeLeak: z.boolean().optional(),
    uncertainty: z.string().max(250).optional(),
  })
  .strict();
const gsmBasic = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const gsmExtended = new Set("^{}\\[~]|€\f");
export function smsSegments(text: string) {
  let units = 0;
  for (const ch of text) {
    if (gsmBasic.has(ch)) units++;
    else if (gsmExtended.has(ch)) units += 2;
    else return text.length <= 70 ? 1 : Math.ceil(text.length / 67);
  }
  return units <= 160 ? 1 : Math.ceil(units / 153);
}
export function capture(
  db: DB,
  id: string,
  caller: string | null,
  now = Date.now(),
) {
  const safe = caller && e164.safeParse(caller).success ? caller : null;
  db.prepare(
    "INSERT OR IGNORE INTO calls(id,caller,created,updated) VALUES(?,?,?,?)",
  ).run(id, safe, now, now);
  return getCall(db, id)!;
}
export function alert(call: Call, kind: string, baseUrl: string) {
  const i = JSON.parse(call.intake) as Intake;
  const callback =
    i.callbackConfirmed && i.callback
      ? i.callback
      : call.caller
        ? `${call.caller} (unconfirmed)`
        : "Unknown callback";
  const title =
    kind === "urgent"
      ? "URGENT"
      : call.outcome === "completed"
        ? "CALLBACK REQUEST"
        : "INCOMPLETE / MISSED CALL";
  return `LEADING PLUMBING - ${title}\n${i.name || "Unknown caller"} | ${callback}\n${i.city || "City unknown"} | ${i.property || "Property unknown"}\n${(i.problem || "No problem details captured.").slice(0, 190)}${i.activeLeak ? " Active leak reported." : ""}\nCallback: ${i.preferredTime || "Not specified"}\n${new Date(call.created).toLocaleString("en-US", { timeZone: "America/New_York" })} ET\nDetails: ${baseUrl}/?call=${encodeURIComponent(call.id)}`;
}
export function enqueue(db: DB, call: Call, kind: string, baseUrl: string) {
  const s = settings(db);
  const body = alert(call, kind, baseUrl);
  s.recipients.forEach((r, index) => {
    db.prepare(
      "INSERT OR IGNORE INTO outbox(id,call_id,kind,recipient,destination,body,segments,state,next_attempt,updated,error) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      call.id,
      kind,
      index,
      r.phone,
      body,
      smsSegments(body),
      r.phone && r.optedIn ? "pending" : "blocked",
      Date.now(),
      Date.now(),
      r.phone && r.optedIn
        ? null
        : "Recipient number and recorded opt-in required",
    );
  });
}
export function updateIntake(
  db: DB,
  id: string,
  patch: unknown,
  baseUrl: string,
) {
  const valid = intakeSchema.parse(patch);
  if (valid.urgency && !valid.urgencyBasis)
    valid.urgencyBasis = "assistant-inferred";
  return db.transaction(() => {
    const c = getCall(db, id);
    if (!c || c.finalized) return false;
    const intake = { ...JSON.parse(c.intake), ...valid };
    if (
      valid.callback &&
      valid.callback !== JSON.parse(c.intake).callback &&
      valid.callbackConfirmed !== true
    )
      intake.callbackConfirmed = false;
    db.prepare("UPDATE calls SET intake=?,updated=? WHERE id=?").run(
      JSON.stringify(intake),
      Date.now(),
      id,
    );
    if (
      ["Urgent", "Immediate danger"].includes(intake.urgency) &&
      !c.urgent_sent
    ) {
      enqueue(db, getCall(db, id)!, "urgent", baseUrl);
      db.prepare("UPDATE calls SET urgent_sent=1 WHERE id=?").run(id);
    }
    return true;
  })();
}
export function finalize(db: DB, id: string, outcome: string, baseUrl: string) {
  return db.transaction(() => {
    const c = getCall(db, id);
    if (!c || c.finalized) return false;
    const seconds = c.ai_started
      ? Math.ceil((Date.now() - c.ai_started) / 1000)
      : 0;
    db.prepare(
      "UPDATE calls SET finalized=1,outcome=?,updated=?,ai_seconds=? WHERE id=?",
    ).run(outcome, Date.now(), seconds, id);
    const current = getCall(db, id)!;
    const i = JSON.parse(current.intake) as Intake;
    db.prepare("UPDATE calls SET summary=? WHERE id=?").run(
      i.problem || "No problem details captured.",
      id,
    );
    enqueue(db, current, "final", baseUrl);
    return true;
  })();
}
export function prune(db: DB, now = Date.now()) {
  const cutoff = now - settings(db).retentionDays * 86400000;
  return db
    .prepare("DELETE FROM calls WHERE created<? AND finalized=1")
    .run(cutoff).changes;
}
export function budgetAvailable(db: DB) {
  const month = new Date();
  month.setUTCDate(1);
  month.setUTCHours(0, 0, 0, 0);
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(ai_seconds),0) AS seconds FROM calls WHERE created>=?",
    )
    .get(month.getTime()) as { seconds: number };
  const active = db
    .prepare(
      "SELECT COUNT(*) AS n FROM calls WHERE ai_started IS NOT NULL AND finalized=0",
    )
    .get() as { n: number };
  const s = settings(db);
  return row.seconds + active.n * s.maxCallSeconds < s.monthlyAiMinutes * 60;
}
export function seedDemo(db: DB) {
  if (isLive) throw new Error("Demo data disabled in live mode");
  const existing = db.prepare("SELECT COUNT(*) AS n FROM calls").get() as {
    n: number;
  };
  if (existing.n) return;
  const samples = [
    {
      id: "DEMO-MARIA",
      ago: 12,
      name: "Maria Gonzalez",
      callback: "+15555550142",
      city: "West Palm Beach",
      address: "124 Example Lane",
      problem:
        "Water leaking below the kitchen sink. Towels are down, but the leak is continuing.",
      property: "Residential",
      urgency: "Urgent",
      activeLeak: true,
      preferredTime: "As soon as possible",
      outcome: "completed",
      status: "New",
    },
    {
      id: "DEMO-JAMES",
      ago: 48,
      name: "James Wilson",
      callback: "+15555550187",
      city: "Lake Worth Beach",
      address: "80 Sample Street",
      problem:
        "Guest bathroom toilet keeps running. Would like a callback about a repair.",
      property: "Residential",
      urgency: "Routine",
      preferredTime: "This afternoon",
      outcome: "completed",
      status: "New",
    },
    {
      id: "DEMO-PARTIAL",
      ago: 96,
      city: "",
      problem: "Caller disconnected before sharing the issue.",
      outcome: "abandoned",
      status: "New",
    },
    {
      id: "DEMO-ANA",
      ago: 160,
      name: "Ana Rivera",
      callback: "+15555550163",
      city: "Boynton Beach",
      problem: "Low water pressure at a small office.",
      property: "Commercial",
      urgency: "Routine",
      preferredTime: "After 2 pm",
      outcome: "completed",
      status: "Contacted",
    },
    {
      id: "DEMO-ROBERT",
      ago: 1300,
      name: "Robert Chen",
      callback: "+15555550122",
      city: "Boca Raton",
      problem: "Water heater inspection request.",
      property: "Residential",
      urgency: "Routine",
      outcome: "completed",
      status: "Closed",
    },
  ];
  for (const s of samples) {
    capture(db, s.id, s.callback || null, Date.now() - s.ago * 60000);
    updateIntake(
      db,
      s.id,
      {
        name: s.name,
        callback: s.callback,
        callbackConfirmed: !!s.callback,
        city: s.city,
        address: s.address,
        problem: s.problem,
        property: s.property,
        urgency: s.urgency,
        activeLeak: s.activeLeak,
        preferredTime: s.preferredTime,
      },
      "http://localhost:3000",
    );
    finalize(db, s.id, s.outcome, "http://localhost:3000");
    db.prepare("UPDATE calls SET status=? WHERE id=?").run(s.status, s.id);
  }
  db.prepare(
    "UPDATE outbox SET state='delivered',provider_id='MOCK-'||id,error=NULL",
  ).run();
  db.prepare(
    "UPDATE outbox SET state='failed',error='Simulated carrier failure' WHERE call_id='DEMO-PARTIAL' AND recipient=1",
  ).run();
}
