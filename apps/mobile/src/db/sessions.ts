import type {
  WorkoutSession,
  ProcessingMode,
  AudioRetentionPolicy,
  LocalStatus,
  ExerciseRecord,
} from "@trainwell/schemas";
import { getDb } from "./client";
import { now } from "../utils/time";
import { uuid } from "../utils/uuid";
import { getCurrentUserId, requireCurrentUserId } from "../auth/currentUser";

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
  const userId = requireCurrentUserId();

  await db.runAsync(
    `INSERT INTO sessions
      (id, user_id, started_at, timezone, workout_type, trainer_name, goals,
       processing_mode, audio_retention_policy, local_status,
       remote_status, sync_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'not_created', 'local_only', ?, ?)`,
    [
      id,
      userId,
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
  const userId = getCurrentUserId();
  if (!userId) return null;
  const row = await db.getFirstAsync<Record<string, unknown>>(
    "SELECT * FROM sessions WHERE id = ? AND user_id = ?",
    [id, userId]
  );
  return row ? rowToSession(row) : null;
}

export async function listSessions(limit = 50): Promise<WorkoutSession[]> {
  const db = await getDb();
  const userId = getCurrentUserId();
  if (!userId) return [];
  const rows = await db.getAllAsync<Record<string, unknown>>(
    "SELECT * FROM sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT ?",
    [userId, limit]
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
  const userId = getCurrentUserId();
  if (!userId) return null;
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM sessions
     WHERE user_id = ? AND local_status IN ('recording', 'paused')
     ORDER BY started_at DESC LIMIT 1`,
    [userId]
  );
  return row ? rowToSession(row) : null;
}

export async function getPendingUploadSessions(): Promise<WorkoutSession[]> {
  const db = await getDb();
  const userId = getCurrentUserId();
  if (!userId) return [];
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM sessions
     WHERE user_id = ?
       AND local_status = 'locally_complete'
       AND processing_mode != 'local_only'
     ORDER BY started_at ASC`,
    [userId]
  );
  return rows.map(rowToSession);
}

// Sessions that started syncing but never reached a synchronized state — e.g.
// the app was killed mid-sync while the server finished the job on its own.
// Re-running the sync worker for these pulls down the finished result.
export async function getUnsyncedSessions(): Promise<WorkoutSession[]> {
  const db = await getDb();
  const userId = getCurrentUserId();
  if (!userId) return [];
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM sessions
     WHERE user_id = ?
       AND local_status IN ('syncing', 'locally_complete', 'awaiting_upload')
       AND sync_status != 'synchronized'
       AND processing_mode != 'local_only'
     ORDER BY started_at DESC
     LIMIT 20`,
    [userId]
  );
  return rows.map(rowToSession);
}

export async function saveExerciseEdits(
  sessionId: string,
  exercises: unknown[]
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE sessions SET exercises = ?, updated_at = ?, local_version = local_version + 1 WHERE id = ?`,
    [JSON.stringify(exercises), now(), sessionId]
  );
}

