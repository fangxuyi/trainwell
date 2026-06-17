import type { AudioSegment } from "@trainwell/schemas";
import { getDb } from "./client";
import { now } from "../utils/time";
import { uuid } from "../utils/uuid";

function rowToSegment(row: Record<string, unknown>): AudioSegment {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    sequence: row.sequence as number,
    localPath: row.local_path as string,
    durationSeconds: row.duration_seconds as number,
    sizeBytes: row.size_bytes as number,
    sha256: row.sha256 as string | undefined,
    localStatus: row.local_status as AudioSegment["localStatus"],
    remoteStatus: row.remote_status as AudioSegment["remoteStatus"],
    remoteUrl: row.remote_url as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function createAudioSegment(params: {
  sessionId: string;
  sequence: number;
  localPath: string;
}): Promise<AudioSegment> {
  const db = await getDb();
  const id = uuid();
  const ts = now();

  await db.runAsync(
    `INSERT INTO audio_segments
      (id, session_id, sequence, local_path, local_status, remote_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'recording', 'pending', ?, ?)`,
    [id, params.sessionId, params.sequence, params.localPath, ts, ts]
  );

  return getAudioSegmentById(id) as Promise<AudioSegment>;
}

export async function finalizeAudioSegment(
  id: string,
  params: {
    durationSeconds: number;
    sizeBytes: number;
    sha256?: string;
  }
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE audio_segments
     SET local_status = 'stored', duration_seconds = ?,
         size_bytes = ?, sha256 = ?, updated_at = ?
     WHERE id = ?`,
    [params.durationSeconds, params.sizeBytes, params.sha256 ?? null, now(), id]
  );
}

export async function markSegmentUploaded(
  id: string,
  remoteUrl: string
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE audio_segments
     SET remote_status = 'uploaded', remote_url = ?, updated_at = ?
     WHERE id = ?`,
    [remoteUrl, now(), id]
  );
}

export async function markSegmentDeleted(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE audio_segments
     SET local_status = 'deleted', updated_at = ?
     WHERE id = ?`,
    [now(), id]
  );
}

export async function getAudioSegmentById(
  id: string
): Promise<AudioSegment | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    "SELECT * FROM audio_segments WHERE id = ?",
    [id]
  );
  return row ? rowToSegment(row) : null;
}

export async function getAudioSegmentsBySession(
  sessionId: string
): Promise<AudioSegment[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    "SELECT * FROM audio_segments WHERE session_id = ? ORDER BY sequence ASC",
    [sessionId]
  );
  return rows.map(rowToSegment);
}

export async function getNextSequenceNumber(
  sessionId: string
): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ max_seq: number | null }>(
    "SELECT MAX(sequence) as max_seq FROM audio_segments WHERE session_id = ?",
    [sessionId]
  );
  return (row?.max_seq ?? -1) + 1;
}

export async function getPendingUploadSegments(
  sessionId: string
): Promise<AudioSegment[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM audio_segments
     WHERE session_id = ? AND local_status = 'stored'
       AND remote_status = 'pending'
     ORDER BY sequence ASC`,
    [sessionId]
  );
  return rows.map(rowToSegment);
}
