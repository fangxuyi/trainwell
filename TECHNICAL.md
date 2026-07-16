# Trainwell — Technical Reference

Architecture, setup, and operational detail. For a high-level overview see [README.md](README.md).

## Architecture

### Recording (mobile)

A session is recorded as a **single continuous audio file**, not per-chunk. This is required for reliable background recording: iOS forbids a backgrounded app from *re-activating* the audio session, so an earlier design that rotated to a new recorder every 60 seconds threw `CannotInterruptOthers` at the first rotation once the app was backgrounded. One recorder, activated once in the foreground, keeps running with the screen locked (needs `UIBackgroundModes: ["audio"]`).

- Format: compressed AAC / `.m4a`, mono, 16 kHz — Groq-friendly and small (~16 MB for a 90-minute session).
- **expo-audio gotcha:** recording options are only applied when passed to `prepareToRecordAsync(options)`. The option-flattening shim lives on that method, not the constructor — passing options only to `new AudioModule.AudioRecorder(...)` silently records a default container.
- Tradeoff: no mid-session crash resilience — a hard crash mid-recording can lose the in-progress file (see Known gaps).

### Upload (mobile → Vercel Blob)

On session end, the whole file uploads **directly to Vercel Blob** via a presigned PUT, bypassing Vercel's 4.5 MB serverless request-body limit.

- The server mints the presigned URL with `issueSignedToken` + `presignUrl` (`@vercel/blob`). The `@vercel/blob/client` SDK can't run in React Native (needs Node `crypto`/`crypto.subtle`), so the phone does a plain `PUT` with `expo-file-system`'s `File.upload()` — which runs on a native background URLSession, so the transfer survives the app being suspended.
- The phone then registers the blob URL with the API, which stores the `audio_segments` row and kicks off transcription.

### Transcription & extraction (server)

- **Groq Whisper** (`whisper-large-v3-turbo`) transcribes the uploaded audio. Groq caps files at 25 MB; an explicit size check surfaces a clear error before the request (overridable via `GROQ_MAX_AUDIO_BYTES`).
- **Claude** reads the full transcript and extracts exercises, sets, reps, weights, technique cues, and trainer notes, then generates a compact Markdown summary. Runs via Next.js `after()` so the request returns fast while the pipeline finishes in the background.

### Sync model

Sync is **server-driven with client reconciliation**:

- On end, the client creates the remote session, uploads, then calls `/process` (which triggers the server-side pipeline). The pipeline completes on its own — **the app does not need to stay open.**
- The app **reconciles on foreground**: `reconcileUnsyncedSessions()` re-runs the sync worker for any session that started syncing but isn't synchronized, pulling down whatever the server finished. `runSyncWorker` checks server status first and skips re-processing if already done.
- If connectivity is lost, jobs retry with backoff (`retryStalledSessions()` on foreground).

### Ask AI (RAG)

Questions are embedded with **Voyage AI** (`voyage-3-lite`, 512 dims) and matched to the most relevant session chunks via pgvector cosine search before being answered by Claude.

## Monorepo layout

```
apps/
  mobile/          Expo React Native app
  api/             Next.js API + web portal (deployed to Vercel)
packages/
  schemas/         Shared TypeScript types (WorkoutSession, SyncJob, etc.)
```

## Running locally

### API

```bash
cd apps/api
cp .env.example .env   # fill in DATABASE_URL, GROQ_API_KEY, ANTHROPIC_API_KEY,
                       # BLOB_READ_WRITE_TOKEN, VOYAGE_API_KEY, ADMIN_SECRET
npm install
npm run dev
```

### Mobile

```bash
cd apps/mobile
cp .env.example .env   # set EXPO_PUBLIC_API_URL=http://localhost:3000
npm install
npx expo run:ios       # requires Xcode + Apple Developer account for device builds
```

