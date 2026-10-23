import nodemailer from "nodemailer";
import { type DB, type Outbox, settings } from "./db.js";
import { isLive } from "./config.js";
export async function backupEmail(db: DB) {
  if (
    !isLive ||
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASSWORD ||
    !process.env.SMTP_FROM ||
    !settings(db).backupEmail
  )
    return;
  const rows = db
    .prepare(
      "SELECT * FROM outbox WHERE state IN ('failed','undelivered','ambiguous') AND id NOT IN(SELECT substr(key,7) FROM meta WHERE key LIKE 'email:%') LIMIT 10",
    )
    .all() as Outbox[];
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: (Number(process.env.SMTP_PORT) || 465) === 465,
    requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 10000,
  });
  for (const r of rows) {
    // A separate durable claim avoids an email resend loop after an uncertain send.
    const claim = db
      .prepare("INSERT OR IGNORE INTO meta VALUES(?,?)")
      .run(`email:${r.id}`, "sending");
    if (!claim.changes) continue;
    try {
      await transport.sendMail({
        from: process.env.SMTP_FROM,
        to: settings(db).backupEmail,
        subject: "Leading Call Desk: alert delivery needs attention",
        text: `An internal SMS alert has status ${r.state}. Check the private inbox. This backup email is not proof of SMS delivery.\n\n${r.body}`,
      });
      db.prepare("UPDATE meta SET value=? WHERE key=?").run(
        "sent",
        `email:${r.id}`,
      );
    } catch {
      db.prepare("UPDATE meta SET value=? WHERE key=?").run(
        "failed-or-ambiguous; inspect SMTP provider",
        `email:${r.id}`,
      );
    }
  }
  transport.close();
}
