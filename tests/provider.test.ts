import { it, expect, vi } from "vitest";
import twilio from "twilio";
import { WebSocket } from "ws";
// Test-only placeholders; no network calls and no usable credentials.
vi.stubEnv("APP_MODE", "live");
vi.stubEnv("PUBLIC_BASE_URL", "https://desk.example.test");
vi.stubEnv(
  "SESSION_SECRET",
  "test-only-session-secret-with-at-least-32-characters",
);
vi.stubEnv("TWILIO_ACCOUNT_SID", "AC" + "a".repeat(32));
vi.stubEnv("TWILIO_AUTH_TOKEN", "test-only-auth-token");
vi.stubEnv("TWILIO_NUMBER", "+15555550100");
vi.stubEnv("OPENAI_API_KEY", "test-only-key");
vi.stubEnv("FALLBACK_URL", "https://handler.twilio.com/twiml/test-only");
const { createApp } = await import("../src/server.js");
const { openDb, getCall, settings } = await import("../src/db.js");
const account = process.env.TWILIO_ACCOUNT_SID!,
  token = process.env.TWILIO_AUTH_TOKEN!,
  base = process.env.PUBLIC_BASE_URL!;
it("verifies exact canonical signatures behind a proxy; duplicates and reordered status never duplicate records or intents", async () => {
  const db = openDb(":memory:");
  const { app } = await createApp(db, false);
  await app.ready();
  const call = "CA" + "b".repeat(32);
  const b = {
    AccountSid: account,
    To: process.env.TWILIO_NUMBER!,
    CallSid: call,
    From: "+15555550142",
  };
  const post = async (
    path: string,
    body: Record<string, string>,
    signature?: string,
  ) =>
    app.inject({
      method: "POST",
      url: path,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature":
          signature ||
          twilio.getExpectedTwilioSignature(token, base + path, body),
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https",
      },
      payload: new URLSearchParams(body).toString(),
    });
  expect((await post("/hooks/voice", b, "forged")).statusCode).toBe(403);
  expect(db.prepare("SELECT * FROM calls").all()).toHaveLength(0);
  let r = await post("/hooks/voice", b);
  expect(r.statusCode).toBe(200);
  expect(r.body).toContain("<Gather");
  expect(r.body).not.toContain("ConversationRelay");
  expect(getCall(db, call)!.consent).toBe("pending");
  await post("/hooks/voice", b);
  expect(db.prepare("SELECT * FROM calls").all()).toHaveLength(1);
  await post("/hooks/call-status", { ...b, CallStatus: "completed" });
  await post("/hooks/call-status", { ...b, CallStatus: "ringing" });
  await post("/hooks/call-status", { ...b, CallStatus: "completed" });
  expect(getCall(db, call)!.finalized).toBe(1);
  expect(db.prepare("SELECT * FROM outbox").all()).toHaveLength(2);
  const second = { ...b, CallSid: "CA" + "c".repeat(32), From: "anonymous" };
  await post("/hooks/voice", second);
  r = await post("/hooks/consent", { ...second, Digits: "2" });
  expect(r.body).not.toContain("ConversationRelay");
  expect(getCall(db, second.CallSid)!.consent).toBe("declined");
  expect(getCall(db, second.CallSid)!.caller).toBe(null);
  const third = { ...b, CallSid: "CA" + "d".repeat(32) };
  await post("/hooks/voice", third);
  const s = settings(db);
  s.monthlyAiMinutes = 0;
  db.prepare("UPDATE settings SET json=?").run(JSON.stringify(s));
  r = await post("/hooks/consent", { ...third, Digits: "1" });
  expect(r.body).toContain("<Redirect");
  expect(getCall(db, third.CallSid)!.outcome).toBe(
    "capacity-or-budget-fallback",
  );
  expect(
    (await post("/hooks/voice", { ...b, AccountSid: "AC-wrong" })).statusCode,
  ).toBe(403);
  expect((await app.inject("/api/demo-login")).statusCode).not.toBe(200);
  await app.close();
  db.close();
});
it("accepts signed WSS upgrade only with a one-time bound consent ticket", async () => {
  const db = openDb(":memory:");
  const { app } = await createApp(db, false);
  await app.ready();
  const call = "CA" + "e".repeat(32),
    b = {
      AccountSid: account,
      To: process.env.TWILIO_NUMBER!,
      CallSid: call,
      From: "+15555550142",
    };
  const post = (path: string, body: Record<string, string>) =>
    app.inject({
      method: "POST",
      url: path,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": twilio.getExpectedTwilioSignature(
          token,
          base + path,
          body,
        ),
      },
      payload: new URLSearchParams(body).toString(),
    });
  await post("/hooks/voice", b);
  const r = await post("/hooks/consent", { ...b, Digits: "1" });
  expect(r.body).toContain("ConversationRelay");
  const match = r.body
    .match(/url="([^"]+)"/g)!
    .find((v) => v.includes("wss:"))!;
  const url = new URL(match.slice(5, -1).replaceAll("&amp;", "&"));
  const path = url.pathname + url.search;
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const socket = new WebSocket(address.replace("http:", "ws:") + path, {
    headers: {
      "x-twilio-signature": twilio.getExpectedTwilioSignature(
        token,
        base + path,
        {},
      ),
    },
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(
    JSON.stringify({
      type: "setup",
      callSid: call,
      sessionId: "test-session",
      to: process.env.TWILIO_NUMBER,
    }),
  );
  socket.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(getCall(db, call)!.ai_started).not.toBeNull();
  expect(getCall(db, call)!.finalized).toBe(1);
  await app.close();
  db.close();
});
