# Personal Workout Conversation Recorder and Training Assistant

## 1. Project Overview

Build a **local-first, mobile-first personal training application** that records spoken conversations and notes during a workout session, converts the audio into a transcript, extracts structured workout information, generates a concise session summary, and saves the result as a Markdown document.

The system should help the user:

1. Record a personal training session from a phone.
2. Capture conversations between the user and trainer.
3. Capture spoken exercise notes during the session.
4. Identify exercises, sets, repetitions, weights, duration, rest periods, and subjective observations.
5. Summarize the workout in a consistent Markdown format.
6. Maintain a historical record of completed sessions.
7. Review workout summaries on a phone.
8. Search previous workout sessions.
9. Ask simple questions about exercise technique.
10. Generate recommendations and a preliminary plan for the next workout.
11. Continue recording and taking notes when connectivity is unavailable.
12. Control when audio is uploaded and how long it is retained remotely.

The first version is intended for one user, but the architecture should not prevent future multi-user support.

---

# 2. Architectural Principle: Local-First Hybrid

The application must use a **local-first hybrid architecture**.

Local-first means:

- The phone is the primary capture device.
- Audio chunks are written to local persistent storage before any upload is attempted.
- Session metadata and quick notes are saved locally immediately.
- The application remains usable during temporary loss of connectivity.
- The user can finish a workout without a working network connection.
- Upload and server-side processing occur when connectivity is available and according to the user’s privacy settings.
- Finalized workout summaries are downloaded and cached locally for mobile access.
- User corrections are saved locally first and synchronized to the server afterward.
- The user can export local Markdown and JSON files independently of the server.

The server is used for computationally intensive and cross-session functionality:

- Speech-to-text transcription
- Optional speaker diarization
- Language-model extraction
- Summary generation
- Search across workout history
- Question answering
- Analytics
- Secure backup and synchronization

The phone should not depend on a live server response to:

- Start a workout
- Record audio
- Pause or resume recording
- Add a quick note
- End a workout
- View already-cached summaries
- Edit a locally cached session
- Queue a session for later processing

The expected flow is:

```text
Phone creates a local workout session
→ audio is recorded in local chunks
→ notes and metadata are stored locally
→ upload is attempted when permitted and connected
→ server transcribes and analyzes
→ structured results synchronize back to the phone
→ user reviews and corrects locally
→ corrections synchronize to the server
→ finalized JSON and Markdown are stored remotely and cached locally
```

---

# 3. Privacy and Processing Modes

The application should expose three user-selectable processing modes.

## 3.1 Automatic Hybrid

- Save audio locally first.
- Upload chunks automatically when connectivity is available.
- Prefer Wi-Fi when configured.
- Process on the server.
- Download the transcript, structured record, and Markdown summary.
- Delete server-side audio according to the configured retention policy.

## 3.2 Manual Upload

- Save the entire session locally.
- Do not upload automatically.
- Allow the user to review the recording and choose **Upload for Processing**.
- Keep the session in a local `awaiting_upload` state until approved.

## 3.3 Local Record Only

- Keep audio, notes, and session metadata on the phone.
- Do not upload audio.
- Allow manual workout entry and Markdown export.
- Server-generated transcription and synthesis are unavailable unless the user later changes the session to an upload-enabled mode.

The architecture should leave room for future on-device transcription, but on-device AI processing is not an MVP requirement.

---

# 4. Primary User Experience

## 4.1 Before the Workout

The user opens the application on a phone and selects:

- Start New Workout
- Optional workout type
- Optional trainer name
- Optional workout goal
- Optional planned exercises
- Processing mode
- Audio-retention preference

Example:

```text
Workout type: Strength Training
Trainer: Alex
Goal: Lower-body strength and squat technique
Processing mode: Upload on Wi-Fi
Server audio retention: Delete after review
```

The application immediately creates a local session record.

The user taps **Start Recording**.

---

## 4.2 During the Workout

The application records audio in local segments.

The user and trainer may say things such as:

```text
We are starting with goblet squats.

Use the 25-pound dumbbell.

Do 10 repetitions.

Rest for 60 seconds.

My knees felt better on this set.

I need to keep my chest higher.

The second set was much easier.

We did three sets total.

Next time, try 30 pounds if the form stays stable.
```

The system should not require rigid voice commands. It should infer workout information from normal conversation.

The application should provide optional quick actions:

- Add note
- Mark exercise started
- Mark set completed
- Mark rest started
- Report discomfort
- Add weight or repetition value
- Bookmark recent audio

Quick notes must be stored locally immediately.

Example quick notes:

- Left knee felt uncomfortable.
- Increase weight next session.
- Trainer corrected shoulder position.
- Last set stopped because of fatigue.

---

## 4.3 After the Workout

The user taps **End Workout**.

The phone must immediately:

1. Finalize the current local audio chunk.
2. Save the session end time locally.
3. Mark the session as locally complete.
4. Verify that all recorded chunks exist in local persistent storage.
5. Display whether the session is waiting for upload, uploading, or ready for local review.

When server processing is allowed and connectivity is available, the system:

1. Uploads audio chunks.
2. Verifies remote integrity.
3. Converts audio to text.
4. Separates the transcript into logical segments.
5. Extracts exercises and workout metrics.
6. Identifies trainer instructions and user observations.
7. Detects uncertainties or conflicting information.
8. Generates a structured workout record.
9. Generates a human-readable summary.
10. Creates a proposed plan for the next session.
11. Synchronizes the result back to the phone.

