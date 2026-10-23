import Fastify, { LogController } from "fastify";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import staticFiles from "@fastify/static";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { openDb, getCall, settings, type DB, type Call } from "./db.js";
import {
  isLive,
  publicUrl,
  settingsSchema,
  liveRequirements,
} from "./config.js";
import {
  capture,
  finalize,
  updateIntake,
  budgetAvailable,
  seedDemo,
} from "./lifecycle.js";
import { createWorker, delivery, recoverSending } from "./notifications.js";
import {
  validSignature,
  validContext,
  consentXml,
  fallbackXml,
  relayXml,
} from "./providers.js";
import { VoiceSession, OpenAITextModel } from "./voice.js";
import { setupAuth } from "./auth.js";
import { createRecovery } from "./recovery.js";
import twilio from "twilio";
import { DemoIntakeEngine } from "./demo.js";
import { backupEmail } from "./email.js";
import { backupDatabase } from "./backup.js";
const terminal = new Set([
  "completed",
  "busy",
  "failed",
  "no-answer",
  "canceled",
]);
export async function createApp(db: DB = openDb(), background = true) {
  const app = Fastify({
    logger: {
      level: "warn",
      redact: ["req.headers", "req.body", "req.url", "res.headers"],
    },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 16384,
    requestTimeout: 15000,
    trustProxy: (_address, hop) => hop === 0,
  });
  let stopping = false;
  const sessions = new Map<string, VoiceSession>();
  const demos = new Map<
    string,
    { engine: DemoIntakeEngine; sessionId: string; expires: number }
  >();
  const tickets = new Map<string, { token: string; expires: number }>();
  await app.register(rateLimit, {
    max: 150,
    timeWindow: "1 minute",
    allowList: (req) => req.url.startsWith("/hooks/"),
  });
  await app.register(formbody);
  await app.register(websocket, { options: { maxPayload: 16384 } });
  await setupAuth(app, db);
  app.addHook("onSend", async (_req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY")
      .header("Cache-Control", "no-store");
    if (isLive) reply.header("Strict-Transport-Security", "max-age=31536000");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  });
  app.setErrorHandler((e, _req, reply) => {
    if (e instanceof z.ZodError)
      return reply.code(400).send({
        error: e.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    const err = e as { statusCode?: number };
    reply.code(err.statusCode || 500).send({
      error:
        err.statusCode === 401
          ? "Email or password was not recognized."
          : err.statusCode === 429
            ? "Too many attempts. Please try later."
            : "The request could not be completed. Please retry.",
    });
  });
  app.get("/healthz", async () => {
    db.prepare("SELECT 1").get();
    return { ok: true, mode: isLive ? "live" : "demo" };
  });
  app.get("/api/calls", async () => ({
    calls: (
      db
        .prepare("SELECT * FROM calls ORDER BY created DESC LIMIT 500")
        .all() as Call[]
    ).map((c) => ({
      ...c,
      intake: JSON.parse(c.intake),
      deliveries: db
        .prepare(
          "SELECT recipient,kind,state,error,segments,attempts FROM outbox WHERE call_id=? ORDER BY kind",
        )
        .all(c.id),
    })),
  }));
  app.get<{ Params: { id: string } }>("/api/calls/:id", async (req, reply) => {
    const c = getCall(db, req.params.id);
    if (!c) return reply.code(404).send({ error: "Call not found" });
    return {
      ...c,
      intake: JSON.parse(c.intake),
      deliveries: db
        .prepare(
          "SELECT recipient,kind,state,error,segments,attempts FROM outbox WHERE call_id=?",
        )
        .all(c.id),
    };
  });
  app.patch<{ Params: { id: string } }>(
    "/api/calls/:id",
    async (req, reply) => {
      const status = z
        .object({ status: z.enum(["New", "Contacted", "Closed"]) })
        .parse(req.body).status;
      const r = db
        .prepare("UPDATE calls SET status=? WHERE id=?")
        .run(status, req.params.id);
      return r.changes
        ? { ok: true }
        : reply.code(404).send({ error: "Call not found" });
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/calls/:id",
    async (req, reply) => {
      const c = getCall(db, req.params.id);
      if (c && !c.finalized)
        return reply
          .code(409)
          .send({ error: "Finish the active call before deleting it." });
      db.prepare("DELETE FROM calls WHERE id=?").run(req.params.id);
      return { ok: true };
    },
  );
  app.get("/api/settings", async () => settings(db));
  app.put("/api/settings", async (req) => {
    const s = settingsSchema.parse(req.body);
    db.prepare("UPDATE settings SET json=? WHERE id=1").run(JSON.stringify(s));
    return s;
  });
  app.get("/api/health", async () => {
    let writable = false;
    try {
      db.transaction(() => {
        db.prepare("INSERT OR REPLACE INTO meta VALUES('write_check',?)").run(
          String(Date.now()),
        );
      })();
      writable = true;
    } catch {}
    return {
      mode: isLive ? "live" : "demo",
      credentials: liveRequirements().map((r) => ({
        ...r,
        status: !isLive
          ? "Not used in demo"
          : r.present
            ? "Configured; untested"
            : "Missing",
      })),
      database: writable ? "Writable · WAL" : "Write failed",
      recipients: settings(db).recipients.map((r) => ({
        name: r.name,
        configured: !!r.phone,
        optedIn: r.optedIn,
      })),
      fallback: process.env.FALLBACK_URL
        ? "Configured; independent endpoint must be tested"
        : "Not configured",
      registration: "Unknown — verify in Twilio Console",
      lastTest:
        (
          db.prepare("SELECT value FROM meta WHERE key='last_test'").get() as
            { value: string } | undefined
        )?.value || null,
      reconciliation:
        (
          db
            .prepare("SELECT value FROM meta WHERE key='reconciliation_ok'")
            .get() as { value: string } | undefined
        )?.value || null,
      backup:
        (
          db.prepare("SELECT value FROM meta WHERE key='backup_ok'").get() as
            { value: string } | undefined
        )?.value || null,
      backupConfigured:
        !!process.env.BACKUP_UPLOAD_URL && !!process.env.BACKUP_PASSPHRASE,
      notificationIssues: (
        db
          .prepare(
            "SELECT count(*) n FROM outbox WHERE state IN ('failed','undelivered','blocked','ambiguous')",
          )
          .get() as { n: number }
      ).n,
      budgetAvailable: budgetAvailable(db),
    };
  });
  app.post("/api/demo-call", async (req, reply) => {
    if (isLive) return reply.code(404).send();
    if (demos.size >= 20)
      return reply.code(429).send({ error: "Finish an existing demo first." });
    const engine = new DemoIntakeEngine(db);
    demos.set(engine.id, {
      engine,
      sessionId: req.session.sessionId,
      expires: Date.now() + 300000,
    });
    return { id: engine.id, reply: engine.start() };
  });
  app.post<{ Params: { id: string } }>(
    "/api/demo-call/:id",
    async (req, reply) => {
      if (isLive) return reply.code(404).send();
      const d = demos.get(req.params.id);
      if (!d || d.sessionId !== req.session.sessionId)
        return reply.code(404).send({ error: "Demo expired" });
      const b = z
        .object({
          text: z.string().max(1000).optional(),
          hangup: z.boolean().optional(),
        })
        .parse(req.body);
      const result = b.hangup ? d.engine.end() : d.engine.turn(b.text || "");
      if (result.ended) demos.delete(req.params.id);
      await worker();
      return result;
    },
  );
  app.post("/api/demo-intake", async (req) => {
    if (isLive) throw Object.assign(new Error(), { statusCode: 404 });
    const body = z
      .object({
        scenario: z
          .enum(["complete", "abandoned", "urgent"])
          .default("complete"),
      })
      .parse(req.body);
    const id = `DEMO-${randomBytes(8).toString("hex")}`;
    db.transaction(() => {
      capture(db, id, body.scenario === "abandoned" ? null : "+15555550142");
      db.prepare("UPDATE calls SET consent='accepted' WHERE id=?").run(id);
      if (body.scenario !== "abandoned")
        updateIntake(
          db,
          id,
          {
            name: "Maria Gonzalez",
            callback: "+15555550142",
            callbackConfirmed: true,
            city: "West Palm Beach",
            address: "124 Example Lane",
            problem: "Water leaking below the kitchen sink.",
            property: "Residential",
            urgency: body.scenario === "urgent" ? "Urgent" : "Routine",
            activeLeak: true,
            preferredTime: "This afternoon",
          },
          publicUrl,
        );
      finalize(
        db,
        id,
        body.scenario === "abandoned" ? "abandoned" : "completed",
        publicUrl,
      );
      db.prepare("INSERT OR REPLACE INTO meta VALUES('last_test',?)").run(
        JSON.stringify({
          at: Date.now(),
          mode: "demo",
          callId: id,
          result: "Simulated intake and notification intents created",
        }),
      );
    })();
    await worker();
    return { id, simulated: true };
  });
  app.post("/api/test-alerts", async (req) => {
    if (!isLive) throw Object.assign(new Error(), { statusCode: 400 });
    z.object({ confirm: z.literal("SEND TWO REAL SMS") }).parse(req.body);
    const s = settings(db);
    if (!s.recipients.every((r) => r.phone && r.optedIn))
      throw Object.assign(new Error(), { statusCode: 400 });
    const id = `TEST-${randomBytes(8).toString("hex")}`;
    capture(db, id, null);
    updateIntake(
      db,
      id,
      { problem: "Authorized live test alert. No customer call." },
      publicUrl,
    );
    finalize(db, id, "test", publicUrl);
    await worker();
    db.prepare("INSERT OR REPLACE INTO meta VALUES('last_test',?)").run(
      JSON.stringify({
        at: Date.now(),
        mode: "live",
        callId: id,
        result: "Enqueued; inspect both delivery states",
      }),
    );
    return { ok: true, id };
  });
  // All provider endpoints use the configured canonical origin; untrusted Host/X-Forwarded-Host never choose the signed URL.
  app.addHook("preValidation", async (req, reply) => {
    if (req.url.startsWith("/hooks/")) {
      const b = (req.body || {}) as Record<string, string>;
      if (!validSignature(req, b, req.url.startsWith("/hooks/relay?")))
        return reply.code(403).send("Invalid provider signature");
    }
  });
  const xml = (reply: import("fastify").FastifyReply, text: string) =>
    reply.type("text/xml").send(text);
  app.post("/hooks/voice", async (req, reply) => {
    const b = req.body as Record<string, string>;
    if (!validContext(b)) return reply.code(403).send();
    const c = capture(db, b.CallSid, b.From);
    if (c.finalized || stopping) return xml(reply, fallbackXml());
    return xml(reply, consentXml(settings(db).greeting));
  });
  app.post("/hooks/consent", async (req, reply) => {
    const b = req.body as Record<string, string>;
    if (!validContext(b)) return reply.code(403).send();
    const c = getCall(db, b.CallSid);
    if (!c) return reply.code(404).send();
    if (c.finalized) return xml(reply, fallbackXml());
    if (b.Digits !== "1") {
      db.prepare(
        "UPDATE calls SET consent=? WHERE id=? AND consent='pending'",
      ).run(b.Digits === "2" ? "declined" : "no-response", c.id);
      finalize(db, c.id, "declined-ai-callback", publicUrl);
      const r = new twilio.twiml.VoiceResponse();
      r.say(
        "We will pass the available caller ID to the team for a callback. If your number is blocked, please call again during business hours. No AI conversation has started. Thank you.",
      );
      r.hangup();
      return xml(reply, r.toString());
    }
    db.prepare("UPDATE calls SET consent='accepted' WHERE id=?").run(c.id);
    if (
      stopping ||
      !budgetAvailable(db) ||
      sessions.size >= settings(db).maxConcurrentCalls
    ) {
      finalize(db, c.id, "capacity-or-budget-fallback", publicUrl);
      return xml(reply, fallbackXml());
    }
    const existing = tickets.get(c.id);
    const token = existing?.token || randomBytes(32).toString("hex");
    tickets.set(c.id, { token, expires: Date.now() + 60000 });
    return xml(reply, relayXml(c.id, token, settings(db).maxCallSeconds));
  });
  app.post("/hooks/call-status", async (req, reply) => {
    const b = req.body as Record<string, string>;
    if (!validContext(b)) return reply.code(403).send();
    capture(db, b.CallSid, b.From);
    if (terminal.has(b.CallStatus))
      finalize(
        db,
        b.CallSid,
        b.CallStatus === "completed" ? "completed-partial" : b.CallStatus,
        publicUrl,
      );
    return reply.code(204).send();
  });
  app.post("/hooks/relay-end", async (req, reply) => {
    const b = req.body as Record<string, string>;
    if (!validContext(b)) return reply.code(403).send();
    const c = getCall(db, b.CallSid);
    if (c && !c.finalized) {
      finalize(db, c.id, "relay-ended", publicUrl);
      return xml(reply, fallbackXml());
    }
    const r = new twilio.twiml.VoiceResponse();
    if (c?.outcome === "provider-fallback")
      r.redirect(process.env.FALLBACK_URL!);
    else r.hangup();
    return xml(reply, r.toString());
  });
  app.post<{ Querystring: { outbox: string } }>(
    "/hooks/sms-status",
    async (req, reply) => {
      const b = req.body as Record<string, string>;
      if (b.AccountSid !== process.env.TWILIO_ACCOUNT_SID)
        return reply.code(403).send();
      delivery(
        db,
        req.query.outbox,
        b.MessageSid,
        b.MessageStatus,
        b.ErrorCode ? `Provider error ${b.ErrorCode}` : undefined,
      );
      return reply.code(204).send();
    },
  );
  app.get<{ Querystring: { call: string; token: string } }>(
    "/hooks/relay",
    { websocket: true },
    (socket, req) => {
      const { call, token } = req.query;
      const t = tickets.get(call);
      const c = getCall(db, call);
      if (
        !t ||
        !token ||
        token.length !== t.token.length ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(t.token)) ||
        t.expires < Date.now() ||
        !c ||
        c.finalized ||
        sessions.has(call) ||
        stopping ||
        sessions.size >= settings(db).maxConcurrentCalls
      ) {
        socket.close(1008);
        return;
      }
      tickets.delete(call);
      db.prepare("UPDATE calls SET ai_started=?,updated=? WHERE id=?").run(
        Date.now(),
        Date.now(),
        call,
      );
      const s = new VoiceSession(
        db,
        call,
        socket,
        new OpenAITextModel(db, call),
        process.env.TWILIO_ACCOUNT_SID!,
      );
      sessions.set(call, s);
      socket.on("close", () => sessions.delete(call));
    },
  );
  const worker = createWorker(db);
  recoverSending(db);
  const recovery = createRecovery(db);
  const timers: NodeJS.Timeout[] = [];
  if (background) {
    timers.push(
      setInterval(() => {
        for (const [id, d] of demos)
          if (d.expires < Date.now()) {
            d.engine.end("duration-limit");
            demos.delete(id);
          }
        for (const [id, t] of tickets)
          if (t.expires < Date.now()) tickets.delete(id);
        void worker();
      }, 1000),
      setInterval(() => void recovery().catch(() => {}), 60000),
    );
    void recovery().catch(() => {});
    timers.push(setInterval(() => void backupEmail(db).catch(() => {}), 60000));
    if (process.env.BACKUP_UPLOAD_URL && process.env.BACKUP_PASSPHRASE) {
      timers.push(
        setInterval(() => void backupDatabase(db).catch(() => {}), 86400000),
      );
      const last = db
        .prepare("SELECT value FROM meta WHERE key='backup_ok'")
        .get() as { value: string } | undefined;
      if (!last || Date.now() - Number(last.value) > 86400000)
        void backupDatabase(db).catch(() => {});
    }
  }
  if (existsSync(resolve("dist/index.html"))) {
    await app.register(staticFiles, { root: resolve("dist") });
    app.setNotFoundHandler((req, reply) =>
      req.method === "GET" &&
      !req.url.startsWith("/api/") &&
      !req.url.startsWith("/hooks/")
        ? reply.sendFile("index.html")
        : reply.code(404).send({ error: "Not found" }),
    );
  }
  app.addHook("onClose", async () => {
    stopping = true;
    for (const t of timers) clearInterval(t);
    for (const d of demos.values()) d.engine.end("demo-interrupted");
    for (const s of sessions.values()) await s.fallback();
  });
  return {
    app,
    db,
    worker,
    recovery,
    async drain() {
      stopping = true;
      const end = Date.now() + 20000;
      while (sessions.size && Date.now() < end)
        await new Promise((r) => setTimeout(r, 200));
      await app.close();
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  const instance = await createApp();
  if (!isLive) seedDemo(instance.db);
  await instance.app.listen({
    port: Number(process.env.PORT) || 3000,
    host: "0.0.0.0",
  });
  console.log(
    `Leading Call Desk ${isLive ? "LIVE" : "DEMO (simulated providers)"} listening on port ${Number(process.env.PORT) || 3000}`,
  );
  let shutting = false;
  for (const sig of ["SIGTERM", "SIGINT"])
    process.on(sig, () => {
      if (shutting) return;
      shutting = true;
      void instance.drain().then(() => {
        instance.db.close();
        process.exit(0);
      });
    });
}
