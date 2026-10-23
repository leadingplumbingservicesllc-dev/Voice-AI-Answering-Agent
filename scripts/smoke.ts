// Paid providers are never used. Refuse live mode before any mutation.
const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
let cookie = "",
  csrf = "";
async function request(path: string, method = "GET", body?: unknown) {
  const r = await fetch(base + "/api/" + path, {
    method,
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": csrf,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const cookies = r.headers.getSetCookie();
  if (cookies.length) cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  const json = await r.json();
  if (!r.ok) throw new Error(`Smoke request ${path}: ${r.status}`);
  if (json.csrf) csrf = json.csrf;
  return json;
}
const session = await request("session");
if (session.mode !== "demo") throw new Error("Smoke script refuses live mode");
await request("demo-login", "POST", {});
const call = await request("demo-call", "POST", {});
await request("demo-call/" + call.id, "POST", {
  text: "Fictional smoke caller",
});
await request("demo-call/" + call.id, "POST", { hangup: true });
const details = await request("calls/" + call.id);
if (
  details.intake.name !== "Fictional smoke caller" ||
  !details.finalized ||
  details.deliveries.length !== 2
)
  throw new Error("Partial call capture or two-recipient intents failed");
console.log(
  "PASS: authenticated demo API, saved partial intake and two recipient intents. No real SMS.",
);
