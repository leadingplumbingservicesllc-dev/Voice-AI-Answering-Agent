# Live acceptance — all unverified until performed with authorization

Record date, operator, provider account/number, host plan, message SIDs and observed outcomes securely, avoiding unnecessary caller data in tickets. Obtain the owner's specific authorization before paid calls/SMS, purchasing, registration, or routing changes. Use fictional consenting testers, not customer traffic.

- [ ] Confirm current official ConversationRelay wire/TwiML docs, OpenAI model/account access, SDK compatibility, host pricing and sender registration. No placeholder credentials.
- [ ] Have qualified Florida counsel review disclosure, DTMF processing consent, decline policy and vendor retention. Recording is off. No transcripts stored; verify vendor settings separately.
- [ ] HTTPS login works for two separate accounts; wrong passwords and unauthenticated detail access fail, CSRF fails, cookies are Secure/HttpOnly/SameSite, reverse proxy cannot change canonical signature origin.
- [ ] Verify Twilio valid signed voice and WSS requests through the real Render proxy; forged requests fail. Verify account/number mismatch fails.
- [ ] Directly dial new number: decline AI, no selection, blocked caller ID, disconnect before consent. Each produces a useful partial/missed record/alert when possible; no AI before acceptance.
- [ ] Complete intake with a custom plumbing problem, address/city, property, urgency, preferred time. Readback callback and correct it. Verify confirmed digits and no invented unknown details.
- [ ] Test noisy speech twice, silence, interruptions during generated speech, corrections, long pause and hard duration. Confirm no overlapping/obsolete speech and partial recovery.
- [ ] Test unsupported Spanish: honest English callback offer. Test prompt injection, requests for pricing/booking, and immediate danger (safe fictional script): instruction to move to safety and contact 911/utility must precede further intake.
- [ ] Test urgent notification immediately then final; ordinary call one final intent per person. Abandoned calls are not silently marked spam.
- [ ] Obtain opt-in for both distinct recipient numbers. With explicit authorization send two real tests. Inspect **each delivered callback**; accepted/sent is not delivered. Validate actual segment charges.
- [ ] One recipient succeeds and the other fails; opt-out/invalid recipient remains visible and is not retried forever. Restore/restart during pending retries. Delayed/reordered delivery events never undo delivered. Simulate uncertain provider acceptance and reconcile without blind resend.
- [ ] Start **five simultaneous real calls** on the proposed host/account; use different fictional details. Record recognition quality, model first-speech/turn latency, CPU, RSS, event-loop lag, disk latency and disconnects. No cross-call data leakage. Record actual account concurrency limits. Upgrade host if measurements fail agreed operational targets. A local five-session functional test is not this test.
- [ ] Set monthly minute budget to zero: new calls follow fallback, while callback alerts still queue. Provider billing alerts handle costs outside this threshold.
- [ ] Model timeout/error and WebSocket disconnect: capture survives and redirect to fallback works. Kill/restart the app and test new inbound provider fallback independently. Test active-call death separately; document actual remaining interruption coverage.
- [ ] Independent TwiML Bin rings approved direct destinations only, secondary/no-answer instructions work, no public-forwarding-line loop. No hidden recording. Bin does not claim to send real-time summary texts.
- [ ] Reconciliation recovers a provider call missing its inbound local record and a stale unfinished call. Check lookback/watermark scope during an outage; no phantom calls from other numbers/accounts.
- [ ] Database remains on the mounted persistent volume across restart/deploy. SQLite integrity check passes. Retention deletes expired finalized records and dependent alert payloads; authenticated deletion works.
- [ ] Encrypt, upload off-host, download and restore a backup into an isolated stopped target. Verify integrity, records and accounts. Reconcile pending sends before connecting restored data to providers. Bucket lifecycle expires old versions within policy.
- [ ] Configure carrier-supported conditional forwarding for no-answer/busy/unavailable only after direct-number tests. Test caller ID preservation, exact delay and existing voicemail races. No universal forwarding code or porting assumption.
- [ ] Practice rollback to original carrier routing/voicemail without deleting numbers or canceling services. Record remaining limits and owner acceptance before customer rollout.
