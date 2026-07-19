# Trainwell Technical Reference

This document describes the current implementation, operational setup, and known limitations. For the product overview, see [README.md](README.md).

## System overview

Trainwell is a TypeScript monorepo with three primary workspaces:

```text
apps/mobile        Expo / React Native iOS app
apps/api           Next.js API and authenticated web portal on Vercel
packages/schemas   Shared domain and API types
```

The mobile app is local-first. User actions and recording metadata are committed to SQLite before network work. A persistent job queue creates the server session, uploads audio directly to Vercel Blob, waits for processing, and saves the result back to SQLite.

The API stores authoritative remote session, transcript, embedding, credit, and billing data in Neon Postgres. Clerk provides identity for both mobile bearer tokens and web sessions. Session routes verify that the current Clerk user owns the requested session.

## Primary execution flow

```text
User starts workout
  -> mobile creates a Clerk-user-scoped SQLite session
  -> one continuous AAC/M4A recording starts
  -> user may pause, resume, or add local timestamped notes

User ends workout
  -> recorder finalizes the local file
  -> mobile stores one audio_segments row
  -> persistent sync jobs are enqueued
  -> server session creation reserves credits
  -> mobile requests a presigned Blob PUT URL
  -> native file upload sends audio directly to Vercel Blob
  -> mobile registers the Blob URL with the API
  -> API transcribes the audio and stores transcript segments
  -> mobile requests processing
  -> server extracts, canonicalizes, summarizes, and embeds the workout
  -> mobile polls or later reconciles the completed result
  -> user reviews and finalizes locally
```

## Mobile application

### Navigation and identity

Expo Router defines sign-in, sign-up, home, recording, session detail, review, history, Ask AI, and credits routes under `apps/mobile/app`.

`apps/mobile/app/_layout.tsx` mounts Clerk, provides bearer tokens to the non-React API client, redirects based on authentication state, initializes RevenueCat, and runs sync recovery when the app returns to the foreground.

The home-screen account drawer uses Clerk profile data and shows the server credit balance and membership state. Signing out returns to the sign-in flow. SQLite session reads and due sync jobs are filtered by the active Clerk user so switching accounts does not reveal another account’s cached sessions. Legacy rows with `user_id = 'local'` are claimed by the first signed-in user after the upgrade.

### Local data model

SQLite runs in WAL mode and contains:

- `sessions` — workout metadata, status, extracted data, summaries, and the owning Clerk user ID.
- `audio_segments` — local recording path and upload state. The current recorder creates one segment per session.
- `transcript_segments` — available in the schema but server transcripts are not currently synchronized into this local table.
- `quick_notes` — timestamped notes captured during recording; currently local only.
- `sync_jobs` — persistent network work with retries and backoff.
- `body_measurements` — user-scoped circumference entries, local sync state, and deletion tombstones.

Completed workout summaries and structured extraction data are cached in SQLite, not downloaded as standalone files. SQLite and session audio use the operating system's private app container, so uninstalling the app removes the local database and any remaining local recordings. Startup cleanup scans only session `audio` directories and removes physical recordings that no longer have a live `audio_segments` row; it does not remove cached workout summaries.

Shared application types use camelCase. SQLite and Postgres rows use snake_case, with explicit conversions in database and API boundaries.

### Body measurements

The mobile Measurements screen records common or custom body areas in centimeters or inches, with a measurement date and optional note. It shows the latest value for each normalized body-area label, compares it with the prior entry after unit conversion, and retains a chronological history. Long-pressing a history entry creates a local deletion tombstone before any network request.

Measurement creation is local-first: mobile writes a stable client-generated ID to SQLite with `sync_status = 'pending'`, then idempotently upserts it through `PUT /api/body-measurements/[id]`. The row itself is the durable retry record. Foreground recovery retries pending rows, downloads the authenticated user's server history, and reconciles deletions across devices. The API validates values and units and scopes reads, upserts, and deletes to the current Clerk user. Measurement history is not currently included in Ask AI retrieval.

### Recording