The user sees a review screen before the session is finalized.

The review screen should allow the user to:

- Correct exercise names.
- Correct weights.
- Correct sets and repetitions.
- Add missing exercises.
- Remove incorrectly detected exercises.
- Edit personal notes.
- Edit the next-session plan.
- Mark information as uncertain.
- Save locally without finalizing.
- Finalize and synchronize later.

---

# 5. Local Data and Synchronization Requirements

## 5.1 Local Storage

Use durable local storage rather than in-memory state.

For a PWA:

- IndexedDB for session records, sync jobs, transcript cache, and structured workout data
- Origin Private File System when available for audio chunks
- IndexedDB Blob storage as a fallback
- Service worker for caching application assets and selected summaries

For a future native mobile app:

- SQLite for structured data
- Application sandbox filesystem for audio and exports

Local records should include:

- Session metadata
- Audio chunk manifest
- Quick notes
- Upload status
- Processing status
- Cached transcript
- Cached structured workout data
- Cached Markdown
- Pending user edits
- Synchronization version

## 5.2 Local Write Rule

Every user-generated action must be committed locally before it is acknowledged as successful.

Examples:

- Start session
- Pause session
- Resume session
- Add note
- End session
- Correct set data
- Finalize summary

Network synchronization should occur after the local transaction succeeds.

## 5.3 Synchronization Queue

Maintain a persistent synchronization queue.

Suggested job types:

- create_remote_session
- upload_audio_chunk
- confirm_audio_chunk
- request_processing
- fetch_processing_result
- sync_user_correction
- finalize_remote_session
- delete_remote_audio
- delete_remote_session

Each job should include:

- Job ID
- Session ID
- Job type
- Payload reference
- Attempt count
- Last attempt time
- Next retry time
- Error message
- Status

Suggested statuses:

- pending
- running
- retry_wait
- completed
- blocked
- failed_permanently

Use exponential backoff for transient failures.

## 5.4 Synchronization Semantics

Use stable client-generated UUIDs so the phone and server refer to the same session and audio chunks.

All synchronization endpoints must be idempotent.

Uploading the same chunk twice must not create duplicate audio records.

Use content hashes for audio chunks where practical.

Recommended conflict rules:

1. User corrections override model-generated values.
2. A newer explicit user edit overrides an older user edit.
3. Server processing may populate missing fields but must not overwrite unsynchronized user corrections.
4. Finalized sessions require explicit reopening before model regeneration can replace reviewed values.
5. Conflicts that cannot be resolved automatically should be shown to the user.

Track:

- local_version
- remote_version
- last_synced_version
- updated_at
- updated_by

## 5.5 Storage Pressure

The application should monitor local storage usage.

Provide:

- Estimated local audio size
- Number of sessions awaiting upload
- Storage warning
- Delete local audio after verified upload option
- Keep finalized Markdown locally option
- Download/export before deletion option

Never delete the only known copy of an audio chunk automatically.

---

# 6. Audio Recording

The mobile interface must support:

- Start recording
- Pause recording
- Resume recording
- End recording
- Display elapsed session time
- Display recording status clearly
- Prevent accidental loss of an active session
- Save audio in segments
- Recover completed segments if the browser or application closes unexpectedly

Recommended behavior:

- Record audio in chunks of approximately 30 to 120 seconds.
- Persist every completed chunk locally before upload.
- Maintain a local session manifest.
- Upload asynchronously when allowed.
- Confirm remote storage before marking a chunk as safely synchronized.
- Keep the local copy until the configured retention rule is satisfied.

The system should not depend on keeping one large audio file in memory.

Example audio manifest entry:

```json
{
  "id": "chunk_0007",
  "session_id": "workout_20260616_183000",
  "sequence": 7,
  "local_path": "sessions/workout_20260616_183000/audio/chunk_0007.webm",
  "duration_seconds": 60.2,
  "size_bytes": 932104,
  "sha256": "example-hash",
  "local_status": "stored",
  "remote_status": "pending",
  "created_at": "2026-06-16T18:37:00-04:00"
}
```

---

# 7. Transcription

The transcription layer should produce:

- Transcript text
- Segment start time
- Segment end time
- Speaker label when available
- Confidence score when available
- Original audio segment reference

Preferred speaker labels:

- User
- Trainer
- Unknown

Speaker diarization is useful but should not block the MVP. The user should be able to correct speaker assignments later.

Store the transcript separately from the generated summary.

Example transcript segment:

```json
{
  "start_seconds": 312.4,
  "end_seconds": 321.7,
  "speaker": "trainer",
  "text": "Let's do ten repetitions with the twenty-five-pound dumbbell.",
  "confidence": 0.93
}
```

---

# 8. Workout Information Extraction

The system should attempt to identify the following information.

## 8.1 Session-Level Information

- Session date
- Start time
- End time
- Total duration
- Workout type
- Trainer
- Location, if provided
- User goals
- Overall difficulty
- Overall energy level
- General pain or discomfort
- Session-level notes

## 8.2 Exercise-Level Information

- Canonical exercise name
- Name spoken during the session
- Exercise category
- Equipment
- Body region
- Sets
- Repetitions
- Weight or resistance
- Duration
- Distance
- Rest time
- Tempo
- Side
- Assistance level
- Form instructions
- User observations
- Trainer observations
- Pain or discomfort
- Completion status
- Proposed progression

