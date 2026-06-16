import type {
  WorkoutSession,
  ProcessingMode,
  AudioRetentionPolicy,
  LocalStatus,
} from "@trainwell/schemas";
import { getDb } from "./client";
import { now } from "../utils/time";
import { uuid } from "../utils/uuid";

function rowToSession(row: Record<string, unknown>): WorkoutSession {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    startedAt: row.started_at as string,
    endedAt: row.ended_at as string | undefined,
    timezone: row.timezone as string,
    durationSeconds: row.duration_seconds as number | undefined,
    workoutType: row.workout_type as string | undefined,
    trainerName: row.trainer_name as string | undefined,
    location: row.location as string | undefined,
    goals: JSON.parse((row.goals as string) || "[]"),
    tags: JSON.parse((row.tags as string) || "[]"),
    processingMode: row.processing_mode as ProcessingMode,
    localStatus: row.local_status as LocalStatus,
    remoteStatus: row.remote_status as WorkoutSession["remoteStatus"],
    syncStatus: row.sync_status as WorkoutSession["syncStatus"],
    localVersion: row.local_version as number,
    remoteVersion: row.remote_version as number | undefined,
    lastSyncedVersion: row.last_synced_version as number | undefined,
    audioSegments: [],
    transcriptSegments: [],
    exercises: JSON.parse((row.exercises as string) || "[]"),
    sessionNotes: JSON.parse((row.session_notes as string) || "[]"),
    techniqueThemes: JSON.parse((row.technique_themes as string) || "[]"),
    accomplishments: JSON.parse((row.accomplishments as string) || "[]"),
    improvementAreas: JSON.parse((row.improvement_areas as string) || "[]"),
    painObservations: JSON.parse((row.pain_observations as string) || "[]"),
    nextSessionPlan: row.next_session_plan
      ? JSON.parse(row.next_session_plan as string)
      : undefined,
    overallDifficulty: row.overall_difficulty as number | undefined,
    energyLevel: row.energy_level as number | undefined,
    markdownContent: row.markdown_content as string | undefined,
    localMarkdownPath: row.local_markdown_path as string | undefined,
    remoteMarkdownPath: row.remote_markdown_path as string | undefined,
    audioRetentionPolicy: row.audio_retention_policy as AudioRetentionPolicy,
    extractionVersion: row.extraction_version as string | undefined,
    summaryVersion: row.summary_version as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export interface CreateSessionParams {
  workoutType?: string;
  trainerName?: string;
  goals?: string[];
  processingMode?: ProcessingMode;
  audioRetentionPolicy?: AudioRetentionPolicy;
}

export async function createSession(
  params: CreateSessionParams = {}
): Promise<WorkoutSession> {
  const db = await getDb();
  const id = uuid();
  const ts = now();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  await db.runAsync(
    `INSERT INTO sessions
      (id, started_at, timezone, workout_type, trainer_name, goals,
       processing_mode, audio_retention_policy, local_status,
       remote_status, sync_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'not_created', 'local_only', ?, ?)`,
    [
      id,
      ts,
      timezone,
      params.workoutType ?? null,
      params.trainerName ?? null,
      JSON.stringify(params.goals ?? []),
      params.processingMode ?? "automatic_hybrid",
      params.audioRetentionPolicy ?? "delete_after_review",
      ts,
      ts,
    ]
  );

  return getSessionById(id) as Promise<WorkoutSession>;
}

export async function getSessionById(
  id: string
): Promise<WorkoutSession | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    "SELECT * FROM sessions WHERE id = ?",
    [id]
  );
  return row ? rowToSession(row) : null;
}

export async function listSessions(limit = 50): Promise<WorkoutSession[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    "SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?",
    [limit]
  );
  return rows.map(rowToSession);
}

export async function updateSessionStatus(
  id: string,
  updates: Partial<
    Pick<
      WorkoutSession,
      | "localStatus"
      | "remoteStatus"
      | "syncStatus"
      | "endedAt"
      | "durationSeconds"
    >
  >
): Promise<void> {
  const db = await getDb();
  const ts = now();
  const fields: string[] = ["updated_at = ?", "local_version = local_version + 1"];
  const values: (string | number | null)[] = [ts];

  if (updates.localStatus !== undefined) {
    fields.push("local_status = ?");
    values.push(updates.localStatus);
  }
  if (updates.remoteStatus !== undefined) {
    fields.push("remote_status = ?");
    values.push(updates.remoteStatus);
  }
  if (updates.syncStatus !== undefined) {
    fields.push("sync_status = ?");
    values.push(updates.syncStatus);
  }
  if (updates.endedAt !== undefined) {
    fields.push("ended_at = ?");
    values.push(updates.endedAt);
  }
  if (updates.durationSeconds !== undefined) {
    fields.push("duration_seconds = ?");
    values.push(updates.durationSeconds);
  }

  values.push(id);
  await db.runAsync(
    `UPDATE sessions SET ${fields.join(", ")} WHERE id = ?`,
    values
  );
}

export async function saveExtractionResult(
  sessionId: string,
  extraction: {
    exercises: unknown[];
    sessionNotes: string[];
    techniqueThemes: string[];
    accomplishments: string[];
    improvementAreas: string[];
    painObservations: unknown[];
    nextSessionPlan?: unknown;
    overallDifficulty?: number;
    energyLevel?: number;
    extractionVersion: string;
  }
): Promise<void> {
  const db = await getDb();
  const ts = now();
  await db.runAsync(
    `UPDATE sessions SET
      exercises = ?, session_notes = ?, technique_themes = ?,
      accomplishments = ?, improvement_areas = ?, pain_observations = ?,
      next_session_plan = ?, overall_difficulty = ?, energy_level = ?,
      extraction_version = ?, local_status = 'cached',
      remote_status = 'review_required', updated_at = ?,
      local_version = local_version + 1
     WHERE id = ?`,
    [
      JSON.stringify(extraction.exercises),
      JSON.stringify(extraction.sessionNotes),
      JSON.stringify(extraction.techniqueThemes),
      JSON.stringify(extraction.accomplishments),
      JSON.stringify(extraction.improvementAreas),
      JSON.stringify(extraction.painObservations),
      extraction.nextSessionPlan
        ? JSON.stringify(extraction.nextSessionPlan)
        : null,
      extraction.overallDifficulty ?? null,
      extraction.energyLevel ?? null,
      extraction.extractionVersion,
      ts,
      sessionId,
    ]
  );
}

export async function saveMarkdown(
  sessionId: string,
  content: string,
  localPath: string
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE sessions SET markdown_content = ?, local_markdown_path = ?,
      updated_at = ?, local_version = local_version + 1
     WHERE id = ?`,
    [content, localPath, now(), sessionId]
  );
}

export async function getIncompleteSession(): Promise<WorkoutSession | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM sessions
     WHERE local_status IN ('recording', 'paused')
     ORDER BY started_at DESC LIMIT 1`
  );
  return row ? rowToSession(row) : null;
}

export async function getPendingUploadSessions(): Promise<WorkoutSession[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM sessions
     WHERE local_status = 'locally_complete'
       AND processing_mode != 'local_only'
     ORDER BY started_at ASC`
  );
  return rows.map(rowToSession);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM sessions WHERE id = ?", [id]);
}

// Track local session that was started (transitions draft → recording)
export async function beginRecording(
  id: string,
  startedAt: string
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE sessions
     SET local_status = 'recording', started_at = ?,
         updated_at = ?, local_version = local_version + 1
     WHERE id = ?`,
    [startedAt, now(), id]
  );
}