For a standalone (no-Metro) build on a device, use `--configuration Release`. If the CLI can't provision the Live Activity widget extension (personal Apple teams' extension profiles expire ~weekly), open `ios/Trainwell.xcworkspace` in Xcode and build/run from there — Xcode regenerates the profile.

### EAS build (TestFlight)

```bash
cd apps/mobile
eas build --platform ios --profile preview
```

The Live Activity widget extension is added during `expo prebuild` by `plugins/withLiveActivity.js` — no manual Xcode changes needed.

## Database setup

Run once after provisioning Neon:

```
POST /api/admin/migrate
Authorization: Bearer <ADMIN_SECRET>
```

Creates the `sessions`, `audio_segments`, `transcript_segments`, and `session_chunks` tables plus the `vector` extension and IVFFlat index.

After sessions exist, backfill embeddings:

```
POST /api/admin/backfill-embeddings
Authorization: Bearer <ADMIN_SECRET>
```

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | API | Neon connection string |
| `GROQ_API_KEY` | API | Whisper transcription |
| `ANTHROPIC_API_KEY` | API | Claude extraction + Q&A |
| `VOYAGE_API_KEY` | API | Session chunk embeddings |
| `BLOB_READ_WRITE_TOKEN` | API | Vercel Blob audio storage |
| `ADMIN_SECRET` | API | Protects `/api/admin/*` routes |
| `GROQ_MAX_AUDIO_BYTES` | API | Optional — override the 25 MB Groq file-size guard |
| `EXERCISE_DATASET_URL` | API | Optional — override the pinned exercise-name reference dataset |
| `EXPO_PUBLIC_API_URL` | Mobile | Points mobile at the API |

## Known gaps

Real gaps in the current implementation — not aspirational:

- **Continuous recording has no mid-session crash resilience**: recording as one file is required for reliable background recording (iOS forbids re-activating the audio session in the background). The tradeoff is that a hard app crash mid-recording can lose the in-progress file. Offline is unaffected — recording is fully local; the upload queues and retries.

- **`running` sync jobs not recovered on restart**: if the app crashes while a job is `running`, `getDueJobs()` never picks it up (it only queries `pending` and `retry_wait`). Workaround: retry from the session detail screen.

- **`local_only` processing mode produces no content**: audio is recorded and stored, but there is no on-device transcription/extraction pipeline. Sessions stay `locally_complete` with no summary.

- **Review edits not pushed to server**: exercise edits and local finalization (`remote_status = 'finalized'`) are saved to SQLite only; the server still reflects the original extraction. There is no `PATCH /api/workouts/:id` route.

- **`apiPost` has no timeout**: only `apiGet` has the 5-second abort. Upload steps in the sync worker can hang if the server is unresponsive.

- **No concurrency guard on foreground sync**: on foreground, both `retryStalledSessions` and `reconcileUnsyncedSessions` run; rapid foreground/background cycling can start multiple sync workers for the same session. Re-runs are idempotent (server status re-checked, processing not re-triggered when done), but it's redundant work.

- **`failed_permanently` jobs have no UI recovery**: after 5 failed attempts, jobs are abandoned. The session detail screen only shows "Retry Sync" when `localStatus === 'local_error'`, so a session with permanently-failed jobs can show the syncing indicator indefinitely.

- **Live Activity display unverified**: the config plugin builds cleanly and the widget target signs/installs on device, but whether the lock-screen / Dynamic Island Live Activity actually renders during recording hasn't been confirmed.

- **Web portal is unauthenticated**: all session data is publicly readable at the Vercel URL. Acceptable for a personal single-user app; add auth before sharing.

## Roadmap

- Fix the `running`-job recovery gap (reset to `retry_wait` on app start)
- Push review edits and finalization to the server (`PATCH /api/workouts/:id`)
- Add a timeout to `apiPost` / `uploadAudioChunk`
- Verify Live Activity on device
- Speaker diarisation (distinguish trainer vs client voice)
- Export to CSV / Apple Health
