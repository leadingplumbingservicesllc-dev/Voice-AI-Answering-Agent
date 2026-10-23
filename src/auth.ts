import cookie from "@fastify/cookie";
import session from "@fastify/session";
import { Authenticator } from "@fastify/passport";
import { Strategy } from "passport-local";
import { verify, hash } from "@node-rs/argon2";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, Session } from "fastify";
import type { DB } from "./db.js";
import { isLive, publicUrl } from "./config.js";
declare module "fastify" {
  interface PassportUser {
    id: string;
    email: string;
  }
  interface Session {
    csrf?: string;
  }
}
export async function setupAuth(app: FastifyInstance, db: DB) {
  const auth = new Authenticator();
  const dummy = await hash(randomBytes(24).toString("hex"));
  auth.use(
    "local",
    new Strategy({ usernameField: "email" }, async (email, password, done) => {
      try {
        const user = db
          .prepare("SELECT * FROM users WHERE email=?")
          .get(email.toLowerCase()) as
          { id: string; email: string; password_hash: string } | undefined;
        const ok = await verify(user?.password_hash || dummy, password);
        done(null, ok && user ? { id: user.id, email: user.email } : false);
      } catch {
        done(null, false);
      }
    }),
  );
  auth.registerUserSerializer(async (user: { id: string }) => user.id);
  auth.registerUserDeserializer(async (id: string) => {
    if (!isLive && id === "demo")
      return { id: "demo", email: "Demo workspace" };
    return db.prepare("SELECT id,email FROM users WHERE id=?").get(id) as
      { id: string; email: string } | undefined;
  });
  await app.register(cookie);
  await app.register(session, {
    secret: process.env.SESSION_SECRET || randomBytes(48).toString("hex"),
    cookieName: "lcd_session",
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isLive,
      sameSite: "strict",
      maxAge: 12 * 3600000,
      path: "/",
    },
    store: {
      set(id, data, cb) {
        try {
          db.prepare("INSERT OR REPLACE INTO session_store VALUES(?,?,?)").run(
            id,
            JSON.stringify(data),
            Date.now() + 12 * 3600000,
          );
          cb();
        } catch (e) {
          cb(e);
        }
      },
      get(id, cb) {
        try {
          const row = db
            .prepare("SELECT json FROM session_store WHERE id=? AND expires>?")
            .get(id, Date.now()) as { json: string } | undefined;
          cb(null, row ? (JSON.parse(row.json) as Session) : null);
        } catch (e) {
          cb(e);
        }
      },
      destroy(id, cb) {
        try {
          db.prepare("DELETE FROM session_store WHERE id=?").run(id);
          cb();
        } catch (e) {
          cb(e);
        }
      },
    },
  });
  await app.register(auth.initialize());
  await app.register(auth.secureSession());
  app.addHook("preValidation", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const csrf = req.headers["x-csrf-token"];
      const expected = req.session.csrf;
      const origin = req.headers.origin;
      const origins = [
        publicUrl,
        ...(!isLive ? ["http://localhost:5173", "http://127.0.0.1:5173"] : []),
      ];
      if (
        !expected ||
        typeof csrf !== "string" ||
        csrf.length !== expected.length ||
        !timingSafeEqual(Buffer.from(csrf), Buffer.from(expected)) ||
        (origin && !origins.includes(origin))
      )
        return reply
          .code(403)
          .send({ error: "Security check failed. Reload and try again." });
    }
    if (
      !["/api/session", "/api/login", "/api/demo-login"].includes(
        req.url.split("?")[0],
      ) &&
      !req.isAuthenticated()
    )
      return reply.code(401).send({ error: "Please sign in." });
  });
  app.get("/api/session", async (req) => {
    req.session.csrf ||= randomBytes(24).toString("hex");
    return {
      user: req.user || null,
      csrf: req.session.csrf,
      mode: isLive ? "live" : "demo",
    };
  });
  app.post(
    "/api/login",
    {
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      preValidation: auth.authenticate("local"),
    },
    async (req) => {
      req.session.csrf = randomBytes(24).toString("hex");
      return { user: req.user, csrf: req.session.csrf };
    },
  );
  if (!isLive)
    app.post("/api/demo-login", async (req) => {
      await req.logIn({ id: "demo", email: "Demo workspace" });
      req.session.csrf = randomBytes(24).toString("hex");
      return { user: req.user, csrf: req.session.csrf };
    });
  app.post("/api/logout", async (req) => {
    await req.session.destroy();
    return { ok: true };
  });
}
