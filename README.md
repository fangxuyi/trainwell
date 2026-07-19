# Trainwell

Trainwell turns a recorded personal-training session into a useful workout history. Record while you train, then get a structured recap of exercises, sets, weights, coaching cues, accomplishments, discomfort notes, and ideas for the next session.

The iPhone app is the primary experience. A companion web portal lets you revisit sessions, ask questions about your history, and manage credits from a browser.

## From workout to workout history

1. **Sign in and start a workout** — choose the workout type, optionally add your trainer and goal, and begin recording.
2. **Train without babysitting the app** — recording continues as one session while the phone is locked or another app is open. You can pause, resume, and add timestamped notes.
3. **End the session safely** — Trainwell saves the recording on the phone first. If you are offline, it waits and retries when you reconnect.
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

Trainwell is a training log and reflection tool, not a medical diagnostic service. Pain and discomfort mentioned during a workout are recorded as observations, not diagnoses.

## Project status

Trainwell is under active development and currently focuses on iOS. Core recording, transcription, structured summaries, workout and body-measurement history, authenticated web access, AI questions, credits, and Stripe billing are implemented. Mobile App Store purchases and several recovery and synchronization edge cases remain release work.

For architecture, setup, environment variables, validation commands, and known limitations, see [TECHNICAL.md](TECHNICAL.md).
