# Motion Memo

Motion Memo turns a recorded personal-training session into a useful workout history. Record while you train, then get a structured recap of exercises, sets, weights, coaching cues, accomplishments, discomfort notes, and ideas for the next session.

The iPhone app is the primary experience. A companion web portal lets you revisit sessions, ask questions about your history, and manage credits from a browser.

## OpenAI Build Week

Motion Memo existed before OpenAI Build Week as an early mobile and web workout-recording product. Before the submission period, the repository already included continuous recording, Clerk authentication, user-scoped API routes, retryable Vercel Blob uploads, transcription, and an initial windowed workout-extraction pipeline.

During Build Week, the project was meaningfully extended into the current product:

- Refined structured workout extraction, preserved context across transcript windows, and added deterministic exercise-name matching.
- Added editable review and finalization, including exercises, sets, reps, weights, and trainer cues.
- Rebuilt Ask AI around finalized records, user-scoped SQL plus pgvector hybrid retrieval, and multi-round conversations.
- Added credits, Stripe billing, RevenueCat integration scaffolding, body measurements, and private-beta invitation support.
- Hardened interrupted-recording recovery, background synchronization, uploads, processing retries, and finalization consistency.
- Refreshed the mobile app, recording screen, Live Activity, secondary screens, web portal, and product identity as Motion Memo.