## 8.3 Set-Level Information

Where the transcript contains enough information, store:

- Set number
- Repetitions planned
- Repetitions completed
- Weight
- Duration
- Distance
- Rest after set
- Rate of perceived exertion
- Form quality
- User comments
- Trainer comments
- Whether the set was warm-up, working, drop, or failure set

The extractor must distinguish between:

- Planned activity
- Completed activity
- Trainer suggestion
- Next-session recommendation

For example:

```text
Next time, try 30 pounds.
```

must not be recorded as a completed 30-pound set.

---

# 9. Uncertainty Handling

The language model must not silently invent missing workout data.

Every extracted field should support:

- Value
- Confidence
- Source transcript references
- Inference status

Suggested inference statuses:

- explicit
- strongly_inferred
- weakly_inferred
- user_corrected
- unknown

Example:

```json
{
  "weight": {
    "value": 25,
    "unit": "lb",
    "confidence": 0.97,
    "status": "explicit",
    "source_segment_ids": ["seg_019"]
  }
}
```

If the system hears:

```text
Let's do another one.
```

it may infer an additional set only when the preceding context clearly supports that interpretation. Otherwise, it should flag the item for review.

The review screen should emphasize low-confidence fields.

---

# 10. Output Markdown Format

Each completed session should generate one Markdown file.

Recommended filename:

```text
YYYY-MM-DD_HHMM_workout-type.md
```

Example:

```text
2026-06-16_1830_lower-body-strength.md
```

Recommended output structure:

```markdown
---
session_id: workout_20260616_183000
date: 2026-06-16
start_time: "18:30"
end_time: "19:35"
duration_minutes: 65
workout_type: Lower Body Strength
trainer: Alex
status: finalized
sync_status: synchronized
audio_retention: deleted_after_review
tags:
  - strength
  - lower-body
  - squat
source_transcript: transcripts/workout_20260616_183000.json
---

# Workout Summary

## Session Overview

- **Date:** June 16, 2026
- **Duration:** 65 minutes
- **Workout Type:** Lower Body Strength
- **Trainer:** Alex
- **Primary Goal:** Improve squat strength and knee alignment
- **Overall Difficulty:** 7/10
- **Energy Level:** Moderate

## Exercises Completed

### 1. Goblet Squat

- **Equipment:** Dumbbell
- **Sets:** 3
- **Repetitions:** 10, 10, 9
- **Weight:** 25 lb
- **Rest:** Approximately 60 seconds
- **Completion:** Completed

#### Set Details

| Set | Weight | Reps | Rest | RPE | Notes |
|---|---:|---:|---:|---:|---|
| 1 | 25 lb | 10 | 60 sec | 6 | Knees felt stable |
| 2 | 25 lb | 10 | 60 sec | 7 | Better chest position |
| 3 | 25 lb | 9 | — | 8 | Final rep stopped because form weakened |

#### Technique Notes

- Keep the chest higher during the descent.
- Keep the knees tracking over the toes.
- Maintain pressure through the full foot.

#### Personal Notes

- Left knee felt better than during the previous session.
- The second set felt more controlled.

## Rest and Recovery

- Typical rest between working sets: 60–75 seconds
- Longest rest period: approximately 3 minutes

## Form and Technique Themes

1. Maintain a taller chest during squatting movements.
2. Improve control near the bottom of the squat.
3. Stop sets before technique meaningfully deteriorates.

## Pain or Discomfort

- Mild left-knee awareness during the first squat set.
- No sharp pain reported.
- Knee sensation improved during later sets.

## What Went Well

- Squat knee alignment improved.
- The user responded well to the chest-position cue.

## What Needs Improvement

- Squat posture deteriorated near fatigue.
- Final repetitions should stop earlier when knee tracking becomes unstable.

## Plan for Next Session

- Repeat goblet squats at 25 lb for the first set.
- Increase to 30 lb only if the first set is stable and pain-free.
- Target 3 sets of 8–10 repetitions.
- Maintain at least 60–75 seconds of rest.

## Open Questions

- Was the final squat rest period longer than 60 seconds?

## Session Timeline

- 00:00–08:00 — Warm-up and mobility
- 08:00–25:00 — Goblet squats
- 25:00–41:00 — Romanian deadlifts
- 41:00–55:00 — Split squats
- 55:00–65:00 — Cooldown and session review

## Source Notes

This summary was generated from the session transcript and reviewed by the user.
```

---

# 11. Data Model

Use structured JSON as the source of truth. Markdown is a rendered representation, not the primary database.

## 11.1 Workout Session