A session is recorded as one continuous compressed AAC `.m4a` file: mono, 16 kHz, 24 kbps CBR. At this bitrate a 90-minute session is approximately 16 MB. The recorder writes into the private app Documents directory, and its native URI is registered in `audio_segments` before capture begins. A normal stop moves the finalized file into `sessions/<session-id>/audio/recording.m4a`.

The single-file design is an iOS reliability constraint. iOS cannot reliably reactivate a recording audio session after the app is backgrounded, so rotating recorders in the background causes `CannotInterruptOthers`. The recorder is prepared once in the foreground and remains active while the screen is locked or another app is open.

If the process terminates during recording, startup recovery changes the session to `interrupted` and moves any surviving native file to `sessions/<session-id>/audio/interrupted_recording.m4a`. Interrupted files never upload automatically because an abruptly terminated M4A container may be incomplete. The session detail screen explains the interruption and lets the user explicitly try server processing; failed recovery keeps the local file available for deletion or another attempt.

Recording options must be passed to `prepareToRecordAsync(RECORDING_OPTIONS)`. Passing them only to the `expo-audio` recorder constructor can silently use an unintended native container.

The Live Activity integration is generated by `apps/mobile/plugins/withLiveActivity.js`. Do not edit generated iOS output directly; update the plugin and regenerate the native project. Its ActivityKit state carries elapsed seconds, recording/paused state, and a timer anchor so the lock-screen and Dynamic Island timer can continue rendering through SwiftUI rather than depending on a JavaScript update every second. Pause and resume explicitly refresh that state, and ending preserves the final elapsed time until immediate dismissal.

### Sync and reconciliation

The sync worker in `apps/mobile/src/sync/worker.ts` performs these steps:

1. Create the remote session idempotently.
2. Upload stored audio in sequence.
3. Check remote processing status before triggering processing.
4. Poll until the server reaches `review_required` or `finalized`.
5. Fetch the remote result and cache it in SQLite.

Network jobs use stable client-generated IDs and persistent SQLite rows. Retry delays are 5 seconds, 15 seconds, 1 minute, 5 minutes, and 15 minutes. HTTP 402 marks a job blocked so the local recording remains available after the user runs out of credits.

Recovery runs at authenticated startup, when the app returns to the foreground, when network access is restored, and every 30 seconds while the app remains active. Jobs left `running` by a terminated process return to the retry queue at startup, explicit retries reset blocked or permanently failed jobs, and a per-session lock prevents duplicate workers. `retryStalledSessions()` retries due jobs while `reconcileUnsyncedSessions()` checks sessions whose server work may have completed while mobile was suspended. Processing is not re-triggered when the server already reports `processing`, `review_required`, or `finalized`.

After processing, the mobile cache copies the authoritative server `remote_status`. A `review_required` result exposes Review & Finalize. Review supports renaming, adding, and removing exercises; adding and removing sets; editing reps and weight values or units; and adding, editing, or removing trainer cues. Renaming an exercise clears its prior movement-media match so stale media is not attached to the correction. Tapping Finalize queues a persistent server job and displays `Finalizing`; the server regenerates the compact summary from the reviewed exercise structure before replacing the finalized embeddings, and mobile refreshes that authoritative result before changing to `finalized`. If finalization is queued while processing sync is still active, the worker automatically runs another pass for the newly queued job. A session with `delete_after_review` deletes its physical local recording after review. Deleting a session also completes remote deletion and physical local-audio deletion before removing the SQLite session row.

The mobile session-detail hierarchy shows Movement Breakdown followed by Keep the Momentum. The generated compact record remains synchronized and available to the server and web portal but is not rendered as a separate mobile section. Session notes appear near the bottom immediately before the delete action.

## API and web portal

### Authentication and ownership

Clerk protects the web portal routes: middleware covers the main session and Ask AI pages, while the credits page performs its own server-side sign-in check. API routes return JSON 401 responses rather than browser redirects so mobile receives predictable errors. Collection routes query by `user_id`; session-specific routes call `requireSessionOwner()` and return 404 for sessions the current user does not own. Admin migration routes use `ADMIN_SECRET`, and billing webhooks use provider signatures or shared authorization instead of Clerk.