Representative Build Week pull requests include [hybrid finalized-record retrieval](https://github.com/fangxuyi/trainwell/pull/44), [multi-round Ask AI](https://github.com/fangxuyi/trainwell/pull/46), [editable workout review](https://github.com/fangxuyi/trainwell/pull/53), [processing reliability](https://github.com/fangxuyi/trainwell/pull/52), and the [Motion Memo rebrand](https://github.com/fangxuyi/trainwell/pull/54). The repository history provides the complete dated implementation record.

### How Codex contributed

Codex served as an engineering partner across product planning, repository analysis, implementation, debugging, validation, and delivery. It helped trace the local-first recording and synchronization flows, propose implementation plans, update the mobile app and server APIs together, keep shared schemas aligned, and deliver focused pull requests. Important decisions made through this collaboration included preserving on-device state before network work, uploading recordings through presigned Blob URLs, indexing only finalized user-reviewed records, and using the existing Neon Postgres and pgvector stack for hybrid retrieval rather than introducing another search service.

### How GPT-5.6 is used

The Build Week deployment uses the OpenAI provider implemented in `apps/api/lib/language-model.ts`, which defaults to `gpt-5.6-terra`. GPT-5.6 converts workout transcripts into structured exercise and coaching data, answers questions over retrieved finalized workout records, and rewrites contextual follow-up questions into standalone retrieval queries. Retrieval remains deterministic and grounded: authenticated SQL and pgvector select only the signed-in user’s finalized records, then GPT-5.6 generates an answer from that supplied context. Model output is treated as untrusted and reviewed workout corrections remain authoritative.

## From workout to workout history

1. **Sign in and start a workout** — choose the workout type, optionally add your trainer and goal, and begin recording.
2. **Train without babysitting the app** — recording continues as one session while the phone is locked or another app is open. You can pause, resume, and add timestamped notes.
3. **End the session safely** — Motion Memo saves the recording on the phone first. If you are offline, it waits and retries when you reconnect.
4. **Receive an AI workout recap** — the recording is transcribed and converted into exercises, completed sets, reps, weights, trainer cues, session themes, accomplishments, discomfort observations, and a next-session plan.
5. **Review before finalizing** — correct exercise names, reps, or weights instead of treating AI output as unquestionable.
6. **Build on your history** — browse past workouts or ask questions such as “How has my squat changed?” and “What cues did my trainer give me?”

## Features

### Record naturally

- Continuous workout recording, including background recording on iOS.
- A modern live-workout screen with elapsed time, audio activity, local-save status, session context, pause/resume controls, and timestamped quick notes.
- Branded lock-screen and Dynamic Island Live Activity views with a system-updating timer and distinct recording and paused states; final device confirmation remains required on supported iPhones.
- Local-first storage, so a connection is not required while you train.
- Local audio-retention choices for keeping recordings or deleting them after processing or review.

### Get a structured workout recap

- Exercise names, sets, reps, weights, equipment, and approximate exercise timing.
- Optional on-demand movement previews for confidently matched exercises when a licensed media source is configured.
- Personalized trainer cues and technique themes.
- Accomplishments, improvement areas, pain or discomfort observations, and next-session suggestions.
- Context-aware processing for long sessions so exercises crossing an AI processing boundary are less likely to be lost or counted twice.
- Exercise-name normalization against a pinned public exercise dataset when a confident match exists.
- Movement previews stay collapsed until requested, so reports remain readable and do not download every animation at once.

### Review and learn over time

- Recent sessions and full workout history on mobile.
- Full workout review before finalization: rename, add, or remove exercises; add or remove sets; edit reps and weights; and add, edit, or remove trainer cues.
- Body measurement tracking for waist, chest, hips, limbs, and custom areas, with centimeter or inch units, dated history, and changes from the prior entry.
- Ask AI across prior sessions using only the signed-in user’s workout history.
- Authenticated web portal for viewing session details and asking workout-history questions.

### Manage your account and credits

- Account menu showing the signed-in name and email, available credits, membership status, and account-switching controls.
- 100 non-expiring starter credits for every user.
- One credit covers each started minute of transcription.
- Web purchases through Stripe:
  - 100 non-expiring credits for **$5**.
  - 300 credits per month for **$6.99/month**.
  - 800 credits per month for **$15.99/month**.
- Monthly credits reset each billing period and do not roll over; permanent credits remain until used.

## Mobile and web

| Experience | Best for |
|---|---|
| **iPhone app** | Recording workouts, reviewing summaries, tracking body measurements, browsing history, checking credits, and asking AI questions. |
| **Web portal** | Reviewing sessions on a larger screen, asking questions, purchasing credits, and managing a Stripe subscription. |

Mobile App Store billing is implemented through RevenueCat but is not yet live because the App Store Connect products and Apple Developer release setup are still pending. Until that setup is complete, purchases are available through the Stripe-powered web portal.

## Privacy and reliability

- Access to workout, account, and credit data requires Clerk authentication.
- Server data and locally cached mobile sessions are scoped to the signed-in user.
- Recordings are committed to on-device storage before upload work begins.
- Upload and processing work is retryable, and the server can finish processing while the app is closed.
- Ask AI retrieves context only from the current user’s workout history.

Motion Memo is a training log and reflection tool, not a medical diagnostic service. Pain and discomfort mentioned during a workout are recorded as observations, not diagnoses.

## Project status

Motion Memo is under active development and currently focuses on iOS. Core recording, transcription, structured summaries, workout and body-measurement history, authenticated web access, AI questions, credits, and Stripe billing are implemented. Mobile App Store purchases and several recovery and synchronization edge cases remain release work.

For architecture, setup, environment variables, validation commands, and known limitations, see [TECHNICAL.md](TECHNICAL.md).

## Run locally

Prerequisites include Node.js, npm, Xcode for iOS, and configured service credentials described in [TECHNICAL.md](TECHNICAL.md). Never commit local `.env` files or server secrets.

```bash
npm install

cp apps/api/.env.example apps/api/.env
npm run api

cp apps/mobile/.env.example apps/mobile/.env
npm run mobile
```

The web portal runs at `http://localhost:3000` by default. Native recording, Live Activities, and RevenueCat require an iOS development or release build rather than Expo Go.

Validate relevant changes with:

```bash
npm run typecheck
npm run lint --workspace=apps/api
npm run build --workspace=apps/api
cd apps/mobile && npx tsc --noEmit
```

The deployed portal is available at [api-ebon-mu-79.vercel.app](https://api-ebon-mu-79.vercel.app/). Judge credentials, when needed, should be supplied privately through the Devpost testing instructions rather than committed to this public repository.
