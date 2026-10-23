# Operating the desk

## The everyday workflow

Open Inbox, start with **Urgent** requests, use **Call back**, then **Mark contacted**. Use **Close request** when finished; reopen when needed. New/Contacted/Closed is an owner workflow, separate from call outcome and SMS delivery. A partially captured or blocked-ID caller still deserves review. Unknown means unknown, not spam. Times in the inbox use America/New_York, including DST. There is no transcript viewer or customer texting button.

On a quiet day, check Setup & Health and pending calls. Verify both phones still receive authorized tests periodically. Health distinguishes configured from tested; account sender registration is unknown until checked in Console. The demo badge means every call/SMS result is simulated. A real test requires an explicit cost confirmation and an opted-in pair. No API keys belong in the UI.

## Delivery and recovery

| State                   | Meaning/action                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------- |
| pending / retry         | Durable intent awaiting worker or backoff; worker runs every second                    |
| sending                 | Network attempt in flight; restart converts this to ambiguous                          |
| accepted / queued       | Provider accepted it; not evidence of handset delivery                                 |
| sending_provider / sent | Provider progress; still not delivered                                                 |
| delivered               | Actual provider delivery report in live mode; simulated in demo                        |
| failed / undelivered    | Inspect provider error; correct sender/recipient/opt-out issue                         |
| blocked                 | Missing opt-in/number, or recipient changed; confirm configuration before any new send |
| ambiguous               | Acceptance is unknown. Reconcile before resending to avoid duplicate paid texts        |

Each call has separate owner/son and urgent/final rows. Uniqueness is `(call_id, kind, recipient)`, not the model's judgment. A 429 has bounded backoff and jitter (up to five attempts); invalid/opted-out recipients terminate. A timeout or 5xx may have accepted the message, so it is ambiguous rather than blindly retried. Persisted Message SID is polled after a minute where available. Exact body/destination/sender candidates can associate one ambiguous send; zero or multiple matches remain manual. Delivery callbacks are signature checked, idempotent and monotonic (late queued cannot undo delivered). Do not promise exactly-once external delivery.

For a permanent opt-out, honor it; obtain renewed opt-in only through an appropriate lawful process. Do not work around STOP with another sender. Settings edits do not automatically resend old blocked alerts, and ordinary callers never receive automated texts.

Recovery runs every minute and on startup: unfinished calls are reconciled with Twilio, terminal calls produce available partial summaries, stuck calls beyond the hard call limit redirect to the independent fallback. Provider list reconciliation covers only inbound calls to the configured number/account, first lookback 24 hours and then overlapping durable watermark. API failures preserve the watermark; a 1,000-call pass cap never silently advances it. After an outage beyond initial lookback, inspect Twilio call logs for the full window with a competent operator before declaring recovery complete. The app cannot recover calls the existing carrier never forwarded or reported.

A static independent Bin keeps a fresh inbound fallback outside this server, but sends no real-time app-down texts. Recovery after restart can produce delayed missed-call alerts. Optional Twilio-hosted immediate alert Function is not included. An active WebSocket app crash is not guaranteed to continue on the Bin; include that test before launch.

Optional SMTP escalation sends only to the configured owner's backup email on failed or ambiguous SMS. Configure `SMTP_HOST`, `SMTP_PORT` (465 TLS or 587 STARTTLS), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `BACKUP_EMAIL` or Settings. TLS verification stays on. The email claim is durable; an interrupted/failed SMTP send is retained for operator inspection in `meta` (`email:*`), not retried endlessly. SMTP retries and a separate email inbox are not a second HA application. SMS and email both depend on this process; neither works during its outage. No routine second email notification channel.

## Privacy, consent and retention

Counsel must review Florida processing/consent policies and vendor terms before live use. Disclosure/DTMF precede the conversational stream. Default decline policy: minimal available caller-ID callback with no AI conversation; blocked ID stays unknown and hears a business-hours callback instruction. There is no silent audio recording and no retained full transcript. History is only per-call RAM; it is cleared on session disposal. No transient recovery transcript files are created.

