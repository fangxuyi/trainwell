import { randomUUID } from "crypto";
import sql from "./db";

export type ProcessingJobStatus =
  | "pending"
  | "running"
  | "retry_wait"
  | "completed"
  | "failed";

export interface ProcessingJobState {
  id: string;
  sessionId: string;
  status: ProcessingJobStatus;
  stage: string | null;
  message: string | null;
  attemptCount: number;
  availableAt: string | null;
  leaseExpiresAt: string | null;
  error: string | null;
}

let schemaPromise: Promise<void> | null = null;

export function ensureProcessingQueueSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS processing_jobs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          stage TEXT,
          message TEXT,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          lease_owner TEXT,
          lease_expires_at TIMESTAMPTZ,
          error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS stage TEXT`;
      await sql`ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS message TEXT`;
      await sql`
        ALTER TABLE processing_jobs
        ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0
      `;
      await sql`
        ALTER TABLE processing_jobs
        ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT now()
      `;
      await sql`ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS lease_owner TEXT`;
      await sql`ALTER TABLE processing_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`;
      await sql`
        CREATE INDEX IF NOT EXISTS processing_jobs_due_idx
        ON processing_jobs(status, available_at)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS language_model_provider_state (
          provider TEXT PRIMARY KEY,
          lease_owner TEXT,
          lease_expires_at TIMESTAMPTZ,
          blocked_until TIMESTAMPTZ,
          last_rate_limit_error TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function enqueueProcessingJob(sessionId: string): Promise<ProcessingJobState> {
  await ensureProcessingQueueSchema();
  const id = `process:${sessionId}`;
  const rows = await sql`
    INSERT INTO processing_jobs (
      id, session_id, type, status, stage, message, available_at
    ) VALUES (
      ${id}, ${sessionId}, 'transcribe_and_extract', 'pending', 'queued',
      'Your recap is queued for processing.', now()
    )
    ON CONFLICT (id) DO UPDATE SET
      status = CASE
        WHEN processing_jobs.status IN ('completed', 'running') THEN processing_jobs.status
        ELSE 'pending'
      END,
      stage = CASE
        WHEN processing_jobs.status IN ('completed', 'running') THEN processing_jobs.stage
        ELSE 'queued'
      END,
      message = CASE
        WHEN processing_jobs.status IN ('completed', 'running') THEN processing_jobs.message
        ELSE 'Your recap is queued for processing.'
      END,
      available_at = CASE
        WHEN processing_jobs.status = 'retry_wait' THEN processing_jobs.available_at
        ELSE now()
      END,
      error = CASE
        WHEN processing_jobs.status IN ('completed', 'running') THEN processing_jobs.error
        ELSE NULL
      END,
      updated_at = now()
    RETURNING *
  `;
  return mapJob(rows[0]);
}

export async function claimProcessingJob(
  sessionId: string,
  leaseSeconds = 285
): Promise<{ job: ProcessingJobState; leaseOwner: string } | null> {
  await ensureProcessingQueueSchema();
  const leaseOwner = randomUUID();
  const rows = await sql`
    UPDATE processing_jobs
    SET status = 'running',
        stage = 'starting',
        message = 'Starting recap processing.',
        attempt_count = attempt_count + 1,
        lease_owner = ${leaseOwner},
        lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
        error = NULL,
        updated_at = now()
    WHERE session_id = ${sessionId}
      AND type = 'transcribe_and_extract'
      AND available_at <= now()
      AND (
        status IN ('pending', 'retry_wait')
        OR (
          status = 'running'
          AND (lease_expires_at IS NULL OR lease_expires_at <= now())
        )
      )
    RETURNING *
  `;
  if (rows.length === 0) return null;
  return { job: mapJob(rows[0]), leaseOwner };
}

export async function updateProcessingProgress(
  sessionId: string,
  stage: string,
  message: string
): Promise<void> {
  await ensureProcessingQueueSchema();
  await sql`
    UPDATE processing_jobs
    SET stage = ${stage}, message = ${message}, updated_at = now()
    WHERE session_id = ${sessionId}
      AND type = 'transcribe_and_extract'
      AND status = 'running'
  `;
}

export async function completeProcessingJob(
  sessionId: string,
  leaseOwner: string
): Promise<void> {
  await sql`
    UPDATE processing_jobs
    SET status = 'completed', stage = 'completed',
        message = 'Your recap is ready to review.',
        lease_owner = NULL, lease_expires_at = NULL,
        error = NULL, updated_at = now()
    WHERE session_id = ${sessionId}
      AND type = 'transcribe_and_extract'
      AND lease_owner = ${leaseOwner}
  `;
}

export async function deferProcessingJob(
  sessionId: string,
  leaseOwner: string,
  retryAfterMs: number,
  error: string
): Promise<void> {
  const retrySeconds = Math.max(1, Math.ceil(retryAfterMs / 1_000));
  await sql`
    UPDATE processing_jobs
    SET status = 'retry_wait', stage = 'rate_limited',
        message = 'The AI provider is temporarily busy. Your recap will retry automatically.',
        available_at = now() + (${retrySeconds} * interval '1 second'),
        lease_owner = NULL, lease_expires_at = NULL,
        error = ${error.slice(0, 1_000)}, updated_at = now()
    WHERE session_id = ${sessionId}
      AND type = 'transcribe_and_extract'
      AND lease_owner = ${leaseOwner}
  `;
}

export async function failProcessingJob(
  sessionId: string,
  leaseOwner: string,
  error: string
): Promise<void> {
  await sql`
    UPDATE processing_jobs
    SET status = 'failed', stage = 'failed',
        message = 'Recap processing needs attention.',
        lease_owner = NULL, lease_expires_at = NULL,
        error = ${error.slice(0, 1_000)}, updated_at = now()
    WHERE session_id = ${sessionId}
      AND type = 'transcribe_and_extract'
      AND lease_owner = ${leaseOwner}
  `;
}

export async function getProcessingJob(
  sessionId: string
): Promise<ProcessingJobState | null> {
  await ensureProcessingQueueSchema();
  const rows = await sql`
    SELECT * FROM processing_jobs
    WHERE session_id = ${sessionId}
      AND type = 'transcribe_and_extract'
    LIMIT 1
  `;
  return rows.length > 0 ? mapJob(rows[0]) : null;
}

function mapJob(row: Record<string, unknown>): ProcessingJobState {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    status: row.status as ProcessingJobStatus,
    stage: typeof row.stage === "string" ? row.stage : null,
    message: typeof row.message === "string" ? row.message : null,
    attemptCount: Number(row.attempt_count ?? 0),
    availableAt: row.available_at ? new Date(String(row.available_at)).toISOString() : null,
    leaseExpiresAt: row.lease_expires_at
      ? new Date(String(row.lease_expires_at)).toISOString()
      : null,
    error: typeof row.error === "string" ? row.error : null,
  };
}
