import type { SyncJob, SyncJobType, SyncJobStatus } from "@trainwell/schemas";
import { getDb } from "./client";
import { now } from "../utils/time";
import { uuid } from "../utils/uuid";
import { getCurrentUserId } from "../auth/currentUser";

const BACKOFF_DELAYS_MS = [5000, 15000, 60000, 300000, 900000];

function rowToJob(row: Record<string, unknown>): SyncJob {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    type: row.type as SyncJobType,
    status: row.status as SyncJobStatus,
    payloadReference: row.payload_reference as string | undefined,
    attemptCount: row.attempt_count as number,
    lastAttemptAt: row.last_attempt_at as string | undefined,
    nextAttemptAt: row.next_attempt_at as string | undefined,
    lastError: row.last_error as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function enqueueJob(
  sessionId: string,
  type: SyncJobType,
  payloadReference?: string
): Promise<SyncJob> {
  const db = await getDb();
  const id = uuid();
  const ts = now();

  await db.runAsync(
    `INSERT INTO sync_jobs
      (id, session_id, type, status, payload_reference,
       attempt_count, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, 0, ?, ?, ?)`,
    [id, sessionId, type, payloadReference ?? null, ts, ts, ts]
  );

  return getJobById(id) as Promise<SyncJob>;
}

export async function getJobById(id: string): Promise<SyncJob | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    "SELECT * FROM sync_jobs WHERE id = ?",
    [id]
  );
  return row ? rowToJob(row) : null;
}

export async function getDueJobs(limit = 10): Promise<SyncJob[]> {
  const db = await getDb();
  const userId = getCurrentUserId();
  if (!userId) return [];
  const ts = now();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT j.* FROM sync_jobs j
     JOIN sessions s ON s.id = j.session_id
     WHERE s.user_id = ?
       AND j.status IN ('pending', 'retry_wait')
       AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= ?)
     ORDER BY j.created_at ASC
     LIMIT ?`,
    [userId, ts, limit]
  );
  return rows.map(rowToJob);
}

export async function markJobRunning(id: string): Promise<void> {
  const db = await getDb();
  const ts = now();
  await db.runAsync(
    `UPDATE sync_jobs
     SET status = 'running', last_attempt_at = ?,
         attempt_count = attempt_count + 1, updated_at = ?
     WHERE id = ?`,
    [ts, ts, id]
  );
}

export async function markJobCompleted(id: string): Promise<void> {
  const db = await getDb();
  const ts = now();
  await db.runAsync(
    `UPDATE sync_jobs SET status = 'completed', updated_at = ? WHERE id = ?`,
    [ts, id]
  );
}

export async function markJobBlocked(id: string, error: string): Promise<void> {
  const db = await getDb();
  const ts = now();
  await db.runAsync(
    `UPDATE sync_jobs
     SET status = 'blocked', last_error = ?, next_attempt_at = NULL, updated_at = ?
     WHERE id = ?`,
    [error, ts, id]
  );
}

export async function markJobFailed(
  id: string,
  error: string,
  attemptCount: number
): Promise<void> {
  const db = await getDb();
  const ts = now();
  const delayMs =
    BACKOFF_DELAYS_MS[Math.min(attemptCount, BACKOFF_DELAYS_MS.length - 1)];
  const isPermanent = attemptCount >= BACKOFF_DELAYS_MS.length;
  const nextAttempt = isPermanent
    ? null
    : new Date(Date.now() + delayMs).toISOString();

  await db.runAsync(
    `UPDATE sync_jobs
     SET status = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
     WHERE id = ?`,
    [isPermanent ? "failed_permanently" : "retry_wait", error, nextAttempt, ts, id]
  );
}

export async function getPendingJobsBySession(
  sessionId: string
): Promise<SyncJob[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM sync_jobs
     WHERE session_id = ? AND status NOT IN ('completed', 'failed_permanently')
     ORDER BY created_at ASC`,
    [sessionId]
  );
  return rows.map(rowToJob);
}

export async function recoverInterruptedJobs(): Promise<void> {
  const db = await getDb();
  const ts = now();
  await db.runAsync(
    `UPDATE sync_jobs
     SET status = 'retry_wait', next_attempt_at = ?,
         last_error = 'App closed during sync', updated_at = ?
     WHERE status = 'running'`,
    [ts, ts]
  );
}

export async function resetSessionJobsForRetry(sessionId: string): Promise<void> {
  const db = await getDb();
  const ts = now();
  await db.runAsync(
    `UPDATE sync_jobs
     SET status = 'pending', attempt_count = 0, next_attempt_at = ?,
         last_error = NULL, updated_at = ?
     WHERE session_id = ?
       AND status IN ('blocked', 'failed_permanently', 'retry_wait', 'running')`,
    [ts, ts, sessionId]
  );
}

export async function deleteCompletedJobs(
  olderThanDays = 7
): Promise<void> {
  const db = await getDb();
  const cutoff = new Date(
    Date.now() - olderThanDays * 24 * 60 * 60 * 1000
  ).toISOString();
  await db.runAsync(
    `DELETE FROM sync_jobs WHERE status = 'completed' AND updated_at < ?`,
    [cutoff]
  );
}
