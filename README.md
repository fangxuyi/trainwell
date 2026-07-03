# Trainwell

A local-first iOS app that records personal training sessions, transcribes the conversation, extracts structured workout data, and lets you ask AI questions about your training history.

## What it does

1. **Records** — tap Start and the app records audio in 60-second chunks saved to local SQLite + device storage. The phone stays fully functional offline — recording, pausing, and viewing cached data all work without a network connection.
2. **Transcribes** — each chunk is uploaded and transcribed by Groq Whisper in the background as the session progresses.
3. **Extracts** — after you stop, Claude reads the full transcript and pulls out exercises, sets, reps, weights, technique cues, and trainer notes into structured data.
4. **Summarises** — a compact Markdown summary is generated and stored in both Neon and locally.
5. **Reviews** — a dedicated review screen lets you correct exercise names and set data before finalising.
6. **Ask AI (RAG)** — ask natural-language questions across your entire session history. Questions are embedded with Voyage AI and matched to the most relevant session chunks via pgvector cosine search before being answered by Claude.
7. **Web portal** — a Next.js dashboard at the deployed Vercel URL for viewing sessions and asking AI questions from a browser.
8. **Lock screen Live Activity** — while recording, an iOS Live Activity shows the elapsed timer and trainer name on the lock screen and Dynamic Island (requires iOS 16.2+).

Upload and AI processing happen in the background. If connectivity is lost mid-session, sync retries automatically when the app returns to the foreground.

## Tech stack

| Layer | Technology |
|---|---|
| Mobile | Expo SDK 56, React Native, expo-audio, expo-router, expo-sqlite |
| API | Next.js on Vercel |
| Database | Neon (Postgres + pgvector) |
| Transcription | Groq Whisper (`whisper-large-v3-turbo`) |
| AI extraction & Q&A | Claude Sonnet (Anthropic) |
| Embeddings | Voyage AI `voyage-3-lite` (512 dims) |
| Audio storage | Vercel Blob |
| Live Activity | ActivityKit + WidgetKit (via Expo config plugin) |

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

This creates the `sessions`, `audio_segments`, `transcript_segments`, and `session_chunks` tables plus the `vector` extension and IVFFlat index.

After sessions exist, backfill embeddings:

```
POST /api/admin/backfill-embeddings
Authorization: Bearer <ADMIN_SECRET>
```

## Key environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | API | Neon connection string |
| `GROQ_API_KEY` | API | Whisper transcription |
| `ANTHROPIC_API_KEY` | API | Claude extraction + Q&A |
| `VOYAGE_API_KEY` | API | Session chunk embeddings |
| `BLOB_READ_WRITE_TOKEN` | API | Vercel Blob audio storage |
| `ADMIN_SECRET` | API | Protects `/api/admin/*` routes |
| `EXPO_PUBLIC_API_URL` | Mobile | Points mobile at the API |

## Known gaps

These are real gaps in the current implementation — not aspirational:

- **`running` sync jobs not recovered on restart**: If the app crashes while a job is in `running` state, `getDueJobs()` never picks it up (it only queries `pending` and `retry_wait`). Workaround: manually retry from the session detail screen.

- **`local_only` processing mode produces no content**: Audio is recorded and stored, but there is no on-device transcription or extraction pipeline. Sessions stay as `locally_complete` with zero exercises and no summary.

- **Review edits not pushed to server**: Exercise edits made in the review screen and the local finalization call (`remote_status = 'finalized'`) are saved to SQLite only. The server still reflects the original extraction. There is no `PATCH /api/workouts/:id` route.

- **`apiPost` has no timeout**: Only `apiGet` has the 5-second abort timeout. Upload steps in the sync worker can hang indefinitely if the server is unresponsive.

- **No concurrency guard on `retryStalledSessions`**: Rapid app foreground/background cycling can start multiple sync workers for the same session simultaneously.

- **`failed_permanently` jobs have no UI recovery**: After 5 failed attempts, jobs are permanently abandoned. The session detail screen only shows "Retry Sync" when `localStatus === 'local_error'`; a session stuck with permanently-failed jobs shows the syncing indicator forever.

- **Live Activity untested end-to-end**: The config plugin generates correct Swift code and Xcode target wiring, but no EAS build has been run since the plugin was added. Treat as untested until confirmed on device.

- **Web portal is unauthenticated**: All session data is publicly readable at the Vercel URL. Acceptable for a personal single-user app; add auth before sharing the URL.

## Roadmap

- Fix the `running`-job recovery gap (reset to `retry_wait` on app start)
- Push review edits and finalization to the server (`PATCH /api/workouts/:id`)
- Add timeout to `apiPost` / `uploadAudioChunk`
- Verify Live Activity on device via EAS build
- Speaker diarisation (distinguish trainer vs client voice)
- Export to CSV / Apple Health