```typescript
interface WorkoutSession {
  id: string;
  userId: string;

  startedAt: string;
  endedAt?: string;
  timezone: string;
  durationSeconds?: number;

  workoutType?: string;
  trainerName?: string;
  location?: string;
  goals: string[];
  tags: string[];

  processingMode:
    | "automatic_hybrid"
    | "manual_upload"
    | "local_only";

  localStatus:
    | "draft"
    | "recording"
    | "paused"
    | "locally_complete"
    | "awaiting_upload"
    | "syncing"
    | "cached"
    | "local_error";

  remoteStatus:
    | "not_created"
    | "uploading"
    | "uploaded"
    | "processing"
    | "review_required"
    | "finalized"
    | "failed";

  syncStatus:
    | "local_only"
    | "pending"
    | "partially_synced"
    | "synchronized"
    | "conflict"
    | "failed";

  localVersion: number;
  remoteVersion?: number;
  lastSyncedVersion?: number;

  audioSegments: AudioSegment[];
  transcriptSegments: TranscriptSegment[];
  exercises: ExerciseRecord[];

  sessionNotes: string[];
  techniqueThemes: string[];
  accomplishments: string[];
  improvementAreas: string[];
  painObservations: PainObservation[];
  nextSessionPlan?: NextSessionPlan;

  overallDifficulty?: number;
  energyLevel?: number;

  markdownContent?: string;
  localMarkdownPath?: string;
  remoteMarkdownPath?: string;

  audioRetentionPolicy:
    | "keep"
    | "delete_after_transcription"
    | "delete_after_review"
    | "manual";

  extractionVersion?: string;
  summaryVersion?: string;

  createdAt: string;
  updatedAt: string;
}
```

## 11.2 Exercise Record

```typescript
interface ExerciseRecord {
  id: string;
  canonicalName: string;
  spokenNames: string[];

  category?: string;
  bodyRegions: string[];
  equipment: string[];

  sequenceNumber: number;
  startedAtSeconds?: number;
  endedAtSeconds?: number;

  planned: boolean;
  completed: boolean;

  sets: ExerciseSet[];

  techniqueNotes: SourcedNote[];
  userNotes: SourcedNote[];
  trainerNotes: SourcedNote[];
  painObservations: PainObservation[];

  progressionSuggestion?: SourcedNote;
  confidence: number;
}
```

## 11.3 Exercise Set

```typescript
interface ExerciseSet {
  setNumber: number;
  setType?: "warmup" | "working" | "drop" | "failure" | "unknown";

  plannedReps?: number;
  completedReps?: number;

  weight?: Measurement;
  duration?: Measurement;
  distance?: Measurement;
  resistance?: string;

  side?: "left" | "right" | "bilateral";
  restAfterSeconds?: number;
  tempo?: string;
  rpe?: number;

  completed: boolean;
  formQuality?: "good" | "acceptable" | "poor" | "unknown";

  userNotes: SourcedNote[];
  trainerNotes: SourcedNote[];

  confidence: number;
  sourceSegmentIds: string[];
}
```

## 11.4 Transcript Segment

```typescript
interface TranscriptSegment {
  id: string;
  audioSegmentId: string;

  startSeconds: number;
  endSeconds: number;

  speaker: "user" | "trainer" | "unknown";
  text: string;

  confidence?: number;
  reviewed: boolean;
}
```

## 11.5 Synchronization Job

```typescript
interface SyncJob {
  id: string;
  sessionId: string;

  type:
    | "create_remote_session"
    | "upload_audio_chunk"
    | "request_processing"
    | "fetch_processing_result"
    | "sync_user_correction"
    | "finalize_remote_session"
    | "delete_remote_audio"
    | "delete_remote_session";

  status:
    | "pending"
    | "running"
    | "retry_wait"
    | "completed"
    | "blocked"
    | "failed_permanently";

  payloadReference?: string;
  attemptCount: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  lastError?: string;

  createdAt: string;
  updatedAt: string;
}
```

---

# 12. System Architecture

## 12.1 Recommended MVP Architecture

### Mobile Client

Build a Progressive Web Application using:

- Next.js
- React
- TypeScript
- Tailwind CSS
- IndexedDB
- Origin Private File System where available
- MediaRecorder API
- Service worker
- Background Sync API where supported
- Explicit foreground retry fallback where Background Sync is unavailable

A PWA is preferred for the first version because it:

- Works on both iPhone and Android.
- Avoids maintaining two native applications.
- Can be installed on the home screen.
- Supports rapid development.
- Can later be replaced or wrapped by a native application.

Important limitation:

Mobile browsers may suspend recording or background tasks when:

- The screen locks
- The browser is backgrounded
- A phone call occurs
- The operating system reclaims resources

The recording proof of concept must be tested early on the user’s actual phone.

If browser recording reliability is inadequate, use React Native or Expo while keeping the same local-first data model, synchronization protocol, backend, and Markdown format.

### Backend

Recommended options:

- FastAPI with Python, or
- Next.js server routes with TypeScript

Python is preferable if future workout analysis will use data-processing or machine-learning libraries.

Backend responsibilities:

- Create and manage remote workout records.
- Issue secure upload URLs.
- Receive audio segment metadata.
- Verify audio chunk integrity.
- Trigger transcription.
- Store transcript segments.
- Run workout extraction.
- Generate summaries.
- Render Markdown.
- Serve workout history.
- Support search and question answering.
- Maintain processing status.
- Apply retention and deletion policies.

### Database

Use PostgreSQL.

For the MVP:

- Relational tables for users, sessions, audio chunks, and sync metadata
- JSONB for extracted exercise details where useful
- Version columns for synchronization and conflict detection

Recommended services:

- Supabase PostgreSQL
- Neon PostgreSQL
- Local PostgreSQL for a self-hosted deployment

### File Storage

Use object storage for:

- Uploaded audio segments
- Raw transcripts
- Final Markdown files
- Optional exported JSON files

Possible storage options:

- Supabase Storage
- Amazon S3
- Cloudflare R2
- Local filesystem for a local server prototype

