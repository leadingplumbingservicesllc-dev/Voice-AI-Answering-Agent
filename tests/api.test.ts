import { it, expect } from "vitest";
import { createApp } from "../src/server.js";
import { openDb, settings } from "../src/db.js";
import { hash } from "@node-rs/argon2";
it("protects private details, mutations and settings with individual sessions and CSRF", async () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users VALUES(?,?,?)").run(
    "owner",
    "owner@example.test",
    await hash("a long test-only password"),
  );
  const { app } = await createApp(db, false);
  await app.ready();
  expect((await app.inject("/api/calls")).statusCode).toBe(401);
  let r = await app.inject("/api/session");
  let cookie = r.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  let csrf = r.json().csrf;
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/demo-login",
        headers: { cookie },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  r = await app.inject({
    method: "POST",
    url: "/api/login",
    headers: { cookie, "x-csrf-token": csrf },
    payload: {
      email: "owner@example.test",
      password: "a long test-only password",
    },
  });
  expect(r.statusCode).toBe(200);
  cookie = r.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  csrf = r.json().csrf;
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/demo-intake",
        headers: {
          cookie,
          "x-csrf-token": csrf,
          origin: "https://evil.example",
        },
        payload: { scenario: "complete" },
      })
    ).statusCode,
  ).toBe(403);
  r = await app.inject({
    method: "POST",
    url: "/api/demo-intake",
    headers: { cookie, "x-csrf-token": csrf },
    payload: { scenario: "complete" },
  });
  expect(r.statusCode).toBe(200);
  const id = r.json().id;
  r = await app.inject({ url: `/api/calls/${id}`, headers: { cookie } });
  expect(r.statusCode).toBe(200);
  expect(r.json().intake.callbackConfirmed).toBe(true);
  expect(r.json().deliveries).toHaveLength(2);
  expect(
    r
      .json()
      .deliveries.every((d: { state: string }) => d.state === "delivered"),
  ).toBe(true);
  expect((await app.inject(`/api/calls/${id}`)).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        method: "PATCH",
        url: `/api/calls/${id}`,
        headers: { cookie },
        payload: { status: "Closed" },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: "PATCH",
        url: `/api/calls/${id}`,
        headers: { cookie, "x-csrf-token": csrf },
        payload: { status: "Closed" },
      })
    ).statusCode,
  ).toBe(200);
  const s = settings(db);
  s.recipients[1].phone = s.recipients[0].phone;
  expect(
    (
      await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: { cookie, "x-csrf-token": csrf },
        payload: s,
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/hooks/voice",
        payload: { CallSid: "fake" },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: "DELETE",
        url: `/api/calls/${id}`,
        headers: { cookie, "x-csrf-token": csrf },
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  await app.close();
  db.close();
});
