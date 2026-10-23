import { type DB, type Outbox, settings } from "./db.js";
import { isLive, publicUrl } from "./config.js";
import { twilioClient } from "./providers.js";
export type SendResult = { id: string; status: string };
export type Sender = (row: Outbox) => Promise<SendResult>;
export const sendSms: Sender = async (row) => {
  if (!isLive) return { id: `MOCK-${row.id}`, status: "delivered" };
  const msg = await twilioClient().messages.create({
    to: row.destination,
    ...(process.env.TWILIO_MESSAGING_SERVICE_SID
      ? { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID }
      : { from: process.env.TWILIO_NUMBER }),
    body: row.body,
    statusCallback: `${publicUrl}/hooks/sms-status?outbox=${row.id}`,
  });
  return { id: msg.sid, status: msg.status };
};
const rank: Record<string, number> = {
  pending: 0,
  sending: 1,
  accepted: 2,
  queued: 2,
  sending_provider: 3,
  sent: 4,
  undelivered: 5,
  failed: 5,
  delivered: 6,
};
export function delivery(
  db: DB,
  id: string,
  sid: string,
  status: string,
  error?: string,
) {
  if (status === "sending") status = "sending_provider";
  db.transaction(() => {
    const row = db.prepare("SELECT * FROM outbox WHERE id=?").get(id) as
      Outbox | undefined;
    if (!row || (row.provider_id && row.provider_id !== sid)) return;
    if (!(status in rank) || ["pending", "sending"].includes(status)) return;
    const key = `${sid}:${status}`;
    db.prepare("INSERT OR IGNORE INTO delivery_events VALUES(?,?,?,?,?)").run(
      key,
      id,
      sid,
      status,
      Date.now(),
    );
    if ((rank[status] || 0) < (rank[row.state] || 0)) return;
    db.prepare(
      "UPDATE outbox SET state=?,provider_id=?,error=?,updated=? WHERE id=?",
    ).run(status, sid, error || null, Date.now(), id);
  })();
}
export function createWorker(db: DB, send: Sender = sendSms) {
  let busy = false;
  return async () => {
    if (busy) return;
    busy = true;
    try {
      const rows = db
        .prepare(
          "SELECT * FROM outbox WHERE state IN ('pending','retry') AND next_attempt<=? ORDER BY next_attempt LIMIT 10",
        )
        .all(Date.now()) as Outbox[];
      for (const row of rows) {
        const r = settings(db).recipients[row.recipient];
        if (!r.optedIn || r.phone !== row.destination) {
          db.prepare(
            "UPDATE outbox SET state='blocked',error='Recipient configuration changed; review required',updated=? WHERE id=?",
          ).run(Date.now(), row.id);
          continue;
        }
        const claim = db
          .prepare(
            "UPDATE outbox SET state='sending',attempts=attempts+1,updated=? WHERE id=? AND state IN ('pending','retry')",
          )
          .run(Date.now(), row.id);
        if (!claim.changes) continue;
        try {
          const result = await send(row);
          delivery(db, row.id, result.id, result.status); // A callback may have arrived before the create response.
        } catch (e) {
          const err = e as { status?: number; code?: number };
          const permanent =
            [21211, 21610, 21614, 21408, 21606].includes(err.code || 0) ||
            (!!err.status &&
              err.status >= 400 &&
              err.status < 500 &&
              err.status !== 429);
          const uncertain = !err.status || err.status >= 500;
          const state = permanent
            ? "failed"
            : uncertain
              ? "ambiguous"
              : row.attempts >= 4
                ? "failed"
                : "retry";
          const delay =
            Math.min(300000, 2000 * 2 ** row.attempts) *
            (0.75 + Math.random() * 0.5);
          db.prepare(
            "UPDATE outbox SET state=?,error=?,next_attempt=?,updated=? WHERE id=? AND provider_id IS NULL",
          ).run(
            state,
            permanent
              ? `Provider rejected (${err.code || err.status})`
              : uncertain
                ? "Acceptance unknown; reconcile before resending"
                : "Rate limited; retry scheduled",
            Date.now() + delay,
            Date.now(),
            row.id,
          );
        }
      }
    } finally {
      busy = false;
    }
  };
}
export function recoverSending(db: DB) {
  db.prepare(
    "UPDATE outbox SET state='ambiguous',error='Process stopped during send; reconcile before resending' WHERE state='sending'",
  ).run();
}
export async function reconcileMessages(db: DB) {
  if (!isLive) return;
  const rows = db
    .prepare(
      "SELECT * FROM outbox WHERE state IN ('ambiguous','accepted','queued','sent','sending_provider') AND updated<? LIMIT 30",
    )
    .all(Date.now() - 60000) as Outbox[];
  for (const row of rows) {
    try {
      if (row.provider_id) {
        const m = await twilioClient().messages(row.provider_id).fetch();
        delivery(
          db,
          row.id,
          m.sid,
          m.status,
          m.errorCode ? `Provider error ${m.errorCode}` : undefined,
        );
      } else {
        const found = (
          await twilioClient().messages.list({
            to: row.destination,
            dateSentAfter: new Date(row.updated - 120000),
            limit: 100,
          })
        ).filter(
          (m) =>
            m.body === row.body &&
            (m.from === process.env.TWILIO_NUMBER ||
              m.messagingServiceSid ===
                process.env.TWILIO_MESSAGING_SERVICE_SID),
        );
        if (found.length === 1)
          delivery(db, row.id, found[0].sid, found[0].status);
      }
    } catch {
      /* Retry reconciliation on the next scheduled pass; no personal data in logs. */
    }
  }
}