### Background Processing

Use a job queue for transcription and summarization.

Possible implementations:

- Celery and Redis
- Dramatiq and Redis
- BullMQ
- A database-backed job table for the MVP

Do not perform long transcription jobs directly inside a normal HTTP request.

---

# 13. Processing Pipeline

## Stage 1: Create Local Session

Create a local session record when the user taps **Start Workout**.

Generate the final stable session UUID on the phone.

Do not require network access.

## Stage 2: Capture Audio Locally

For each chunk:

1. Finalize the audio Blob.
2. Write it to durable local storage.
3. Calculate sequence number.
4. Update the local audio manifest.
5. Acknowledge the completed chunk to the UI.
6. Queue upload if the processing mode allows it.

## Stage 3: Synchronize

When connectivity and user settings permit:

1. Create the remote session idempotently.
2. Upload missing chunks.
3. Verify server receipt and optional content hash.
4. Update local chunk sync status.
5. Keep or delete the local copy according to policy.

## Stage 4: Transcribe

Each audio chunk is transcribed separately.

Preserve:

- Chunk sequence
- Local timestamps
- Text
- Confidence
- Speaker labels where supported

Merge segments into a session transcript while retaining original segment IDs.

## Stage 5: Normalize Transcript

Apply lightweight normalization:

- Standardize common number expressions.
- Preserve original text.
- Convert likely units to normalized forms.
- Detect likely exercise names.
- Remove duplicate overlap between chunks.
- Do not rewrite the full transcript destructively.

## Stage 6: Extract Workout Events

Suggested event types:

- exercise_started
- exercise_completed
- set_started
- set_completed
- reps_reported
- weight_reported
- duration_reported
- distance_reported
- rest_started
- rest_completed
- technique_instruction
- user_observation
- trainer_observation
- pain_reported
- progression_suggested
- correction
- session_note

## Stage 7: Reconcile Events

A deterministic reconciliation layer should:

- Group events by exercise.
- Assign set numbers.
- Resolve repeated mentions.
- Distinguish corrections from duplicates.
- Identify conflicting values.
- Estimate rest periods from timestamps when appropriate.
- Avoid treating planned values as completed values.
- Preserve unresolved ambiguity.

Use model extraction for interpretation and regular code for validation.

## Stage 8: Synchronize Draft Result to Phone

The phone downloads:

- Transcript
- Structured workout record
- Draft summary
- Open questions
- Processing metadata

The result is cached locally.

## Stage 9: User Review

The user may review while online or offline.

Edits are stored locally first and added to the synchronization queue.

The session remains in `review_required` status until accepted.

## Stage 10: Finalize

After user review:

- Save corrected structured JSON locally.
- Render Markdown locally or deterministically from shared code.
- Synchronize corrections.
- Render and store the canonical remote Markdown.
- Download/cache the finalized Markdown.
- Update exercise history.
- Apply audio-retention policy.

---

# 14. Language Model Responsibilities

Use a language model for:

- Exercise-name recognition
- Contextual interpretation
- Trainer-versus-user note classification
- Planned-versus-completed distinction
- Technique-note summarization
- Next-session recommendation extraction
- Natural-language question answering

Do not rely on the language model alone for:

- Arithmetic
- Duration calculations
- Timeline ordering
- Unit conversion
- Database filtering
- Personal-record detection
- Workout-volume calculation
- Synchronization
- Conflict resolution
- File retention

These should be implemented in deterministic code.

---

# 15. Exercise Knowledge and Question Answering

Maintain a normalized exercise library.

The user should be able to ask:

```text
How do I do a Romanian deadlift?
```

```text
What did my trainer tell me about my squat?
```

```text
What weight did I use for goblet squats last time?
```

```text
How many lower-body sessions did I complete this month?
```

```text
When did my left knee bother me?
```

```text
What should I focus on during my next session?
```

When offline:

- Answer from cached exercise definitions.
- Answer from locally cached workout history when possible.
- Clearly indicate when a complete answer requires synchronization.

When online:

- Query the full remote workout history.
- Use structured database queries whenever possible.
- Use semantic retrieval only for notes and transcript passages.
- Cite the relevant workout sessions or notes in the answer.

General exercise guidance and personalized trainer guidance must remain clearly separated.

---

# 16. Safety and Health Boundaries

The application is a recordkeeping and educational tool, not a medical provider.

It should:

- Preserve pain observations.
- Avoid diagnosing injuries.
- Avoid telling the user to train through sharp pain.
- Avoid replacing medical advice.
- Encourage professional evaluation for severe, persistent, or worsening symptoms.
- Make clear when technique guidance is general rather than personalized.

---

# 17. Privacy, Consent, and Retention

Because the application records conversations, privacy should be a core feature.

Requirements:

- Display a clear recording indicator.
- Allow recording to be paused immediately.
- Inform the user that trainer consent may be required depending on applicable law.
- Encrypt data in transit.
- Encrypt stored server data where supported.
- Protect local data using the mobile operating system and browser security model.
- Avoid public audio URLs.
- Use short-lived signed URLs.
- Provide a delete-audio option.
- Allow summaries to remain after source audio is deleted.
- Allow complete local and remote session deletion.
- Do not use recordings for model training without explicit consent.
- Log retention and deletion operations.
- Confirm remote deletion status to the phone.

Supported retention policies:

- Keep remote audio indefinitely.
- Delete remote audio after transcription.
- Delete remote audio after user review.
- Delete remote audio manually.
- Keep audio local only.
- Delete local audio after verified remote upload.
- Keep transcript and summary only.

---

# 18. Offline and Failure Recovery

The system should handle unreliable gym connectivity.

Minimum requirements:

- Save chunks locally before upload.
- Show upload state.
- Retry failed uploads.
- Resume when connectivity returns.
- Preserve active-session metadata.
- Allow a workout to end offline.
- Avoid remote processing until all expected chunks are accounted for or the user approves partial processing.
- Allow notes to remain usable when audio processing fails.
- Allow a user to export locally even when the server is unavailable.

Suggested combined states:

```text
recording
paused
locally_complete
awaiting_upload
partially_uploaded
uploaded
transcribing
extracting
review_required
finalized
sync_conflict
processing_failed
```

Recovery rules:

- On app startup, scan for unfinished local sessions.
- Offer to resume or close an interrupted recording.
- Rebuild upload jobs from the local audio manifest.
- Never mark a chunk synchronized solely because an upload request was sent.
- Confirm remote persistence before updating local status.
- Preserve failed processing results and error messages for retry.

---

# 19. Recommended Screens

## 19.1 Home

- Start Workout
- Continue Active Workout
- Sessions Awaiting Upload
- Recent Sessions
- Ask Training Assistant
- Exercise Library
- Local Storage Status

## 19.2 New Workout

- Workout type
- Trainer
- Goal
- Processing mode
- Upload preference
- Audio retention
- Start recording

## 19.3 Active Workout

- Recording indicator
- Elapsed duration
- Connectivity indicator
- Local save status
- Pause or resume
- Add quick note
- Add exercise manually
- Mark current exercise
- End workout

## 19.4 Synchronization Status

- Chunks stored locally
- Chunks uploaded
- Waiting for Wi-Fi
- Retry failures
- Upload now
- Cancel upload
- Keep local only

## 19.5 Processing

- Audio uploaded
- Transcription in progress
- Workout extraction in progress
- Summary generation in progress
- Processing errors

## 19.6 Review Session

- Session overview
- Exercise list
- Set editor
- Notes
- Technique corrections
- Pain observations
- Next-session plan
- Transcript viewer
- Local save status
- Synchronization status
- Save locally
- Finalize

## 19.7 Session Detail

- Markdown-style summary
- Exercise details
- Timeline
- Transcript
- Audio playback, if retained
- Edit
- Export
- Delete local copy
- Delete remote copy

## 19.8 History

- Cached sessions available offline
- Complete synchronized history online
- Calendar or chronological list
- Exercise filter
- Workout-type filter
- Search
- Weekly and monthly summaries

---

# 20. API Outline

All write endpoints must support idempotency.

```text
POST   /api/workouts
GET    /api/workouts
GET    /api/workouts/:id
PATCH  /api/workouts/:id
DELETE /api/workouts/:id

POST   /api/workouts/:id/audio-segments
POST   /api/workouts/:id/audio-segments/:segmentId/complete
GET    /api/workouts/:id/audio-segments
DELETE /api/workouts/:id/audio

POST   /api/workouts/:id/end
POST   /api/workouts/:id/process
POST   /api/workouts/:id/reprocess
POST   /api/workouts/:id/finalize
GET    /api/workouts/:id/processing-status

GET    /api/workouts/:id/transcript
PATCH  /api/workouts/:id/transcript

GET    /api/workouts/:id/sync-state
POST   /api/workouts/:id/resolve-conflict

GET    /api/exercises
GET    /api/exercises/:id
POST   /api/exercises
PATCH  /api/exercises/:id

POST   /api/assistant/questions
GET    /api/analytics/weekly
GET    /api/analytics/exercises/:exerciseId
```

Recommended headers:

```text
Idempotency-Key
If-Match
X-Client-Version
X-Local-Version
```

---

# 21. Repository Structure

```text
workout-assistant/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── local-db/
│   │   ├── recording/
│   │   ├── sync/
│   │   ├── service-worker/
│   │   └── public/
│   └── worker/
│       ├── jobs/
│       ├── transcription/
│       ├── extraction/
│       ├── reconciliation/
│       └── summarization/
├── packages/
│   ├── schemas/
│   ├── database/
│   ├── sync-protocol/
│   ├── prompts/
│   ├── exercise-library/
│   └── markdown-renderer/
├── storage/
│   ├── audio/
│   ├── transcripts/
│   ├── structured/
│   └── summaries/
├── tests/
│   ├── fixtures/
│   ├── unit/
│   ├── integration/
│   ├── offline/
│   └── end-to-end/
├── docs/
│   ├── product-spec.md
│   ├── architecture.md
│   ├── local-first-design.md
│   ├── synchronization.md
│   ├── data-model.md
│   ├── privacy.md
│   └── prompt-contracts.md
├── docker-compose.yml
├── .env.example
└── README.md
```

---

# 22. MVP Scope

The first usable version should include:

