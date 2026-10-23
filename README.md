# Leading Call Desk

A small private answering desk for **Leading Plumbing Services LLC**, South Florida. Capture the request, alert two opted-in owners, call the customer back, mark contacted. Three screens; no scheduling, quoting, dispatch, marketing or customer texting.

## Run the free demo

Requires Node **24 LTS**, npm, Python 3 and make/C++ build tools for the SQLite driver install hook (the Docker build stage supplies these). No API key, card or phone is needed.

```sh
npm ci
npm run dev
```

Open the Vite address printed in your terminal. Select **Explore demo workspace**. All demo identities and addresses are fictional. **Try a demo call** opens a text conversation: enter a name, callback number, correction/confirmation, address and city separated by a comma, property type, problem, urgency, and callback preference. Hang up anytime to see incomplete capture. Setup & Health also has complete, urgent and abandoned fixtures. Provider delivery states in demo are simulations, never evidence of real SMS.

For the single-origin production build locally:

```sh
npm run build
npm start
```

The Node service serves the compiled React UI and API on port 3000. Do not use Vite as a live host. To load local environment overrides, use `node --env-file=.env --import tsx src/server.ts`; scripts do not implicitly read `.env`. Keep `APP_MODE=demo` until actual launch prerequisites are complete.

## Verification

```sh
npm run lint
npm run check
npm test
npm run build
npm run simulate
npx playwright install chromium
npm run test:e2e
```

If Chromium is already installed, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium`. E2E uses a separate `/tmp/leading-e2e.sqlite` database. Never point tests at a production database. Screenshots are written to `docs/screenshots/` with fictional data. See [verification](docs/VERIFICATION.md) for actual executed results and live limitations.

## What's implemented

- Fastify, strict TypeScript, React/Vite/Tailwind, SQLite WAL with parameterized statements, schema initialization/migration and durable sessions.
- Independent user accounts via Passport Local, Argon2id, SQLite-backed server sessions, CSRF, login throttling and secure live cookies. One-time `npm run bootstrap`; no public signup and no default passwords. Demo entry exists **only** in demo mode.
- Verified Twilio webhook capture, consent DTMF before ConversationRelay, per-call WebSocket tickets, bounded call state and timeouts, model-failure/budget/overload fallback, live OpenAI SDK text streaming adapter.
- Durable urgent/final notification outbox, two fixed recipients, opt-in checks, idempotent intent, rate-limit retries, delivery callbacks, ambiguous-send recovery and periodic scoped provider reconciliation.
- Minimal structured records, no stored full transcripts or audio recording, authenticated deletion, daily retention pruning, encrypted consistent SQLite backups and optional HTTPS off-host upload. Optional owner-only SMTP escalation on terminal SMS failure or ambiguity.

Live provider adapters are implemented but **not live-verified**. Official pricing/documentation sites were blocked by network policy in this build environment; contracts were checked against current installed official SDK types and an official Twilio ConversationRelay sample ([evidence](docs/API_CONTRACTS.md)). ConversationRelay configuration, exact wire behavior and model availability still require the official-documentation and account checks in [DEPLOY.md](DEPLOY.md) before use. Nothing here claims complete missed-call coverage, exactly-once SMS, legal compliance or high availability.

## Handoff

- [DEPLOY.md](DEPLOY.md): host, Twilio, two accounts, forwarding, acceptance and rollback.
- [OPERATIONS.md](OPERATIONS.md): daily use, failure states, recovery, privacy, backup and restore.
- [COSTS.md](COSTS.md): editable assumptions and examples; refresh prices before purchase.
- [Architecture](docs/ARCHITECTURE.md), [receptionist prompt](docs/RECEPTIONIST.md), [sample alert](docs/SAMPLE_ALERT.md).
- [Independent fallback TwiML](docs/fallback.twiml.xml); [live acceptance checklist](docs/LIVE_CHECKLIST.md).

No services have been purchased, accounts registered, real texts sent, company routing changed, or repository pushed. Those actions require the owner's specific authorization.
