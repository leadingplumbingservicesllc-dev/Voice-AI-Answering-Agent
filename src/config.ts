import { z } from "zod";
export const e164 = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Use E.164, for example +15555550100");
export const settingsSchema = z
  .object({
    recipients: z.tuple([
      z.object({
        name: z.string().min(1).max(40),
        phone: z.union([e164, z.literal("")]),
        optedIn: z.boolean(),
      }),
      z.object({
        name: z.string().min(1).max(40),
        phone: z.union([e164, z.literal("")]),
        optedIn: z.boolean(),
      }),
    ]),
    backupEmail: z.union([z.email(), z.literal("")]),
    greeting: z.string().min(20).max(600),
    serviceArea: z.string().max(300),
    fallbackNumbers: z.array(e164).max(2),
    retentionDays: z.number().int().min(1).max(365),
    model: z.enum(["gpt-4.1-mini"]),
    monthlyAiMinutes: z.number().min(0).max(100000),
    maxCallSeconds: z.number().int().min(60).max(600),
    maxConcurrentCalls: z.number().int().min(1).max(10),
  })
  .superRefine((s, c) => {
    if (
      s.recipients[0].phone &&
      s.recipients[0].phone === s.recipients[1].phone
    )
      c.addIssue({
        code: "custom",
        path: ["recipients"],
        message: "Choose two distinct recipients",
      });
    for (const n of s.fallbackNumbers)
      if (
        n === process.env.TWILIO_NUMBER ||
        n === process.env.PUBLIC_BUSINESS_NUMBER
      )
        c.addIssue({
          code: "custom",
          path: ["fallbackNumbers"],
          message: "Transfer would create a routing loop",
        });
  });
export type Settings = z.infer<typeof settingsSchema>;
export const defaults: Settings = {
  recipients: [
    {
      name: "Owner",
      phone:
        process.env.OWNER_ALERT_NUMBER ||
        (process.env.APP_MODE === "live" ? "" : "+15555550100"),
      optedIn:
        process.env.APP_MODE !== "live" && !process.env.OWNER_ALERT_NUMBER,
    },
    {
      name: "Son",
      phone:
        process.env.SON_ALERT_NUMBER ||
        (process.env.APP_MODE === "live" ? "" : "+15555550101"),
      optedIn: process.env.APP_MODE !== "live" && !process.env.SON_ALERT_NUMBER,
    },
  ],
  backupEmail: process.env.BACKUP_EMAIL || "",
  greeting:
    "Thank you for calling Leading Plumbing Services. I am an AI answering assistant. With your permission, our providers will process your speech to capture a callback request. Press 1 to agree, or 2 for a callback without AI.",
  serviceArea: "Palm Beach and Broward counties, South Florida",
  fallbackNumbers: [
    process.env.FALLBACK_NUMBER,
    process.env.SECONDARY_FALLBACK_NUMBER,
  ].filter((x): x is string => !!x),
  retentionDays: 90,
  model: z
    .enum(["gpt-4.1-mini"])
    .parse(process.env.OPENAI_MODEL || "gpt-4.1-mini"),
  monthlyAiMinutes: 300,
  maxCallSeconds: 300,
  maxConcurrentCalls: 5,
};
export const mode = process.env.APP_MODE || "demo";
if (!["demo", "live"].includes(mode))
  throw new Error("APP_MODE must be demo or live");
export const isLive = mode === "live";
export const publicUrl = (
  process.env.PUBLIC_BASE_URL || "http://localhost:3000"
).replace(/\/$/, "");
export const dbPath = process.env.DATABASE_PATH || "data/call-desk.sqlite";
export function liveRequirements() {
  return [
    "PUBLIC_BASE_URL",
    "SESSION_SECRET",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_NUMBER",
    "OPENAI_API_KEY",
    "FALLBACK_URL",
  ].map((name) => ({ name, present: !!process.env[name] }));
}
if (
  isLive &&
  (!publicUrl.startsWith("https://") ||
    liveRequirements().some((r) => !r.present))
)
  throw new Error(
    "Live mode requires HTTPS and all deployment credentials; see .env.example",
  );

settingsSchema.parse(defaults);
if (isLive) {
  e164.parse(process.env.TWILIO_NUMBER);
  if (process.env.PUBLIC_BUSINESS_NUMBER)
    e164.parse(process.env.PUBLIC_BUSINESS_NUMBER);
  const fallback = new URL(process.env.FALLBACK_URL!);
  if (
    fallback.protocol !== "https:" ||
    fallback.hostname === new URL(publicUrl).hostname
  )
    throw new Error("Fallback must be independent HTTPS infrastructure");
  const origin = new URL(publicUrl);
  if (
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  )
    throw new Error("PUBLIC_BASE_URL must be an HTTPS origin only");
}
