import { openDb, settings, type Outbox } from "../src/db.js";
import { capture, updateIntake, finalize } from "../src/lifecycle.js";
import { createWorker } from "../src/notifications.js";
import { randomUUID } from "node:crypto";
import { isLive } from "../src/config.js";
if (isLive) throw new Error("Simulation is disabled in live mode");
const db = openDb();
const s = settings(db);
s.recipients = [
  { name: "Owner", phone: "+15555550100", optedIn: true },
  { name: "Son", phone: "+15555550101", optedIn: true },
];
db.prepare("UPDATE settings SET json=?").run(JSON.stringify(s));
const ids = [];
for (const scenario of ["complete", "urgent", "abandoned"]) {
  const id = `SIM-${randomUUID()}`;
  ids.push(id);
  capture(db, id, scenario === "abandoned" ? null : "+15555550142");
  if (scenario !== "abandoned")
    updateIntake(
      db,
      id,
      {
        name: "Fictional caller",
        callback: "+15555550142",
        callbackConfirmed: true,
        city: "West Palm Beach",
        problem: "Kitchen sink leak.",
        urgency: scenario === "urgent" ? "Urgent" : "Routine",
      },
      "http://localhost:3000",
    );
  finalize(
    db,
    id,
    scenario === "abandoned" ? "abandoned" : "completed",
    "http://localhost:3000",
  );
  capture(db, id, null);
  finalize(db, id, "duplicate", "http://localhost:3000");
}
await createWorker(db)();
for (const id of ids) {
  const rows = db
    .prepare("SELECT recipient,kind,state,segments FROM outbox WHERE call_id=?")
    .all(id) as Outbox[];
  console.log(id, rows);
  if (
    rows.filter((r) => r.kind === "final").length !== 2 ||
    rows.some((r) => r.state !== "delivered")
  )
    throw new Error("Simulation failed");
}
db.close();
console.log(
  "PASS: simulated capture, urgent/final alerts, abandon recovery and duplicate suppression. No real SMS sent.",
);
