import OpenAI from "openai";
import type { WebSocket } from "ws";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z } from "zod";
import { type DB, getCall, settings } from "./db.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { intakeSchema, updateIntake, finalize } from "./lifecycle.js";
import { publicUrl } from "./config.js";
import { twilioClient } from "./providers.js";
const message = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("setup"),
    callSid: z.string(),
    accountSid: z.string().optional(),
    to: z.string().optional(),
  }),
  z.object({
    type: z.literal("prompt"),
    voicePrompt: z.string().max(8000),
    last: z.boolean(),
  }),
  z.object({
    type: z.literal("interrupt"),
    utteranceUntilInterrupt: z.string().max(12000),
  }),
  z.object({ type: z.literal("error"), description: z.string().optional() }),
  z.object({ type: z.literal("dtmf"), digit: z.string() }),
]);
export function spokenDigits(text: string) {
  const words: Record<string, string> = {
    zero: "0",
    oh: "0",
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
  };
  return text
    .toLowerCase()
    .replace(
      /\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g,
      (w) => words[w],
    )
    .replace(/\D/g, "");
}
export const dangerPattern =
  /\b(gas (smell|odor|leak)|smell.{0,12}gas|fire|electrocution|electrical danger|life.threatening|severe injury|injured|electrical shock|sparking|unconscious|carbon monoxide|chest pain)\b/i;
export const injectionPattern =
  /(ignore.{0,30}(instructions|prompt)|system prompt|change.{0,30}recipient|send.{0,30}https?:|api key)/i;
export const dangerResponse =
  "Please move to a safe location and contact 911 or the appropriate emergency utility now. Do not wait for our callback.";