1. Mobile recording.
2. Pause and resume.
3. Local audio-chunk persistence.
4. Local session recovery.
5. Persistent synchronization queue.
6. Manual or automatic upload.
7. Wi-Fi-only upload preference where feasible.
8. Session creation and completion while offline.
9. Speech-to-text transcription.
10. Exercise extraction.
11. Sets, repetitions, weight, duration, and rest extraction.
12. User and trainer note extraction.
13. Review and correction screen.
14. Offline correction storage.
15. Markdown generation.
16. Local Markdown cache and export.
17. Workout-history screen.
18. Session-detail screen.
19. Exercise-name search.
20. Basic workout-history questions.
21. Audio retention and deletion controls.
22. Complete local and remote session deletion.

Do not make these MVP blockers:

- Perfect speaker identification
- Real-time transcription
- Fully on-device transcription
- Automatic repetition counting from audio
- Video analysis
- Wearable integration
- Advanced charts
- Social sharing
- Trainer accounts
- Multi-user collaboration
- Fully autonomous workout programming

---

# 23. Suggested Development Phases

## Phase 1: Local-First Foundation

- Initialize repository.
- Define shared schemas.
- Build IndexedDB layer.
- Build local session state machine.
- Build synchronization-job model.
- Add local storage diagnostics.
- Add session recovery.

## Phase 2: Recording Proof of Concept

- Implement MediaRecorder capture.
- Implement chunking.
- Persist chunks locally.
- Implement pause and resume.
- Recover after browser refresh or close where possible.
- Test on the target phone.

## Phase 3: Synchronization

- Implement idempotent remote session creation.
- Implement chunk upload.
- Add retries and integrity confirmation.
- Add manual, automatic, and local-only modes.
- Add retention behavior.

## Phase 4: Transcription

- Add transcription provider interface.
- Store timestamped transcript segments.
- Synchronize transcript to phone.
- Cache transcript locally.
- Add transcript correction.

## Phase 5: Workout Extraction

- Define event schema.
- Implement extraction prompt.
- Validate model output.
- Add deterministic reconciliation.
- Add confidence and source references.
- Build exercise review interface.

## Phase 6: Summary and Markdown

- Create structured summary schema.
- Generate Markdown through shared deterministic code.
- Cache Markdown locally.
- Add export.
- Add session-detail screen.

## Phase 7: History and Questions

- Add cached offline history.
- Add complete online search and filters.
- Add structured workout-history questions.
- Add exercise knowledge base.
- Add sourced assistant answers.

## Phase 8: Reliability and Privacy

- Add conflict handling.
- Add storage-pressure handling.
- Add full deletion workflows.
- Add encryption and access controls.
- Add logging and processing diagnostics.

---

# 24. Acceptance Criteria

## Local-First Behavior

- A workout can be started, recorded, paused, resumed, and ended without network access.
- Every completed audio chunk is durably stored locally before the UI marks it saved.
- Closing and reopening the application does not lose completed chunks.
- A locally completed session can be uploaded later.
- User edits made offline remain after restart and synchronize later.
- Previously cached summaries can be opened offline.
- The user can export Markdown locally without waiting for synchronization.

## Synchronization

- Uploading the same chunk twice does not create duplicates.
- Interrupted uploads resume.
- Remote confirmation is required before a chunk is considered synchronized.
- User corrections are not overwritten by later model results.
- Conflicts are surfaced rather than silently resolved incorrectly.
- The application accurately distinguishes local, pending, synchronized, and failed states.

## Recording

- A 60-minute session can be recorded without losing completed chunks.
- Recording can be paused and resumed.
- Upload failures are visible and retryable.
- The user can end the workout while offline.

## Transcription

- Transcript segments retain timestamps.
- The user can edit transcript text.
- The transcript remains accessible after summary generation.

## Extraction

Given:

```text
We did three sets of ten goblet squats with 25 pounds and rested one minute between sets.
```

extract:

- Exercise: Goblet Squat
- Sets: 3
- Repetitions: 10 per set
- Weight: 25 lb
- Rest: 60 seconds

Given:

```text
Try 30 pounds next time.
```

record a next-session recommendation, not a completed set.

Given:

```text
My left knee feels a little uncomfortable.
```

record a discomfort observation without creating a diagnosis.

## Review

- The user can correct any exercise.
- The user can add or remove sets.
- The user can change weights and repetitions.
- The user can edit the next-session plan.
- Corrections persist locally immediately.
- Corrections are marked as user-corrected.
- Corrections synchronize without being overwritten.

## Markdown

- Every finalized workout has a Markdown representation.
- Markdown includes front matter.
- Completed work and future plans are clearly separated.
- Unknown values are omitted or explicitly marked uncertain.
- The same structured data produces deterministic Markdown.
- Finalized Markdown is cached locally.

## Privacy

- The user can choose not to upload a session.
- The user can delete remote audio while keeping the summary.
- The user can delete both local and remote copies.
- The system does not delete the only known copy automatically.
- Retention actions are visible and auditable.

---

# 25. Testing Strategy

## Unit Tests

Test:

- Local session state transitions
- Sync job transitions
- Retry timing
- Conflict resolution
- Time calculations
- Unit normalization
- Volume calculations
- Markdown rendering
- Event reconciliation
- Duplicate transcript removal
- Planned-versus-completed classification

## Offline Tests

Test:

- Start and end with airplane mode enabled
- Refresh during a session
- Close and reopen after several chunks
- Add notes offline
- Edit a processed session offline
- Queue upload and restore connectivity
- Interrupt upload mid-chunk
- Synchronize after multiple days
- Storage-quota warning
- Server unavailable during finalization

## Prompt Fixture Tests

Create fixtures for:

