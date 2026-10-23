import { type DB, type Call, getCall, settings } from "./db.js";
import { capture, finalize, prune } from "./lifecycle.js";
import { reconcileMessages } from "./notifications.js";
import { isLive, publicUrl } from "./config.js";
import { twilioClient } from "./providers.js";
export function createRecovery(db: DB) {
  let busy = false;
  return async () => {
    if (busy) return;
    busy = true;
    try {
      prune(db);
      db.prepare("DELETE FROM session_store WHERE expires<?").run(Date.now());
      if (!isLive) return;
      const client = twilioClient();
      const stale = db
        .prepare("SELECT * FROM calls WHERE finalized=0 AND updated<?")
        .all(Date.now() - 60000) as Call[];
      for (const c of stale) {
        try {
          const remote = await client.calls(c.id).fetch();
          if (
            ["completed", "failed", "busy", "no-answer", "canceled"].includes(
              remote.status,
            )
          )
            finalize(db, c.id, "recovered-partial", publicUrl);
          else if (
            Date.now() - c.created >
            (settings(db).maxCallSeconds + 60) * 1000
          ) {
            await client
              .calls(c.id)
              .update({ url: process.env.FALLBACK_URL!, method: "POST" });
            finalize(db, c.id, "recovered-stuck", publicUrl);
          }
        } catch {
          /* Remains unfinished for the next reconciliation. */
        }
      }
      const watermark = db
        .prepare("SELECT value FROM meta WHERE key='reconciled_at'")
        .get() as { value: string } | undefined;
      const since = watermark
        ? Number(watermark.value) - 120000
        : Date.now() - 86400000;
      try {
        let seen = 0;
        let complete = true;
        const page = await client.calls.page({
          to: process.env.TWILIO_NUMBER,
          startTimeAfter: new Date(since),
          pageSize: 100,
        });
        let next: typeof page | undefined = page;
        while (next) {
          for (const c of next.instances) {
            seen++;
            if (c.direction !== "inbound" || c.to !== process.env.TWILIO_NUMBER)
              continue;
            if (!getCall(db, c.sid)) {
              capture(db, c.sid, c.from, c.startTime?.getTime() || Date.now());
            }
            if (
              ["completed", "failed", "busy", "no-answer", "canceled"].includes(
                c.status,
              )
            )
              finalize(db, c.sid, "recovered-missed", publicUrl);
          }
          if (seen >= 1000 && next.nextPageUrl) {
            complete = false;
            break;
          }
          next = next.nextPageUrl
            ? ((await next.nextPage()) as typeof page)
            : undefined;
        }
        if (complete) {
          db.prepare(
            "INSERT OR REPLACE INTO meta VALUES('reconciled_at',?)",
          ).run(String(Date.now()));
          db.prepare(
            "INSERT OR REPLACE INTO meta VALUES('reconciliation_ok',?)",
          ).run(String(Date.now()));
        }
      } catch {
        /* Do not advance the watermark on failure or truncation. */
      }
      await reconcileMessages(db);
    } finally {
      busy = false;
    }
  };
}
