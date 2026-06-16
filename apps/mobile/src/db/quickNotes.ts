import type { QuickNote } from "@trainwell/schemas";
import { getDb } from "./client";
import { now } from "../utils/time";
import { uuid } from "../utils/uuid";

function rowToNote(row: Record<string, unknown>): QuickNote {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    text: row.text as string,
    offsetSeconds: row.offset_seconds as number | undefined,
    createdAt: row.created_at as string,
    synced: Boolean(row.synced),
  };
}

export async function addQuickNote(
  sessionId: string,
  text: string,
  offsetSeconds?: number
): Promise<QuickNote> {
  const db = await getDb();
  const id = uuid();
  const ts = now();

  await db.runAsync(
    `INSERT INTO quick_notes (id, session_id, text, offset_seconds, created_at, synced)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [id, sessionId, text, offsetSeconds ?? null, ts]
  );

  const row = await db.getFirstAsync<Record<string, unknown>>(
    "SELECT * FROM quick_notes WHERE id = ?",
    [id]
  );
  return rowToNote(row!);
}

export async function getNotesBySession(
  sessionId: string
): Promise<QuickNote[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    "SELECT * FROM quick_notes WHERE session_id = ? ORDER BY created_at ASC",
    [sessionId]
  );
  return rows.map(rowToNote);
}

export async function markNoteSynced(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE quick_notes SET synced = 1 WHERE id = ?", [id]);
}
