# Trainwell

A local-first iOS app that records personal training sessions, transcribes the conversation, extracts structured workout data, and lets you ask AI questions about your training history.

## What it does

1. **Records** — tap Start and the app records audio in 1-minute chunks. Keep recording with the screen off; a lock screen notification shows elapsed time.
2. **Transcribes** — each chunk is uploaded and transcribed by Groq Whisper as the session progresses.
3. **Extracts** — after you stop, Claude reads the full transcript and pulls out exercises, sets, reps, weights, technique cues, and trainer notes into structured data.
4. **Summarises** — a compact Markdown summary is generated and cached locally.
5. **Asks AI** — a chat screen lets you ask natural-language questions across your entire session history ("what did the trainer say about my knees?", "how have my squat weights changed?").

Sessions are stored locally in SQLite first. The phone stays fully functional offline — recording, pausing, and viewing cached summaries work without a network connection. Upload and processing happen in the background when connectivity is available.

## Tech stack

| Layer | Technology |
|---|---|
| Mobile | Expo (SDK 56) + React Native, expo-audio, expo-router, SQLite |
| API | Next.js 16 on Vercel |
| Database | Neon (Postgres) |
| Transcription | Groq Whisper |
| AI extraction & Q&A | Claude Sonnet (Anthropic) |
| Audio storage | Vercel Blob |

## Monorepo layout

```
apps/
  mobile/          Expo React Native app
  api/             Next.js API (deployed to Vercel)
packages/
  schemas/         Shared TypeScript types
```

## Running locally

### API

```bash
cd apps/api
cp .env.example .env          # fill in GROQ_API_KEY, ANTHROPIC_API_KEY, DATABASE_URL, BLOB_READ_WRITE_TOKEN
npm install
npm run dev
```

### Mobile

```bash
cd apps/mobile
cp .env.example .env          # set EXPO_PUBLIC_API_URL=http://localhost:3000
npm install
npx expo run:ios              # requires Xcode and an Apple Developer account for device builds
```

## Deployment

The API is deployed to Vercel. The mobile app is distributed via TestFlight.

## Roadmap

### Near-term
- **RAG for Ask AI** — embed sessions into pgvector at processing time; retrieve only relevant chunks at query time so Q&A cost stays flat as history grows
- **Lock screen Live Activity** — native iOS ActivityKit widget showing recording timer and waveform, similar to Voice Memos
- **Web portal** — companion Next.js dashboard for viewing sessions, managing history, and uploading markdown summaries from a browser

### Later
- Multi-user support (auth layer)
- Speaker diarisation (distinguish trainer vs client voice)
- Export to CSV / Apple Health