Records contain structured details, consent, timestamps, version, outcome and summary. The daily retention policy is enforced on startup and once per minute: finalized calls older than Settings retention (default 90 days) and their notification payloads/events are deleted transactionally by foreign-key cascade. Active calls are reconciled first rather than erased mid-call. Owner-authenticated deletion is available for finalized records with CSRF protection; it cannot recall an SMS/email already sent. Provider logs, handset messages, email and encrypted backups have their own retention rules. Set them explicitly. Call links contain no name/phone/address and require login.

No caller data or credential values appear in operational logging. Logs contain service mode and generic errors only. Do not enable body logging or paste provider diagnostic payloads into tickets without redaction. SQLite directories use restrictive permissions; never serve the data/backup directory as static files.

## Consistent encrypted off-host backups

`npm run backup` uses better-sqlite3's SQLite online backup mechanism (WAL-consistent), then encrypts with AES-256-GCM, a fresh salt/nonce and scrypt-derived key. Plain temporary snapshots are removed in `finally`; encrypted `.lcd` files are mode 0600 and local files older than seven days are pruned on successful runs. This is not a raw copy of the active database or WAL. Keep encryption keys separate from the disk.

1. Supply a strong `BACKUP_PASSPHRASE` (24+ characters) through secure host settings. Set `BACKUP_DIR=/var/data/backups`.
2. Configure existing off-host object storage with private HTTPS PUT access (`BACKUP_UPLOAD_URL`, optionally a sufficiently scoped presigned URL). A presigned URL expires: monitor and renew it. Using one fixed key overwrites the object; enable bucket object versioning to retain daily versions.
3. Configure **seven-day version/noncurrent-version expiration** and abandoned-upload cleanup on the storage bucket. This remote retention must be configured on the storage provider; the app cannot enforce an unknown bucket's policy. Scope its credentials to the backup prefix. Separate storage/transfer can cost money; use existing storage if available. Never commit the URL or key.
4. Run `npm run backup` once in the deployed service shell, verify the off-host object and perform a restore drill. Only after a successful HTTPS upload is `meta.backup_ok` recorded.
5. When both upload URL and passphrase are configured, the process schedules backup every 24 hours; it also checks on startup whether one is due. Monitor the last upload timestamp in Setup & Health developer details. This scheduler is subject to process/disk availability, not an external guarantee. Provider-hosted monitoring should alert on a stale timestamp; not configured automatically here.

The off-host upload path was **not verified** without storage credentials. A successful local encryption test does not establish off-host protection. Do not call a deployment backed up until both the upload and a restore have been verified.

Restore into a stopped, fresh target (never over a running database):

```sh
# Stop the service and preserve existing DB, -wal, -shm together outside the target.
# Securely inject BACKUP_PASSPHRASE and point DATABASE_PATH at a NEW target.
npm run restore -- /secure/download/leading-snapshot.lcd --confirm-stopped
```

The CLI refuses to overwrite an existing DB. Wrong password/corruption fails authenticated decryption. It verifies the SQLite header; on restore, run `PRAGMA integrity_check` through a secure local SQLite tool, then start in an isolated environment, inspect the inbox and verify account access. The migration runner applies only unapplied migrations. Before reconnecting live providers, reconcile sends against Twilio: a backup may predate message acceptance, and blindly draining restored pending rows risks duplicates. Set all restored pending/retry/sending states to ambiguous under operator supervision until checked. Preserve provider IDs. Restore testing never sends real messages by default.

## Accounts and updates

Bootstrap exactly two accounts with `npm run bootstrap`. Passwords are Argon2id; long unique passwords and host access control are required. To reset a lost password, stop the app and use a trusted server shell to generate an Argon2id hash with the installed library and securely update only that account's hash using a parameterized statement. Delete its sessions (or all `session_store` rows) to revoke existing sessions. Do not delete both accounts or add a public reset/signup endpoint. A documented secure CLI reset is available: `npm run reset-password -- owner@example.com` (hidden prompt; updates one existing user and revokes all sessions).

For dependency updates, create a separate change, preserve the lockfile, run lint/typecheck/unit/build/Playwright and the live acceptance checks affected. Run one service instance only. SQLite cannot be shared among independent replicas on ephemeral disks. Back up before migrations. Graceful SIGTERM/SIGINT admits no new AI calls, drains at most 20 seconds, then redirects remaining sessions where possible and queues partial summaries. Platform shutdown deadlines can be shorter; test them. CPU, network, storage and provider outages remain limits.