The portal currently provides authenticated session history, session detail, Ask AI, credit balance, Stripe checkout, customer-portal access, and Clerk account controls.

### Audio upload and transcription

Full recordings never pass through a Next.js request body. The API issues a presigned PUT URL, and `expo-file-system` uploads the local file directly to private Vercel Blob storage. The deterministic Blob path allows overwrite so an interrupted upload can safely retry.

After upload, mobile registers the Blob URL through `/api/workouts/[id]/audio-segments`. That request transcribes the audio inline with Groq `whisper-large-v3-turbo`, using verbose JSON segment timestamps, and stores `transcript_segments` in Postgres.

Groq’s default per-file guard is 25 MB and can be changed with `GROQ_MAX_AUDIO_BYTES`. Legacy CAF/LPCM files can be converted to WAV server-side; unsupported CAF codecs fail with a clear error.

### Workout extraction and summary generation

Processing is triggered through `/api/workouts/[id]/process`. The route marks the session `processing`, returns immediately, and uses Next.js `after()` to continue the pipeline within the Vercel function lifetime.

The processing function requests a 300-second maximum duration, which is supported by the project's Vercel Hobby account while Fluid Compute is enabled. Pipeline logs record start, completion, failure, and duration for transcript loading, model extraction, exercise canonicalization, session loading, summary generation, persistence, and the overall run.

The pipeline makes the following model/service calls:

1. **Transcription:** one Groq Whisper call for the current single audio file.
2. **Structured extraction:** one call to the configured language-model provider for shorter sessions. Long sessions are divided into approximately 15-minute primary windows and extracted with parallel provider calls.
3. **Boundary protection:** each long-session window receives up to 90 seconds of adjacent context. The prompt allows that context to identify continuity but explicitly prohibits extracting evidence from it, reducing lost or duplicated sets at boundaries.
4. **Exercise canonicalization and media matching:** no LLM call. Extracted names are deterministically matched against a commit-pinned public GitHub exercise dataset. The dataset begins loading in parallel with model extraction; only the compact matching fields are retained in the shared Next.js data cache and warm-instance memory. Low-confidence or ambiguous matches preserve the model’s original name. When `EXERCISE_MEDIA_BASE_URL` is configured, confident matches also receive structured `referenceMedia` metadata resolved against that licensed HTTPS host. Dataset failures are non-fatal.
5. **Summary:** no additional LLM call. `generateSummaryText()` deterministically formats the merged structured extraction into the compact workout recap.
6. **Review and indexing:** the initial extraction is stored as `review_required` but is not indexed for Ask AI. Finalization saves the user-reviewed exercises and batches the resulting overview, complete exercise-set, and next-plan chunks in one Voyage embeddings request. The finalized status update and chunk replacement commit in one Postgres transaction after embeddings are ready.

Model output is parsed as untrusted JSON. The current parser handles JSON inside or outside Markdown code fences, but runtime schema validation is still limited; malformed structures can fail the pipeline.

### Ask AI

Ask AI uses routed hybrid retrieval over finalized sessions only:

1. Session-scoped and latest-workout questions use exact, user-scoped SQL retrieval.
2. Progression questions use structured exercise JSON to produce chronological set timelines, maximum weights, completed-set and rep counts, and recorded volume. Relevant semantic chunks supplement those computed facts.
3. Narrative questions combine Postgres full-text ranking with Voyage `voyage-3-lite` vector similarity. Reciprocal rank fusion merges the lexical and vector candidate lists into eight chunks.
4. Relative-history questions add a date-bounded SQL session list to semantic results.
5. The configured language-model provider answers only from this context. The API returns deduplicated session citations alongside the answer.

For follow-up questions, clients send at most the previous ten user/assistant messages. The backend bounds each message, asks the configured language model to rewrite the follow-up into a standalone retrieval query, retrieves against that query, and then answers the original question with both the retrieved workout context and prior conversation. A first-turn question uses one answer-generation call; a follow-up uses one query-rewrite call plus one answer-generation call. Conversation history remains client-side and New Chat clears it explicitly.

