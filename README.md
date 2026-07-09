# Trainwell

A local-first iOS app that records personal training sessions, transcribes the conversation, extracts structured workout data, and lets you ask AI questions about your training history.

## What it does

1. **Records** — the session is captured as a single continuous audio file on device, and recording keeps running in the background with the screen locked or in another app. Works fully offline.
2. **Transcribes** — when you end a session, the recording uploads to the cloud and is transcribed by Groq Whisper.
3. **Extracts** — Claude reads the transcript and pulls out exercises, sets, reps, weights, technique cues, and trainer notes.
4. **Summarises** — a compact Markdown summary is generated and stored.
5. **Reviews** — a review screen lets you correct exercise and set data before finalising.
6. **Ask AI** — ask natural-language questions across your whole training history (retrieval-augmented over past sessions).
7. **Web portal** — a browser dashboard for viewing sessions and asking questions.
8. **Lock screen Live Activity** — a recording timer on the lock screen and Dynamic Island (iOS 16.2+).

Transcription and AI processing run server-side and finish on their own — you don't need to keep the app open. The app reconciles results the next time it's foregrounded.

## Tech stack

| Layer | Technology |
|---|---|
| Mobile | Expo / React Native (expo-audio, expo-router, expo-sqlite) |
| API & web | Next.js on Vercel |
| Database | Neon (Postgres + pgvector) |
| Transcription | Groq Whisper |
| AI extraction & Q&A | Claude (Anthropic) |
| Embeddings | Voyage AI |
| Audio storage | Vercel Blob |

## Layout

```
apps/mobile        Expo React Native app
apps/api           Next.js API + web portal
packages/schemas   Shared TypeScript types
```
