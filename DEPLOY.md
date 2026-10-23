# Deployment: from free demo to a cautious live rollout

**Status:** implemented adapters and tested local simulation, not a certified live telephony deployment. No provider credentials were available. Official web documentation/pricing requests returned policy HTTP 403 on 2026-10-23; installed official SDK contracts were checked where possible. The exact current console labels, model availability, prices and ConversationRelay account enablement must be verified at the linked official pages before spending or routing customers. These instructions do not imply a purchase, port, forwarding change or real SMS is authorized.

## 1. Repository and local demo

This checkout already contains the project. Create a private GitHub repository only if one is not already available; this task did not push code. From its root with Node 24 LTS, npm, Python 3 and make/C++ build tools (or use the supplied Dockerfile):

```sh
npm ci
npm run dev
```

Use **Explore demo workspace**. No passwords, API key or card required for demo. `npm run simulate` verifies complete, urgent and abandoned fixtures. `npm run build && npm start` serves both API and built frontend from one origin. Local `.env` is optional and never committed; use `node --env-file=.env --import tsx src/server.ts` when you want Node to load it. Stop using demo data before changing a deployment to live: use a fresh dedicated persistent database.

## 2. Twilio account and number

At [Twilio Console](https://console.twilio.com), create/upgrade an account and buy a US number supporting both Voice and SMS. Use a dedicated Twilio account/subaccount for this application so reconciliation has a small scope. Record Account SID, Auth Token and E.164 number in host environment secrets. A trial account has recipient, voice and message restrictions and is not a production free tier. Check current [US Voice](https://www.twilio.com/en-us/voice/pricing/us), [Messaging](https://www.twilio.com/en-us/sms/pricing/us) and [ConversationRelay](https://www.twilio.com/docs/voice/conversationrelay) availability and pricing.

For long-code business SMS, complete the applicable US A2P 10DLC brand/campaign registration and attach the approved sender or Messaging Service. For toll-free, complete toll-free verification. Internal-only owner alerts do not automatically bypass carrier rules. Approval can take days or longer, and registration, campaign and carrier fees can apply. Do not send live tests until approval and owner authorization. Add `TWILIO_MESSAGING_SERVICE_SID` if using one, otherwise the app sends from `TWILIO_NUMBER`.

## 3. OpenAI model

Create API project credentials at [OpenAI Platform](https://platform.openai.com). A ChatGPT subscription does not fund API usage. Candidate model is [`gpt-4.1-mini`](https://platform.openai.com/docs/models/gpt-4.1-mini) through official SDK `chat.completions.create` with streaming and JSON schema output. Verify access and current support in your actual account and compare current text model pricing. The UI intentionally permits only the tested candidate model choice; changing families/schema behavior is a separate adapter validation change, not a freeform prompt setting. Do not claim account availability from this demo. Set API project budgets/alerts as well as Twilio usage alerts.

## 4. Always-on service, disk, and accounts

Use one paid, always-on [Render web service](https://render.com/docs/web-services) with a [persistent disk](https://render.com/docs/disks). The supplied `render.yaml` proposes Starter, a 1 GB disk at `/var/data`, one instance and `/healthz` health checks. A sleeping free service and an ephemeral filesystem are unsuitable for live answering. Starter is a **candidate** low-traffic minimum, not a measured capacity guarantee. See COSTS.md and run the five-real-call test before selecting a production plan; upgrade to Standard if memory, latency or reliability measurements require it. This task did not run on Render or purchase a plan.

Connect the private repo, use its Dockerfile/Blueprint, choose region near your providers, and set:

| Variable                                       | Live value                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `APP_MODE`                                     | `live`                                                                         |
| `PUBLIC_BASE_URL`                              | Exact HTTPS origin, e.g. `https://YOUR-SERVICE.onrender.com`, no trailing path |
| `DATABASE_PATH`                                | `/var/data/call-desk.sqlite`                                                   |
| `SESSION_SECRET`                               | Cryptographically random 48+ bytes; Blueprint generates one                    |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`      | Actual account secret settings                                                 |
| `TWILIO_NUMBER`                                | Dedicated voice/SMS E.164 number                                               |
| `PUBLIC_BUSINESS_NUMBER`                       | Existing published E.164 line; used to reject known transfer loops             |
| `OPENAI_API_KEY`                               | API project secret; never a frontend variable                                  |
| `FALLBACK_URL`                                 | Independent Twilio-hosted TwiML Bin HTTPS URL                                  |
| `OWNER_ALERT_NUMBER`, `SON_ALERT_NUMBER`       | Two distinct internal E.164 numbers; still require Settings opt-in             |
| `FALLBACK_NUMBER`, `SECONDARY_FALLBACK_NUMBER` | Explicit direct human numbers only                                             |

See `.env.example` for optional Messaging Service, SMTP and encrypted backup variables. `OPENAI_MODEL` seeds the validated model setting on a new database, default `gpt-4.1-mini`. Existing Settings take precedence. Do not add `VITE_` secrets. App startup fails closed if required live configuration is missing. The provider account and number must match signed inbound requests.

The container entrypoint initializes only the `/var/data` mount with UID 1000 ownership and mode 0700, then drops privileges with setpriv before running Node. The application does not run as root. Do not override the entrypoint for normal startup. Verify Setup & Health says Writable · WAL. Real Render disk behavior remains a deployment acceptance check.

In Render Shell, with the service's environment and persistent disk, run:

```sh
npm run bootstrap
```

Enter the owner's and son's distinct emails and long unique passwords. Input is hidden; no password is in source or shell arguments. The CLI writes both accounts in one transaction, only when no account exists. Protect shell access. Visit HTTPS, sign in as each account, verify logout and denied unauthenticated API access. There is no public signup. A production service must remain inaccessible to customers until accounts, fallback and tests are ready.

## 5. Provider callbacks and ConversationRelay

Configure the Twilio number's incoming Voice webhook to **POST** `https://YOUR-SERVICE.onrender.com/hooks/voice` and its incoming Voice **fallback URL** to the independent Bin URL from step 6. Enable call status callbacks to POST `/hooks/call-status` for initiated/ringing/answered/completed events where the number/account configuration supports them. The reconciler is required even if an account does not expose all number-level events. Confirm actual configured status callbacks using a test call.

The app returns its own absolute consent and relay-end URLs. You do not configure `/hooks/consent` as the initial webhook. After DTMF 1, the response uses ConversationRelay at `wss://YOUR-SERVICE.onrender.com/hooks/relay?call=…&token=…`. It is not Twilio Media Streams. Confirm current [ConversationRelay TwiML](https://www.twilio.com/docs/voice/twiml/connect/conversationrelay), [WebSocket protocol](https://www.twilio.com/docs/voice/conversationrelay/websocket-messages) and provider-side service enablement/terms in your account. Confirm `setup`, `prompt` (last fragment), `interrupt`, `text` (last token) and `end` semantics on a real call before launch. This wire protocol has local tests, not a real provider session.

SMS creates include the exact callback `/hooks/sms-status?outbox=UUID`; keep its query intact. The callback is signed over the configured HTTPS origin, path and query plus form parameters. Follow [Twilio signature guidance](https://www.twilio.com/docs/usage/webhooks/webhooks-security). The WSS upgrade is verified over its externally visible **HTTPS** handshake URL including query. Untrusted Host/X-Forwarded-Host do not choose the signed URL; PUBLIC_BASE_URL does. There is one trusted reverse-proxy hop for secure cookies/IP rate limiting. Do not expose a second uncontrolled ingress or path-rewriting proxy; test the deployed proxy end to end. Signature failures return 403 and are never bypassed.

## 6. Independent fallback before real traffic

Create a Twilio-hosted **TwiML Bin** from `docs/fallback.twiml.xml`. Replace the primary and optional secondary with approved **direct** E.164 numbers. Both ring simultaneously; first answer wins. Remove the secondary Number element if absent. If neither answers, the script gives a callback instruction. It never silently records voicemail. Test both human destinations, no-answer and busy behavior, and ensure the public forwarding line is not one of them.

Use the Bin URL as the number's incoming Voice fallback and `FALLBACK_URL`. It must be outside the Node app, deployment and disk. Settings' fallback-number entries are operator reference/loop validation, not automatic Twilio provisioning; update/test the Bin separately when numbers change. The app also redirects model failures, exhausted AI minute threshold and overload to this Bin.

A static Bin does **not** send immediate summary texts, persist a transcript, or guarantee an already-active call survives application death. After restart, scoped provider reconciliation can recover recent call identity/time/outcome and send a missed-call alert, within its lookback. If immediate app-down texts are required, separately authorize a small Twilio-hosted Function with its own account secrets, fixed two-recipient allowlist, opt-in controls and deduplication; this optional extra infrastructure and Function/Messaging charges are **not implemented** or silently provisioned.

## 7. Opt-in and two real delivery tests

Get affirmative internal SMS opt-in from both people and keep its evidence outside this application. Settings records each opt-in checkbox, not a legal consent audit document. Configure exactly two distinct numbers. A number edit clears that recipient's opt-in. Confirm the Twilio sender's registration in Console; the app labels it unknown because configuration alone is not verification.

With the owner's specific authorization, select **Send two real test texts** in Setup & Health, read the cost notice and confirm. This creates a test call record and two outbox intents. Open the record; verify separate provider message IDs/statuses in Twilio and delivery callbacks for both phones. Do not count accepted/sent as delivered. Terminal opt-out/invalid numbers need correction and renewed opt-in, never endless retries. Do not manually resend an ambiguous send until reconciled.

## 8. Routing choices

First test the new Twilio number directly. For default rollout, keep the published company number and have its current carrier/PBX configure conditional forwarding for **unanswered, busy and unavailable** calls to the Twilio number. Carrier support, timeout, caller ID preservation and existing voicemail behavior vary. Ask the carrier for its exact supported procedure; there are no universal forwarding codes here. Calls never forwarded/reported to this account cannot be detected by the app.

Alternatively route all callers directly to the Twilio number for direct-answer operation. Do not automatically port or cancel the existing line. Never transfer to the public line that forwards to the assistant. Reject known configured loops and manually test actual PBX routes that the application cannot inspect.

## 9. Live acceptance and backup

Complete every item in `docs/LIVE_CHECKLIST.md`, including five simultaneous real calls, interruptions, blocked caller ID, explicit consent decline, model outage, app-down fallback, independent SMS failures and restore. Set off-host encrypted backups with storage lifecycle expiration (OPERATIONS.md), provider budget alerts and account retention settings. Have qualified Florida counsel review processing consent and disclosures. Record date, account/number, observed outcomes, host plan, latency and delivery evidence. No customer rollout before these checks.

## 10. Rollback

Restore the original carrier/PBX routing and keep existing voicemail operational. If direct-answer was chosen, restore the previous published destination. Leave the Twilio fallback configured while investigating. Do not delete phone numbers, cancel services or purge data as part of rollback. Keep the disk and a verified encrypted backup; inspect pending/ambiguous notifications before resuming. Restore a backup into a fresh stopped target and test before live routing. A single SQLite server with a disk is not high availability; deployments and disk failures can interrupt calls.

## Build tooling and constrained cloud shells

The build stage uses the full official Node Bookworm image for Python/native tooling and local Node headers; the runtime uses the smaller Bookworm slim image. The runtime entrypoint drops privileges after initializing the disk. A local Docker build, disk-backed demo smoke check, UID check and restart persistence check passed; Render-specific rollout is still unverified.

In a shell whose home directory is read-only, use writable cache locations:

```sh
export XDG_CACHE_HOME=/workspace/.cache
export npm_config_cache=/workspace/.npm
npm ci
```

If your enterprise proxy requires an additional trusted CA, the Dockerfile accepts an optional BuildKit `build_ca` secret. Forward standard proxy build args and supply the approved CA file through `--secret id=build_ca,src=/path/to/approved-ca.pem`. Do not disable TLS verification. This build environment also needed a build-only `--add-host` mapping for the proxy hostname to its normally resolved address; no credential values were copied into the image. Standard Render builds should not use these environment-specific flags unless their own network requires them.
