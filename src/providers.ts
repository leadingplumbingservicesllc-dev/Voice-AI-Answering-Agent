import twilio from "twilio";
import type { FastifyRequest } from "fastify";
import { isLive, publicUrl } from "./config.js";
export const twilioClient = () =>
  twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, {
    autoRetry: false,
    timeout: 12000,
  });
export function externalUrl(rawUrl: string, websocket = false) {
  return `${websocket ? publicUrl.replace(/^https:/, "wss:") : publicUrl}${rawUrl}`;
}
export function validSignature(
  req: FastifyRequest,
  body: Record<string, string>,
  websocket = false,
) {
  if (!isLive) return false;
  const signature = req.headers["x-twilio-signature"];
  if (typeof signature !== "string") return false; // Upgrade signature uses the HTTPS URL, not the WSS scheme.
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    signature,
    externalUrl(req.raw.url || "/"),
    websocket ? {} : body,
  );
}
export function validContext(body: Record<string, string>) {
  return (
    body.AccountSid === process.env.TWILIO_ACCOUNT_SID &&
    body.To === process.env.TWILIO_NUMBER &&
    /^CA[0-9a-fA-F]{32}$/.test(body.CallSid || "")
  );
}
export function fallbackXml() {
  const r = new twilio.twiml.VoiceResponse();
  r.redirect({ method: "POST" }, process.env.FALLBACK_URL!);
  return r.toString();
}
export function consentXml(greeting: string) {
  const r = new twilio.twiml.VoiceResponse();
  const g = r.gather({
    input: ["dtmf"],
    numDigits: 1,
    timeout: 8,
    action: `${publicUrl}/hooks/consent`,
    actionOnEmptyResult: true,
  });
  g.say(greeting);
  return r.toString();
}
export function relayXml(id: string, token: string, maxSeconds: number) {
  const r = new twilio.twiml.VoiceResponse();
  const connect = r.connect({ action: `${publicUrl}/hooks/relay-end` });
  connect.conversationRelay({
    url: `${publicUrl.replace("https:", "wss:")}/hooks/relay?call=${id}&token=${token}`,
    language: "en-US",
    interruptible: "any",
    welcomeGreeting:
      "I am the Leading Plumbing AI answering assistant. What can I help the team call you back about?",
  }); // The live duration timer is enforced by the application, independently of generation.
  void maxSeconds;
  return r.toString();
}
