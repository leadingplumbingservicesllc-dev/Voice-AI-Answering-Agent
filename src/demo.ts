import { randomUUID } from "node:crypto";
import { capture, updateIntake, finalize } from "./lifecycle.js";
import { getCall, type DB, type Intake } from "./db.js";
import { dangerPattern, policyReply } from "./voice.js";
import { publicUrl } from "./config.js";
// Deliberately deterministic local simulator. It is not an AI or speech provider.
export class DemoIntakeEngine {
  readonly id = "DEMO-" + randomUUID();
  private step = 0;
  private noise = 0;
  private candidate = "";
  private ended = false;
  readonly questions = [
    "What name should I pass to the team?",
    "What is the best callback number, including country code?",
    "",
    "What is the service address and city?",
    "Is this residential or commercial?",
    "Please describe the plumbing problem.",
    "Is this urgent, and is there an active leak?",
    "When would you prefer a callback?",
  ];
  constructor(private db: DB) {
    capture(db, this.id, null);
    db.prepare("UPDATE calls SET consent='accepted-demo' WHERE id=?").run(
      this.id,
    );
  }
  start() {
    return (
      "SIMULATED CALL: I am the Leading Plumbing AI answering assistant. No audio is processed and no real SMS will be sent. " +
      this.questions[0]
    );
  }
  turn(raw: string): { reply: string; ended: boolean } {
    if (this.ended) return { reply: "This demo call has ended.", ended: true };
    const text = raw.trim().slice(0, 1000);
    const policy = policyReply(text);
    if (policy) {
      if (dangerPattern.test(text))
        updateIntake(
          this.db,
          this.id,
          {
            urgency: "Immediate danger",
            problem: "Caller reported possible immediate danger.",
          },
          publicUrl,
        );
      return { reply: policy, ended: false };
    }
    if (!text || /^(noise|\?+|unclear|silence)$/i.test(text)) {
      this.noise++;
      if (this.noise >= 2)
        return this.end(
          "partial",
          "I am having trouble understanding. I will pass along the available callback details.",
        );
      return {
        reply: "I could not understand that. Please try once more.",
        ended: false,
      };
    }
    this.noise = 0;
    const patch: Intake = {};
    if (this.step === 0) patch.name = text;
    else if (this.step === 1) {
      const number = text.replace(/[^+\d]/g, "");
      if (!/^\+[1-9]\d{7,14}$/.test(number))
        return {
          reply:
            "For this demo, please type a full number such as +15555550142.",
          ended: false,
        };
      this.candidate = number;
      updateIntake(
        this.db,
        this.id,
        { callback: number, callbackConfirmed: false },
        publicUrl,
      );
      this.step = 2;
      return {
        reply: `Is ${number} the correct callback number? Say yes, or type the corrected number.`,
        ended: false,
      };
    } else if (this.step === 2) {
      if (!/^(yes|correct|right)\b/i.test(text)) {
        this.step = 1;
        return this.turn(text);
      }
      patch.callback = this.candidate;
      patch.callbackConfirmed = true;
    } else if (this.step === 3) {
      patch.address = text;
      patch.city = text.includes(",")
        ? text.split(",").slice(1).join(",").trim()
        : "Unknown (city not separated by comma)";
    } else if (this.step === 4)
      patch.property = /commercial|office|business/i.test(text)
        ? "Commercial"
        : /residen|home|house/i.test(text)
          ? "Residential"
          : "Unknown";
    else if (this.step === 5) patch.problem = text;
    else if (this.step === 6) {
      patch.urgency = /urgent|asap/i.test(text) ? "Urgent" : "Routine";
      patch.activeLeak =
        /\b(yes|active|leaking)\b/i.test(text) && !/\b(no|not)\b/i.test(text);
    } else if (this.step === 7) patch.preferredTime = text;
    else
      return this.end(
        "completed",
        "Thank you. I will pass the request to the team for follow-up. No appointment or response time is promised.",
      );
    updateIntake(this.db, this.id, patch, publicUrl);
    this.step++;
    if (this.step === 8) {
      const i = JSON.parse(getCall(this.db, this.id)!.intake) as Intake;
      return {
        reply: `I have ${i.name}, ${i.callbackConfirmed ? i.callback : "callback unconfirmed"}, ${i.address}, and: ${i.problem}. Preferred callback: ${i.preferredTime}. Is that right? You can also hang up to save a partial request.`,
        ended: false,
      };
    }
    return { reply: this.questions[this.step], ended: false };
  }
  end(
    outcome = "abandoned",
    reply = "The demo call ended. Available details are saved as incomplete.",
  ) {
    this.ended = true;
    finalize(this.db, this.id, outcome, publicUrl);
    return { reply, ended: true };
  }
}