- Clear structured workout
- Casual conversation
- Corrections
- Conflicting numbers
- Missing set counts
- Weight changes between sets
- Unilateral exercises
- Timed exercises
- Distance exercises
- Supersets
- Pain mentions
- Future recommendations
- Background conversation
- Exercise aliases

## Integration Tests

Test:

- Local chunk to remote object storage
- Remote audio to transcript
- Transcript to workout events
- Events to reconciled session
- Session to Markdown
- Server result to local cache
- Offline user correction to synchronized final record
- Remote audio deletion after review

## End-to-End Tests

On an actual phone:

1. Disable connectivity.
2. Start a workout.
3. Record several spoken exercises.
4. Pause and resume.
5. Add quick notes.
6. End the session.
7. Close and reopen the app.
8. Confirm the session and chunks remain.
9. Restore connectivity.
10. Upload and process.
11. Review the extracted data.
12. Go offline.
13. Correct a weight.
14. Restore connectivity and synchronize.
15. Finalize.
16. Open the cached summary offline.
17. Ask what weight was used.
18. Delete server audio.
19. Confirm the summary remains.

---

# 26. Engineering Principles

1. Local data is the immediate source of truth for unsynchronized user actions.
2. Structured workout JSON is the canonical domain representation.
3. Markdown is an export and presentation format.
4. Persist before acknowledging success.
5. Synchronization must be idempotent and resumable.
6. Preserve raw source material until retention rules permit deletion.
7. Every important extracted fact should be traceable to transcript evidence.
8. Model output must be validated.
9. Deterministic code should handle calculations, synchronization, and database queries.
10. User corrections always override model extraction.
11. Low-confidence values must be visible.
12. The system should degrade gracefully when transcription or the server fails.
13. Privacy and deletion should be designed from the beginning.
14. Never delete the only known copy of user data automatically.
15. Avoid premature complexity.
16. Complete the local recording-to-synchronized-summary workflow before advanced analytics.

---

# 27. Instructions for Claude Code

Implement this project incrementally.

Before writing substantial code:

1. Review this specification.
2. Create `docs/architecture.md`.
3. Create `docs/local-first-design.md`.
4. Create `docs/synchronization.md`.
5. Create `docs/data-model.md`.
6. Create `docs/implementation-plan.md`.
7. List major technical risks.
8. Identify assumptions.
9. Define the MVP boundary.
10. Propose the repository structure.
11. Define local and remote state machines.
12. Define JSON schemas for model outputs.
13. Define idempotency and conflict-resolution rules.
14. Define mobile-browser limitations and the native fallback threshold.

During implementation:

- Use TypeScript strict mode.
- Validate all API inputs and model outputs.
- Use database migrations.
- Never commit secrets.
- Provide `.env.example`.
- Add tests for important business logic.
- Keep transcription and language-model providers behind interfaces.
- Keep Markdown rendering deterministic.
- Add source references to extracted information.
- Do not silently discard uncertain information.
- Save user actions locally before synchronizing.
- Make all remote write operations idempotent.
- Keep commits small and logically grouped.
- Update documentation as architectural decisions change.

Do not begin with advanced analytics or visual design.

First complete this end-to-end path:

```text
Create session locally
→ record audio locally
→ end session offline
→ recover after restart
→ synchronize audio
→ transcribe
→ extract workout
→ cache result locally
→ review and edit offline
→ synchronize corrections
→ finalize
→ generate and cache Markdown
→ browse history
→ answer a basic historical question
```

After completing each phase:

1. Run tests.
2. Report completed work.
3. Report known limitations.
4. Report manual test steps.
5. Update the implementation checklist.
6. Recommend the next smallest coherent phase.

---

# 28. Initial Deliverables Requested from Claude Code

Before implementing the full application, produce:

1. Technical architecture proposal.
2. Local-first storage design.
3. Synchronization protocol.
4. Local and remote state machines.
5. Conflict-resolution policy.
6. Database schema.
7. TypeScript domain interfaces.
8. JSON schemas for extraction and summary output.
9. API contract with idempotency behavior.
10. Mobile recording proof of concept.
11. Offline recovery proof of concept.
12. Transcript and workout fixture data.
13. Deterministic Markdown renderer.
14. Development roadmap with milestone-level acceptance criteria.

The first proof of concept should demonstrate:

```text
Record sample audio while offline
→ store chunks locally
→ close and reopen the app
→ recover the session
→ restore connectivity
→ upload idempotently
→ generate timestamped transcript
→ generate structured exercise JSON
→ cache an editable review locally
→ finalize a Markdown workout summary
→ open the summary offline
```

---

# 29. Key Technical Risks

Claude Code should explicitly evaluate these risks before implementation:

1. iOS browser suspension during long recordings.
2. Browser storage quotas and eviction behavior.
3. Background Sync support differences across browsers.
4. Audio codec compatibility with the transcription provider.
5. Uploading large numbers of chunks reliably.
6. Detecting missing or duplicated chunks.
7. Conflict resolution between offline edits and remote processing.
8. Protecting sensitive audio locally and remotely.
9. Accurately separating planned work from completed work.
10. Preventing model-generated summaries from overwriting user corrections.
11. Maintaining deterministic Markdown across client and server.
12. Supporting deletion while retaining derived summaries.

The proof-of-concept phase should prioritize risks 1 through 7 before building broader product features.
