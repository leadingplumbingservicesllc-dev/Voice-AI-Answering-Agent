# Verification record

Performed 2026-10-23 in this cloud workspace. Default mode is DEMO throughout. No real phone calls, provider messages, purchases, sender registrations or carrier changes occurred.

| Check                 | Actual result                                                                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen install        | `XDG_CACHE_HOME=/workspace/.cache npm ci --cache /workspace/.npm --no-audit --no-fund` passed; writable caches are needed because this shell's home is read-only                                                       |
| Strict TypeScript     | `npm run check` passed; production build repeats it                                                                                                                                                                    |
| Lint                  | `npm run lint` passed                                                                                                                                                                                                  |
| Backend               | **24 tests passed across 7 files**, no skipped/expected-failure tests                                                                                                                                                  |
| Browser               | **4 Playwright tests passed**, two workflows each on desktop Chromium and emulated mobile Chromium                                                                                                                     |
| Production build      | `npm run build` passed; Vite compiled React/Tailwind assets                                                                                                                                                            |
| Scripted simulation   | Complete, urgent and abandoned calls; final intents deduplicated; simulated results for both recipients passed                                                                                                         |
| Running service smoke | `npm run smoke` passed against the single-origin Node service: authenticated demo access, custom partial intake, hangup persistence, two notification intents                                                          |
| Docker                | Official Node multi-stage image built successfully. Docker build proxy DNS required an explicit supported host mapping and an additional trusted CA secret; TLS/checksums were not disabled                            |
| Container + disk      | Fresh named volume initialized, demo HTTP/API smoke passed. Node process UID 1000; data directory 0700, DB 0600. Six records persisted through restart; SQLite integrity check returned `ok`; another API smoke passed |
| Backup/restore        | SQLite online backup while WAL active, encrypted artifact, actual restore CLI into fresh target, record/outbox recovery, integrity check, tamper rejection and repeat migrations passed                                |
| Bootstrap             | Exactly two individual accounts created via CLI; password input hidden, hashes verified, second bootstrap rejected                                                                                                     |
| Screenshots           | Inbox, Settings, Setup & Health at desktop/mobile sizes in `docs/screenshots/`, fictional demo data only                                                                                                               |

Backend cases cover canonical signatures with hostile proxy Host headers, forged signatures, account context, signed real local WSS handshake without an undocumented required setup accountSid, consent decline/unknown caller ID, duplicate/reordered callbacks, partial calls, callback corrections and explicit readback confirmation, noise/silence, interrupted generation with spoken-prefix history, safety/pricing/injection boundaries, five isolated concurrent simulated sessions, model failure, urgent/final intent uniqueness, independent SMS failures/opt-out, rate-limit retry after a real DB restart, ambiguous-send suppression, late delivery reports, segment boundaries, zero AI budget, private APIs, sessions, CSRF, deletion and retention.

A local five-session functional test is **not a Render/provider load test**. Tests use fake account credentials and mocks; no outbound provider calls are made. Browser tests use a dedicated `/tmp/leading-e2e.sqlite`, never the application's normal data directory.

## Still unverified / external prerequisites

- Twilio/OpenAI account access and current model availability. Live speech recognition, audio timing/interruptions, WSS canonicalization through the real proxy, relay ending/handoff, actual status callbacks and five real concurrent calls.
- Current official prices/console workflows and ConversationRelay enablement. Primary official websites returned policy HTTP 403. An official Twilio GitHub sample and installed official SDKs were inspected; see API_CONTRACTS.md. COSTS.md rates are clearly illustrative, not current quotes.
- A2P 10DLC or toll-free approval, two actual internal opt-ins, real SMS acceptance/delivery and real handset behavior.
- Carrier conditional forwarding, caller-ID preservation, voicemail races and rollback.
- Independent hosted fallback provisioning and real app-down/active-call failure coverage. The supplied Bin XML must be populated and hosted outside this deployment. No immediate app-down Function is implemented.
- Qualified Florida counsel's processing/consent review and actual vendor retention settings.
- Render-specific disk permissions, deploy/restart behavior, measured memory/latency and minimum suitable paid host plan. Local Docker success is not Render deployment validation.
- Off-host encrypted backup upload, remote version expiration and a restore drill from that storage; no storage credentials were provided. Optional SMTP escalation is implemented but not sent/verified against an email provider.
- Remote repository publication and fresh-task environment restoration. Local files and any local commit have not been pushed. Saving an environment configuration draft does not publish it or establish remote reproducibility.

Use LIVE_CHECKLIST.md before customer traffic. No guarantee is made about complete call capture, exactly-once external sends, SMS delivery, compliance, or high availability.