export function policyReply(text: string) {
  if (dangerPattern.test(text)) return dangerResponse;
  if (injectionPattern.test(text))
    return "I can only take a plumbing callback request. What problem would you like the team to call you about?";
  if (/\b(espa[nñ]ol|spanish|fran[cç]ais)\b/i.test(text))
    return "I can take a callback request in English. Please share a callback number so the team can follow up.";
  if (/\b(price|quote|appointment|book me)\b/i.test(text))
    return "I cannot quote prices or book appointments. I can ask the team to call you back. What is the plumbing issue?";
  return null;
}
export type ModelTurn = {
  reply: string;
  intake: unknown;
  finish: boolean;
  unintelligible: boolean;
};
export interface TextModel {
  turn(
    history: ChatCompletionMessageParam[],
    signal: AbortSignal,
    emit: (token: string) => void,
  ): Promise<ModelTurn>;
}
export class OpenAITextModel implements TextModel {
  client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 18000,
    maxRetries: 1,
  });
  async turn(
    history: ChatCompletionMessageParam[],
    signal: AbortSignal,
    emit: (token: string) => void,
  ) {
    const schema = {
      type: "object",
      properties: {
        reply: { type: "string" },
        intake: {
          type: "object",
          properties: Object.fromEntries(
            [
              "name",
              "callback",
              "address",
              "city",
              "problem",
              "property",
              "urgency",
              "preferredTime",
              "uncertainty",
            ]
              .map((k) => [k, { type: "string" }])
              .concat([
                ["callbackConfirmed", { type: "boolean" }],
                ["activeLeak", { type: "boolean" }],
              ]),
          ),
          additionalProperties: false,
        },
        finish: { type: "boolean" },
        unintelligible: { type: "boolean" },
      },
      required: ["reply", "intake", "finish", "unintelligible"],
      additionalProperties: false,
    };
    const stream = await this.client.chat.completions.create(
      {
        model: settings(this.db).model,
        messages: [
          {
            role: "system",
            content:
              SYSTEM_PROMPT +
              " Unverified caller ID candidate: " +
              JSON.stringify(
                this.callId
                  ? getCall(this.db, this.callId)?.caller || null
                  : null,
              ) +
              ". Never confirm it without readback and caller affirmation. " +
              " Configured service area (do not promise availability): " +
              JSON.stringify(settings(this.db).serviceArea) +
              ". Return JSON with reply (spoken response), intake (only factual updates, omit unknown values), finish (true only after readback/closing or callback fallback), unintelligible. Never confirm callback merely from caller ID. callbackConfirmed may be true only after explicit caller confirmation of the readback. Honor corrections.",
          },
          ...history,
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "intake_turn", strict: false, schema },
        },
        max_completion_tokens: 600,
        stream: true,
      },
      { signal },
    );
    let json = "";
    for await (const part of stream) {
      json += part.choices[0]?.delta.content || "";
    }
    const result = z
      .object({
        reply: z.string().max(1800),
        intake: intakeSchema,
        finish: z.boolean(),
        unintelligible: z.boolean(),
      })
      .parse(JSON.parse(json)); // Buffer the structured turn so malformed model JSON is never spoken.
    for (const chunk of result.reply.match(/.{1,100}(?:\s|$)|.{1,100}/g) || [])
      emit(chunk);
    return result;
  }
  constructor(
    private db: DB,
    private callId?: string,
  ) {}
}
export class VoiceSession {
  private history: ChatCompletionMessageParam[] = [];
  private abort?: AbortController;
  private generation = 0;
  private setup = false;
  private closed = false;
  private fallingBack = false;
  private failures = 0;
  private silenceCount = 0;
  private silenceTimer?: NodeJS.Timeout;
  private hardTimer: NodeJS.Timeout;
  private pendingCaller = "";
  private lastAssistantIndex = -1;
  private generated = "";
  private durationClosing = false;
  private finishTimer?: NodeJS.Timeout;
  constructor(
    private db: DB,
    private id: string,
    private ws: WebSocket,
    private model: TextModel,
    private account: string,
    private redirect = async () => {
      await twilioClient()
        .calls(id)
        .update({ url: process.env.FALLBACK_URL!, method: "POST" });
    },
  ) {
    this.hardTimer = setTimeout(
      () => {
        this.cancel();
        this.durationClosing = true;
        this.speak(
          "Thank you. I will pass the available details to the team for a callback.",
        );
        this.finishTimer = setTimeout(
          () => void this.closeCall("duration-limit"),
          4500,
        );
      },
      settings(db).maxCallSeconds * 1000,
    );
    ws.on("message", (data) => void this.receive(String(data)));
    ws.on("close", () => this.dispose("socket-disconnected"));
    ws.on("error", () => void this.fallback());
    this.armSilence();
  }
  private send(data: unknown) {
    if (this.ws.readyState !== 1) return;
    if (this.ws.bufferedAmount > 64000) {
      void this.fallback();
      return;
    }
    this.ws.send(JSON.stringify(data));
  }
  private speak(text: string) {
    this.send({
      type: "text",
      token: text,
      last: true,
      interruptible: true,
      preemptible: true,
    });
  }
  private cancel() {
    this.abort?.abort();
    this.generation++;
    if (this.finishTimer) {
      clearTimeout(this.finishTimer);
      this.finishTimer = undefined;
    }
  }
  private armSilence() {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      this.silenceCount++;
      if (this.silenceCount >= 2) {
        this.speak(
          "I could not hear you. We will pass along the available callback details. Thank you.",
        );
        this.finishTimer = setTimeout(
          () => void this.closeCall("silence"),
          5000,
        );
      } else {
        this.speak(
          "Are you still there? Please tell me the best number for a callback.",
        );
        this.armSilence();
      }
    }, 20000);
  }
  async receive(raw: string) {
    if (this.closed || this.durationClosing) return;
    let m: z.infer<typeof message>;
    try {
      m = message.parse(JSON.parse(raw));
    } catch {
      return this.fallback();
    }
    if (m.type === "setup") {
      const c = getCall(this.db, this.id);
      if (
        this.setup ||
        m.callSid !== this.id ||
        (m.accountSid !== undefined && m.accountSid !== this.account) ||
        (m.to !== undefined && m.to !== process.env.TWILIO_NUMBER) ||
        !c ||
        c.finalized ||
        c.consent !== "accepted"
      )
        return this.fallback();
      this.setup = true;
      return;
    }
    if (!this.setup) return this.fallback();
    if (m.type === "error") return this.fallback();
    if (m.type === "dtmf") return;
    if (m.type === "interrupt") {
      this.cancel();
      if (this.lastAssistantIndex >= 0) {
        if (m.utteranceUntilInterrupt)
          this.history[this.lastAssistantIndex] = {
            role: "assistant",
            content: m.utteranceUntilInterrupt,
          };
        else this.history.splice(this.lastAssistantIndex, 1);
      }
      this.lastAssistantIndex = -1;
      this.armSilence();
      return;
    }
    this.cancel();
    if (this.pendingCaller.length + m.voicePrompt.length > 8000)
      return this.fallback();
    this.pendingCaller += m.voicePrompt;
    if (!m.last) return;
    const text = this.pendingCaller.trim();
    this.pendingCaller = "";
    if (!text) return;
    clearTimeout(this.silenceTimer);
    this.silenceCount = 0;
    this.history.push({ role: "user", content: text });
    if (this.history.length > 40) this.history = this.history.slice(-40);
    const previousAssistant = this.history
      .slice(0, -1)
      .findLast((m) => m.role === "assistant");
    const policy = policyReply(text);
    if (policy) {
      if (dangerPattern.test(text))
        updateIntake(
          this.db,
          this.id,
          {
            urgency: "Immediate danger",
            urgencyBasis: "safety-rule",
            problem:
              "Caller reported possible immediate danger; emergency safety instruction given.",
          },
          publicUrl,
        );
      this.speak(policy);
      this.history.push({ role: "assistant", content: policy });
      this.lastAssistantIndex = this.history.length - 1;
      this.armSilence();
      return;
    }
    const generation = this.generation;
    this.abort = new AbortController();
    const controller = this.abort;
    const timeout = setTimeout(() => controller.abort(), 22000);
    this.generated = "";
    this.lastAssistantIndex = -1;
    try {
      const result = await this.model.turn(
        this.history,
        this.abort.signal,
        (token) => {
          if (this.closed || generation !== this.generation) return;
          this.generated += token;
          if (this.lastAssistantIndex < 0) {
            this.lastAssistantIndex = this.history.length;
            this.history.push({ role: "assistant", content: token });
          } else
            this.history[this.lastAssistantIndex] = {
              role: "assistant",
              content: this.generated,
            };
          this.send({
            type: "text",
            token,
            last: false,
            interruptible: true,
            preemptible: true,
          });
        },
      );
      if (this.closed || generation !== this.generation) return;
      const patch = intakeSchema.parse(result.intake);
      if (patch.urgency)
        patch.urgencyBasis =
          /\b(urgent|asap|as soon as possible|emergency)\b/i.test(text)
            ? "caller-reported"
            : "assistant-inferred";
      const prior = JSON.parse(getCall(this.db, this.id)!.intake);
      if (patch.callbackConfirmed) {
        const candidate = patch.callback || prior.callback;
        const readback = spokenDigits(String(previousAssistant?.content || ""));
        const candidateDigits = String(candidate || "").replace(/\D/g, "");
        patch.callbackConfirmed =
          !!candidateDigits &&
          readback.includes(candidateDigits.slice(-10)) &&
          /\b(yes|correct|right|confirmed|that is it|that's it)\b/i.test(
            text,
          ) &&
          !/^\s*no\b/i.test(text);
      }
      updateIntake(this.db, this.id, patch, publicUrl);
      this.send({
        type: "text",
        token: "",
        last: true,
        interruptible: true,
        preemptible: true,
      });
      if (this.lastAssistantIndex < 0) {
        this.history.push({ role: "assistant", content: result.reply });
        this.lastAssistantIndex = this.history.length - 1;
      }
      this.failures = result.unintelligible ? this.failures + 1 : 0;
      if (this.failures >= 2) {
        this.speak(
          "I am having trouble understanding. I will pass along the available callback details.",
        );

        this.finishTimer = setTimeout(
          () => void this.closeCall("partial"),
          6000,
        );
      } else if (result.finish) {
        // Allow the closing utterance to play. A caller interruption cancels this timer.
        this.finishTimer = setTimeout(
          () => void this.closeCall("completed"),
          Math.min(15000, Math.max(5000, result.reply.length * 65)),
        );
      } else this.armSilence();
    } catch {
      if (generation === this.generation && !this.closed) await this.fallback();
    } finally {
      clearTimeout(timeout);
    }
  }
  private async closeCall(outcome: string) {
    if (this.closed) return;
    finalize(this.db, this.id, outcome, publicUrl);
    this.send({ type: "end", handoffData: JSON.stringify({ outcome }) });
    this.dispose(outcome);
    this.ws.close(1000);
  }
  async fallback() {
    if (this.closed || this.fallingBack) return;
    this.fallingBack = true;
    this.cancel();
    finalize(this.db, this.id, "provider-fallback", publicUrl);
    try {
      await this.redirect();
    } catch {
      /* The independent provider fallback also applies to failed webhook requests. */
    }
    this.dispose("provider-fallback");
    this.ws.close(1011);
  }
  dispose(outcome: string) {
    if (this.closed) return;
    this.closed = true;
    this.cancel();
    clearTimeout(this.silenceTimer);
    clearTimeout(this.hardTimer);
    this.history = [];
    this.pendingCaller = "";
    this.generated = "";
    finalize(this.db, this.id, outcome, publicUrl);
  }
}