All retrieval queries join chunks to `sessions`, require the current Clerk `user_id`, and require `remote_status = 'finalized'`. The web session-detail Ask link also passes its session ID so exact-session questions cannot drift into other workouts.

`AI_PROVIDER` selects `anthropic` (the default) or `openai` for both workout extraction and Ask AI. The shared adapter in `apps/api/lib/language-model.ts` keeps prompts and response shapes provider-independent. `ANTHROPIC_MODEL` and `OPENAI_MODEL` are server-only overrides; changing the provider or model does not alter the mobile or web API contract.

If hybrid retrieval finds no matching chunks, the route falls back to the five most recent finalized session records. If Voyage is temporarily unavailable, lexical retrieval remains available.

### Private beta invitations

`BETA_INVITE_REQUIRED=true` enables a temporary access gate after Clerk authentication. Clerk remains the identity provider, but newly authenticated users cannot enter portal pages or use authenticated application APIs until they redeem a Trainwell invitation code. Web and mobile provide dedicated `/invite` screens. Mobile caches a successful entitlement in SecureStore so approved beta users retain local access offline; server APIs continue enforcing the database entitlement.

Invitation codes are generated through `/api/admin/invitation-codes`, protected by `ADMIN_SECRET`. Only a SHA-256 hash is stored. Codes support labels, expiration timestamps, and maximum redemption counts. Redemption atomically claims remaining capacity and grants one `beta_access_users` row per Clerk user. The migration grants `existing_user` access to every current session or credit-account owner before the gate is enabled.

Rollout order:

1. Deploy with `BETA_INVITE_REQUIRED` unset or `false`.
2. Run `/api/admin/migrate` to create the invitation tables and grandfather existing users.
3. Release a mobile build that includes the invitation screen. Do not enable the gate while testers may still be using an older build, because newly authenticated users on that build have no way to redeem a code.
4. Generate invitation codes through the admin endpoint immediately before distribution so time-limited codes retain their full redemption window.
5. Set `BETA_INVITE_REQUIRED=true` in Vercel Production and redeploy.
6. Verify sign-up and redemption with a new Clerk account, including invalid, expired, and previously redeemed codes.

Activation is currently deferred until a mobile Release/TestFlight build containing the invitation screen is available. The planned initial cohort is 20 unique codes, each limited to one redemption and expiring seven days after creation. The admin endpoint can accept caller-supplied codes or generate cryptographically random `TW-...` codes; generated codes are preferred. Because plaintext codes are returned only when created, save the distribution list securely at generation time. Code expiration controls only the redemption deadline—access already granted to a user does not expire with the code.

To end the private beta immediately, set `BETA_INVITE_REQUIRED=false` and redeploy. No Clerk accounts or workout data need migration or deletion.

## Credits and billing

Postgres is the source of truth for balances, reservations, transactions, and idempotent billing events.

- A credit account is created on first access with 100 permanent credits.
- Required credits are `max(1, ceil(durationSeconds / 60))`.
- Credits are reserved before upload, consumed after transcript rows are stored, and refunded when transcription fails.
- Subscription credits are used before permanent credits.
- Monthly allowances reset to the plan amount each paid period; unused monthly credits do not roll over.
- Insufficient balance returns HTTP 402 and blocks the mobile sync job without deleting local audio.

Products currently defined in `apps/api/lib/billing.ts`:

| Product | Allowance | Price | Billing |
|---|---:|---:|---|
| Credit pack | 100 permanent credits | $5 | One time |
| Monthly 300 | 300 credits per period | $6.99/month | Subscription |
| Monthly 800 | 800 credits per period | $15.99/month | Subscription |

Web purchases use Stripe Checkout. Webhook events grant credits; the checkout redirect never grants value. Stripe’s customer portal handles cancellation and payment methods.

iOS purchases use StoreKit through RevenueCat, with the Clerk user ID as the RevenueCat App User ID. The code and webhook route are present, but mobile purchasing is not production-ready until Apple Developer membership, App Store Connect products, RevenueCat offerings, and release credentials are configured. Purchases require a development or release build and do not work in Expo Go.

