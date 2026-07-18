// ─── Shared domain types ───────────────────────────────────────────────────

export type ProcessingMode = "automatic_hybrid" | "manual_upload" | "local_only";

export type LocalStatus =
  | "draft"
  | "recording"
  | "paused"
  | "interrupted"
  | "locally_complete"
  | "awaiting_upload"
  | "syncing"
  | "cached"
  | "local_error";

export type RemoteStatus =
  | "not_created"
  | "uploading"
  | "uploaded"
  | "processing"
  | "review_required"
  | "finalized"
  | "failed";

export type SyncStatus =
  | "local_only"
  | "pending"
  | "partially_synced"
  | "synchronized"
  | "conflict"
  | "failed";

export type AudioRetentionPolicy =
  | "keep"
  | "delete_after_transcription"
  | "delete_after_review"
  | "manual";

export type InferenceStatus =
  | "explicit"
  | "strongly_inferred"
  | "weakly_inferred"
  | "user_corrected"
  | "unknown";

export type SyncJobType =
  | "create_remote_session"
  | "upload_audio_chunk"
  | "confirm_audio_chunk"
  | "request_processing"
  | "fetch_processing_result"
  | "sync_user_correction"
  | "finalize_remote_session"
  | "delete_remote_audio"
  | "delete_remote_session";

export type SyncJobStatus =
  | "pending"
  | "running"
  | "retry_wait"
  | "completed"
  | "blocked"
  | "failed_permanently";

// ─── Audio ─────────────────────────────────────────────────────────────────

export interface AudioSegment {
  id: string;
  sessionId: string;
  sequence: number;
  localPath: string;
  durationSeconds: number;
  sizeBytes: number;
  sha256?: string;
  localStatus: "recording" | "interrupted" | "stored" | "deleted";
  remoteStatus: "pending" | "uploading" | "uploaded" | "failed" | "deleted";
  remoteUrl?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Transcript ─────────────────────────────────────────────────────────────

export interface TranscriptSegment {
  id: string;
  audioSegmentId: string;
  startSeconds: number;
  endSeconds: number;
  speaker: "user" | "trainer" | "unknown";
  text: string;
  confidence?: number;
  reviewed: boolean;
}

// ─── Extraction types ───────────────────────────────────────────────────────

export interface SourcedValue<T> {
  value: T;
  unit?: string;
  confidence: number;
  status: InferenceStatus;
  sourceSegmentIds: string[];
}

export interface Measurement {
  value: number;
  unit: string;
  confidence: number;
  status: InferenceStatus;
  sourceSegmentIds: string[];
}

export interface SourcedNote {
  text: string;
  confidence: number;
  status: InferenceStatus;
  sourceSegmentIds: string[];
}

export interface PainObservation {
  bodyPart?: string;
  description: string;
  severity?: "mild" | "moderate" | "severe";
  sourceSegmentIds: string[];
}

// ─── Exercise & Sets ────────────────────────────────────────────────────────

export type SetType = "warmup" | "working" | "drop" | "failure" | "unknown";
export type FormQuality = "good" | "acceptable" | "poor" | "unknown";
export type Side = "left" | "right" | "bilateral";

export interface ExerciseSet {
  setNumber: number;
  setType?: SetType;
  plannedReps?: number;
  completedReps?: number;
  weight?: Measurement;
  duration?: Measurement;
  distance?: Measurement;
  resistance?: string;
  side?: Side;
  restAfterSeconds?: number;
  tempo?: string;
  rpe?: number;
  completed: boolean;
  formQuality?: FormQuality;
  userNotes: SourcedNote[];
  trainerNotes: SourcedNote[];
  confidence: number;
  sourceSegmentIds: string[];
}

export interface ExerciseReferenceMedia {
  datasetId: string;
  imageUrl?: string;
  gifUrl: string;
  attribution: string;
}

export interface ExerciseRecord {
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
  referenceMedia?: ExerciseReferenceMedia;
  confidence: number;
}

// ─── Next session plan ──────────────────────────────────────────────────────

export interface NextSessionExercisePlan {
  exerciseName: string;
  targetSets?: number;
  targetReps?: string;
  targetWeight?: string;
  notes: string[];
  sourceSegmentIds: string[];
}

export interface NextSessionPlan {
  exercises: NextSessionExercisePlan[];
  generalNotes: string[];
  sourceSegmentIds: string[];
}

// ─── Workout Session ────────────────────────────────────────────────────────

export interface WorkoutSession {
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

  processingMode: ProcessingMode;
  localStatus: LocalStatus;
  remoteStatus: RemoteStatus;
  syncStatus: SyncStatus;

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

  audioRetentionPolicy: AudioRetentionPolicy;

  extractionVersion?: string;
  summaryVersion?: string;

  createdAt: string;
  updatedAt: string;
}

// ─── Sync queue ─────────────────────────────────────────────────────────────

export interface SyncJob {
  id: string;
  sessionId: string;
  type: SyncJobType;
  status: SyncJobStatus;
  payloadReference?: string;
  attemptCount: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Quick note ─────────────────────────────────────────────────────────────

export interface QuickNote {
  id: string;
  sessionId: string;
  text: string;
  offsetSeconds?: number;
  createdAt: string;
  synced: boolean;
}

// ─── API types ───────────────────────────────────────────────────────────────

export interface CreditBalance {
  totalCredits: number;
  permanentCredits: number;
  subscriptionCredits: number;
  subscriptionTier: string | null;
  subscriptionPeriodEnd: string | null;
}

export interface CreateSessionRequest {
  id: string;
  workoutType?: string;
  trainerName?: string;
  goals: string[];
  processingMode: ProcessingMode;
  audioRetentionPolicy: AudioRetentionPolicy;
  timezone: string;
  startedAt: string;
}

export interface UploadChunkRequest {
  id: string;
  sessionId: string;
  sequence: number;
  durationSeconds: number;
  sizeBytes: number;
  sha256?: string;
}

export interface UploadChunkResponse {
  uploadUrl: string;
  chunkId: string;
}

export interface ProcessingStatusResponse {
  sessionId: string;
  remoteStatus: RemoteStatus;
  transcriptionProgress?: number;
  extractionComplete: boolean;
  summaryComplete: boolean;
  errorMessage?: string;
}

export interface AssistantQuestionRequest {
  question: string;
  sessionId?: string;
  history?: AssistantConversationMessage[];
}

export interface AssistantConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantQuestionResponse {
  answer: string;
  citations: Array<{
    sessionId: string;
    date: string;
    excerpt: string;
  }>;
}

// ─── Extraction output schema ─────────────────────────────────────────────────

export interface ExtractionOutput {
  sessionId: string;
  extractionVersion: string;
  exercises: ExerciseRecord[];
  sessionNotes: string[];
  techniqueThemes: string[];
  accomplishments: string[];
  improvementAreas: string[];
  painObservations: PainObservation[];
  nextSessionPlan?: NextSessionPlan;
  overallDifficulty?: SourcedValue<number>;
  energyLevel?: SourcedValue<number>;
  openQuestions: string[];
}
