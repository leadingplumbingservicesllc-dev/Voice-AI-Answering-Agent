# Architecture and boundaries

One Node 24 process, one SQLite WAL volume, one origin. The React client has exactly Inbox, Settings, Setup & Health. Models and transport adapters never receive recipient settings or arbitrary tools.

```
Carrier -> Twilio number -> signed /hooks/voice -> durable call -> DTMF consent
  accept -> signed ConversationRelay WSS -> OpenAI text -> validated intake
  decline -> minimal caller-ID callback, no conversational AI
  failure/budget/capacity -> independent Twilio-hosted fallback
Call end/status/recovery -> transaction: final state + two outbox rows
Outbox -> Twilio Messaging -> signed per-recipient delivery callbacks
Owner -> authenticated API -> inbox -> tel: callback -> Contacted -> Closed
```

`config.ts`: schema and company defaults; `prompt.ts`: versioned policy; `lifecycle.ts`: transactional call and notification intent; `notifications.ts`: sender, retry, callbacks; `voice.ts`: per-session ephemeral history and model adapter; `providers.ts`: Twilio URLs/signatures/TwiML; `recovery.ts`: account/number-scoped reconciliation; `auth.ts`: Passport and persistent sessions; `backup.ts`: consistent SQLite backup and encryption. `demo.ts` is an explicitly deterministic, separate simulator.

Migrations run transactionally in filename order at startup from `migrations/`, recorded in `schema_migrations`. The first release initializes the schema in `001_initial.sql`; later changes must add new numbered files. Already-applied migrations are not rerun; preserve prior migration files.

## Important tradeoffs

- OpenAI Chat Completions streaming through the official SDK, candidate `gpt-4.1-mini`. Structured JSON is buffered per short turn before sending reply tokens to ConversationRelay, so invalid JSON is never spoken and intake is validated. This increases first-speech latency compared with speculative token speech. No separate STT/TTS service is added. Actual TTFT and recognition quality remain live acceptance checks.
- English-only initial release (`en-US`). Spanish requests receive an honest callback offer; no bilingual claim. Voice configuration uses provider defaults except language and interruptions. Confirm current account enablement/settings against official docs before launch.
- Phone confirmation requires an explicit affirmative caller response after an assistant readback containing the same digits; caller ID is never silently confirmed. Live extraction still depends on recognition and model accuracy; test accents/noise/corrections on real calls. Models can make mistakes; owners must review uncertainty.
- ConversationRelay interruption supplies the spoken prefix; generation is aborted, late results discarded, and history updated to that prefix. History exists only in per-call RAM and is released on close. No transcript recovery files.
- Hard duration closes with a short message and grace period. Silence has one reprompt and a second timeout. Two unintelligible model turns end with a partial callback alert. Model failure redirects the live call through the Twilio Calls SDK. If this REST operation also fails, the provider-side fallback handles subsequent failed webhooks, but cannot guarantee recovery of an already connected WebSocket call. Test app death during an active call explicitly.
- SQLite business transactions guarantee unique notification **intent**, not exactly-once network delivery. A process crash or network timeout after provider acceptance is ambiguous. Do not resend automatically; reconcile Message SID or exact scoped candidate, then inspect unresolved ambiguity in Twilio. Matching is conservative and may need manual resolution. HTTP 429 gets bounded exponential backoff/jitter; 5xx/network failures are conservatively ambiguous. Permanent recipient errors need action. No automatic UI resend button can accidentally duplicate a paid alert.
- Urgent and final notifications are separate, at most two intents per recipient per call. Final may contain additional details; ordinary calls have one final intent per recipient.
- Monthly AI minutes reserve a full maximum-duration allowance per connected AI session; accumulated completed durations are counted. This is conservative admission control, not an exact financial cap. Pending handshake tickets, carrier, transfer, SMS, tokens, and provider rounding can add cost. Set account-side budgets too.
- Reconciliation runs every minute, fetches stale Calls statuses and pages inbound Calls for the configured Twilio destination, using a two-minute overlap. First run covers the past 24 hours, later runs resume a durable watermark. At most 1,000 calls/pass; a truncated/failed pass never advances its watermark. A long initial outage beyond 24 hours requires manual scoped recovery before routing. Do not claim detection of calls the original carrier never forwarded.
- This is a single instance, not HA. Restarts interrupt sockets. Graceful shutdown stops AI admission, allows up to 20 seconds to finish, then attempts fallback and retains partial alerts. Render/disk maintenance can exceed that grace. Live processes do not survive environment snapshots.
- Static TwiML fallback is outside this app/disk. It rings the two explicitly approved direct human numbers together; no transfer back to the published forwarding line. Settings store those approved numbers for operator reference and validate known loops; operators must independently update the Bin. Application Settings do not provision Twilio. Unrecognized forwarding loops cannot be inferred automatically.

## Later alternatives (not implemented)

Twilio bidirectional Media Streams + OpenAI Realtime requires custom audio framing, buffering, audio conversion, interruption/truncation, session lifecycle and consent engineering. Measure voice/token consumption and total cost before replacing ConversationRelay; token-priced audio has no universal fixed per-minute rate.

Local STT (`faster-whisper`), TTS (current maintained Piper, GPL), and Ollama with a commercially permitted model require hardware, audio transport and ongoing operations. Check software, model and voice licenses separately. This is not an entirely permissive stack; free software does not eliminate carrier, number, SMS, power or maintenance costs. No local inference stack or second production transport is included.