## Server data

The base Postgres schema is in `apps/api/lib/schema.sql`. Core tables include:

- `sessions`, `audio_segments`, and `transcript_segments`.
- `session_chunks` with pgvector embeddings.
- `credit_accounts`, `credit_reservations`, and `credit_transactions`.
- `billing_events` for webhook idempotency.

The mobile SQLite representation and shared types must remain compatible with these server rows when persisted session fields change.

## Local development

### Prerequisites

- Node.js and npm.
- Xcode for iOS development.
- A Neon Postgres database and Vercel Blob store.
- Clerk, Groq, Anthropic, and Voyage credentials.
- Stripe credentials for web billing.
- Apple Developer, App Store Connect, and RevenueCat credentials only when enabling iOS purchases or distribution.

### Install

From the repository root:

```bash
npm install
```

### Run the API and web portal

```bash
cp apps/api/.env.example apps/api/.env
npm run api
```

The Next.js development server is available at `http://localhost:3000` by default.

### Run the mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env
npm run mobile
```

For native iOS features such as recording, Live Activities, and RevenueCat, use a development build:

```bash
cd apps/mobile
npx expo run:ios
```

Expo Go is insufficient for the complete app because it cannot load the custom native Live Activity and RevenueCat integration.

For a standalone device build, use a Release configuration. If command-line provisioning cannot sign the widget extension, open `apps/mobile/ios/Trainwell.xcworkspace` in Xcode and let Xcode manage the profiles.

### EAS preview build

```bash
cd apps/mobile
eas build --platform ios --profile preview
```

## Database initialization and migrations

Initialize a new database with `apps/api/lib/schema.sql`, deploy the API, then call the idempotent migration route after schema-feature additions:

```bash
curl -X POST https://your-api.example/api/admin/migrate \
  -H 'Content-Type: application/json' \
  -d '{"secret":"YOUR_ADMIN_SECRET"}'
```

The migration creates pgvector and embedding indexes, credit and billing tables, beta invitation tables, grandfathered access rows, body measurement storage, and the credit ledger functions.

After deploying finalized-only indexing, rebuild every existing finalized session so reviewed corrections and complete set data replace legacy pre-review chunks:

```bash
curl -X POST https://your-api.example/api/admin/backfill-embeddings \
  -H 'Content-Type: application/json' \
  -d '{"secret":"YOUR_ADMIN_SECRET"}'
```

To create a beta invitation code after running migrations:

```bash
curl -X POST https://your-api.example/api/admin/invitation-codes \
  -H 'Content-Type: application/json' \
  -d '{"secret":"YOUR_ADMIN_SECRET","label":"TestFlight cohort","maxRedemptions":10,"expiresAt":"2026-09-01T00:00:00Z"}'