export async function finalizeSession(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE sessions SET local_status = 'syncing', sync_status = 'pending',
       updated_at = ?, local_version = local_version + 1 WHERE id = ?`,
    [now(), sessionId]
  );
}

export async function saveSyncResult(
  sessionId: string,
  remote: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  const ts = now();

  const toJson = (v: unknown): string => {
    if (typeof v === "string") return v;
    return JSON.stringify(v ?? []);
  };

  await db.runAsync(
    `UPDATE sessions SET
      exercises = ?,
      session_notes = ?,
      technique_themes = ?,
      accomplishments = ?,
      improvement_areas = ?,
      pain_observations = ?,
      next_session_plan = ?,
      overall_difficulty = ?,
      energy_level = ?,
      extraction_version = ?,
      markdown_content = ?,
      remote_status = ?,
      remote_version = ?,
      summary_version = ?,
      updated_at = ?,
      local_version = local_version + 1
     WHERE id = ?`,
    [
      toJson(remote.exercises),
      toJson(remote.session_notes),
      toJson(remote.technique_themes),
      toJson(remote.accomplishments),
      toJson(remote.improvement_areas),
      toJson(remote.pain_observations),
      remote.next_session_plan != null ? toJson(remote.next_session_plan) : null,
      (remote.overall_difficulty as number | null) ?? null,
      (remote.energy_level as number | null) ?? null,
      (remote.extraction_version as string | null) ?? null,
      (remote.markdown_content as string | null) ?? null,
      (remote.remote_status as string | null) ?? "review_required",
      (remote.remote_version as number | null) ?? null,
      (remote.summary_version as string | null) ?? null,
      ts,
      sessionId,
    ]
  );
}

export async function upsertSessionsFromServer(
  rows: Record<string, unknown>[]
): Promise<void> {
  const db = await getDb();
  const ts = now();
  const currentUserId = requireCurrentUserId();
  for (const r of rows) {
    const remoteStatus = (r.remote_status as string | undefined) ?? "finalized";
    const isReady = remoteStatus === "review_required" || remoteStatus === "finalized";
    // INSERT OR IGNORE — local in-progress sessions are the source of truth
    await db.runAsync(
      `INSERT OR IGNORE INTO sessions
        (id, user_id, started_at, ended_at, duration_seconds, timezone,
         workout_type, trainer_name, goals, processing_mode,
         audio_retention_policy, local_status, remote_status, sync_status,
         exercises, session_notes, technique_themes, accomplishments,
         improvement_areas, pain_observations, next_session_plan,
         overall_difficulty, energy_level, markdown_content,
         extraction_version, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        r.id,
        r.user_id ?? currentUserId,
        r.started_at,
        r.ended_at ?? null,
        r.duration_seconds ?? null,
        r.timezone ?? "UTC",
        r.workout_type ?? null,
        r.trainer_name ?? null,
        typeof r.goals === "string" ? r.goals : JSON.stringify(r.goals ?? []),
        r.processing_mode ?? "automatic_hybrid",
        r.audio_retention_policy ?? "delete_after_review",
        isReady ? "cached" : (r.local_status ?? "locally_complete"),
        remoteStatus,
        isReady ? "synchronized" : (r.sync_status ?? "pending"),
        typeof r.exercises === "string" ? r.exercises : JSON.stringify(r.exercises ?? []),
        typeof r.session_notes === "string" ? r.session_notes : JSON.stringify(r.session_notes ?? []),
        typeof r.technique_themes === "string" ? r.technique_themes : JSON.stringify(r.technique_themes ?? []),
        typeof r.accomplishments === "string" ? r.accomplishments : JSON.stringify(r.accomplishments ?? []),
        typeof r.improvement_areas === "string" ? r.improvement_areas : JSON.stringify(r.improvement_areas ?? []),
        typeof r.pain_observations === "string" ? r.pain_observations : JSON.stringify(r.pain_observations ?? []),
        r.next_session_plan ? (typeof r.next_session_plan === "string" ? r.next_session_plan : JSON.stringify(r.next_session_plan)) : null,
        r.overall_difficulty ?? null,
        r.energy_level ?? null,
        r.markdown_content ?? null,
        r.extraction_version ?? null,
        r.created_at ?? ts,
        r.updated_at ?? ts,
      ] as (string | number | boolean | null)[]
    );

    await db.runAsync(
      `UPDATE sessions SET
         remote_status = ?,
         remote_version = ?,
         summary_version = COALESCE(?, summary_version)
       WHERE id = ? AND user_id = ?
         AND local_status NOT IN ('recording', 'paused')`,
      [
        remoteStatus,
        (r.remote_version as number | null) ?? null,
        (r.summary_version as string | null) ?? null,
        r.id as string,
        currentUserId,
      ]
    );

    const remoteExercises = parseExerciseRecords(r.exercises);
    if (remoteExercises.some((exercise) => exercise.referenceMedia)) {
      const localRow = await db.getFirstAsync<{ exercises: string | null }>(
        "SELECT exercises FROM sessions WHERE id = ? AND user_id = ?",
        [r.id as string, currentUserId]
      );
      const localExercises = parseExerciseRecords(localRow?.exercises);
      const mergedExercises = mergeExerciseReferenceMedia(localExercises, remoteExercises);
      if (mergedExercises) {
        await db.runAsync(
          `UPDATE sessions SET exercises = ?, updated_at = ?
           WHERE id = ? AND user_id = ?
             AND local_status NOT IN ('recording', 'paused', 'interrupted')`,
          [JSON.stringify(mergedExercises), ts, r.id as string, currentUserId]
        );
      }
    }
  }
}

function parseExerciseRecords(value: unknown): ExerciseRecord[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? (parsed as ExerciseRecord[]) : [];
  } catch {
    return [];
  }
}

function mergeExerciseReferenceMedia(
  localExercises: ExerciseRecord[],
  remoteExercises: ExerciseRecord[]
): ExerciseRecord[] | null {
  if (localExercises.length === 0) return null;

  const mediaById = new Map(
    remoteExercises
      .filter((exercise) => exercise.referenceMedia)
      .map((exercise) => [exercise.id, exercise.referenceMedia] as const)
  );
  let changed = false;
  const merged = localExercises.map((exercise) => {
    const referenceMedia = mediaById.get(exercise.id);
    if (!referenceMedia) return exercise;
    if (JSON.stringify(exercise.referenceMedia) === JSON.stringify(referenceMedia)) {
      return exercise;
    }
    changed = true;
    return { ...exercise, referenceMedia };
  });
  return changed ? merged : null;
}

export async function claimLegacySessions(userId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE sessions SET user_id = ?, updated_at = ? WHERE user_id = 'local'",
    [userId, now()]
  );
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