```

The plaintext code is returned once in the response. Store and distribute it securely.

## Environment variables

### API and web

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string. |
| `GROQ_API_KEY` | Groq Whisper transcription. |
| `AI_PROVIDER` | Language-model backend: `anthropic` (default) or `openai`. |
| `ANTHROPIC_API_KEY` | Anthropic key, required when the provider is `anthropic`. |
| `ANTHROPIC_MODEL` | Optional Anthropic model override. |
| `OPENAI_API_KEY` | OpenAI key, required when the provider is `openai`. |
| `OPENAI_MODEL` | Optional OpenAI model override. |
| `VOYAGE_API_KEY` | Session and question embeddings. |
| `BLOB_READ_WRITE_TOKEN` | Private Vercel Blob access and presigned uploads. |
| `ADMIN_SECRET` | Protects database migration and backfill routes. |
| `BETA_INVITE_REQUIRED` | Enables the temporary post-Clerk private-beta invitation gate. |
| `GROQ_MAX_AUDIO_BYTES` | Optional transcription file-size guard override. |
| `EXERCISE_DATASET_URL` | Optional override for the pinned exercise reference dataset. |
| `EXERCISE_MEDIA_BASE_URL` | Optional HTTPS base URL for separately licensed exercise thumbnails and GIFs. Keep unset unless the deployment has media usage rights. |
| `NEXT_PUBLIC_API_URL` | Public deployed API URL exposed to the web client where needed. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk public browser key. |
| `CLERK_SECRET_KEY` | Clerk server key. |
| `STRIPE_SECRET_KEY` | Creates Stripe Checkout and customer portal sessions. |
| `STRIPE_WEBHOOK_SECRET` | Verifies Stripe webhook signatures. |
| `STRIPE_CREDITS_100_PRICE_ID` | Stripe one-time credit-pack Price ID. |
| `STRIPE_MONTHLY_300_PRICE_ID` | Stripe 300-credit subscription Price ID. |
| `STRIPE_MONTHLY_800_PRICE_ID` | Stripe 800-credit subscription Price ID. |
| `REVENUECAT_WEBHOOK_AUTHORIZATION` | Exact shared Authorization header expected from RevenueCat. |
| `REVENUECAT_CREDITS_100_PRODUCT_ID` | Optional one-time RevenueCat product override. |
| `REVENUECAT_MONTHLY_300_PRODUCT_ID` | Optional 300-credit product override. |
| `REVENUECAT_MONTHLY_800_PRODUCT_ID` | Optional 800-credit product override. |

### Mobile

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | API base URL used by mobile. |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk public mobile key. |
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` | RevenueCat public iOS SDK key; omit until mobile billing is configured. |

Never commit local `.env` files or server secrets.

## Validation

There is currently no repository-owned automated test suite. Run the checks relevant to the changed code:

```bash
npm run typecheck
npm run lint --workspace=apps/api
npm run build --workspace=apps/api
cd apps/mobile && npx tsc --noEmit
```

Recording, background sync, upload, Live Activity, and RevenueCat changes require validation on a development or release build when a device is available.

## Important implementation constraints

- Commit mobile state to SQLite before starting network work.
- Keep sync jobs persistent, retryable, idempotent, and based on stable client IDs.
- Keep one continuous recording file per session; do not restore recorder rotation.
- Upload full recordings directly to Blob using presigned PUT URLs.
- Authenticate every API route and verify ownership on session-specific routes.
- Treat model output as untrusted and preserve user corrections.
- Keep shared types, SQLite rows, and Postgres rows compatible.
- Change Live Activity native output through `apps/mobile/plugins/withLiveActivity.js`.

## Known limitations

- **Interrupted audio may be unusable:** force-quit recovery preserves any surviving recording file, but iOS may terminate before the M4A container is finalized. The app cannot guarantee that an interrupted file will play or transcribe successfully.
- **Manual upload is not actually manual:** the UI exposes `manual_upload`, but the active-session hook currently queues and starts sync for every mode except `local_only`.
- **Local-only sessions have no generated content:** there is no on-device transcription or extraction pipeline.
- **Quick notes are local only:** timestamped notes are not uploaded or included in server extraction.
- **POST and DELETE calls have no timeout:** only the mobile GET helper currently uses an abort timeout.
- **Terminated-app upload is not guaranteed:** recovery is reliable while the app is active and upon reopening, but iOS does not guarantee that authenticated uploads run while the app is terminated.
- **Extraction validation is incomplete:** malformed or structurally incomplete model JSON can still fail downstream processing.
- **Window merge can retain rare duplicates:** adjacent context prevents double-counting from context evidence, but independently extracted primary windows can still identify one boundary-spanning exercise twice.
- **Exercise media requires separate rights:** the pinned dataset's code and metadata license does not grant downstream use of its Gym visual images or GIFs. Interactive previews remain disabled until a licensed media base URL is configured; every rendered preview retains the dataset attribution.
- **Live Activity display still needs confirmed device QA.**
- **iOS billing is deferred:** StoreKit products, RevenueCat offerings, and Apple release credentials are not configured for production.

## Reference artifacts

`recordings/`, `sources-markdown/`, `summary-markdown/`, and `summary-html/` are reference artifacts. Do not overwrite them unless a task explicitly requires it.
