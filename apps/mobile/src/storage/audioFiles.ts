import { Directory, File, Paths } from "expo-file-system";
import {
  getAudioSegmentsBySession,
  markSegmentDeleted,
  markSegmentInterrupted,
} from "../db/audio";
import { getDb } from "../db/client";

const sessionsDirectory = new Directory(Paths.document, "sessions");

export async function deleteLocalAudio(sessionId: string): Promise<void> {
  const segments = await getAudioSegmentsBySession(sessionId);
  const failures: string[] = [];

  for (const segment of segments) {
    if (!segment.localPath) continue;
    try {
      const file = new File(segment.localPath);
      if (file.exists) file.delete();
      await markSegmentDeleted(segment.id);
    } catch (error) {
      failures.push(`${segment.localPath}: ${(error as Error).message}`);
    }
  }

  removeEmptyAudioDirectories(sessionId);

  if (failures.length > 0) {
    throw new Error(`Could not delete local audio:\n${failures.join("\n")}`);
  }
}

export async function cleanupOrphanedAudioFiles(): Promise<number> {
  if (!sessionsDirectory.exists) return 0;

  const db = await getDb();
  const rows = await db.getAllAsync<{ local_path: string }>(
    `SELECT local_path FROM audio_segments
     WHERE local_status != 'deleted' AND local_path IS NOT NULL`
  );
  const retainedPaths = new Set(rows.map((row) => row.local_path));
  let deletedCount = 0;

  for (const entry of sessionsDirectory.list()) {
    if (!(entry instanceof Directory)) continue;

    const audioDirectory = new Directory(entry, "audio");
    if (!audioDirectory.exists) continue;

    for (const audioEntry of audioDirectory.list()) {
      if (!(audioEntry instanceof File)) continue;
      if (retainedPaths.has(audioEntry.uri)) continue;
      audioEntry.delete();
      deletedCount++;
    }

    if (audioDirectory.exists && audioDirectory.list().length === 0) {
      audioDirectory.delete();
    }
    if (entry.exists && entry.list().length === 0) {
      entry.delete();
    }
  }

  return deletedCount;
}

export async function recoverInterruptedRecordingFiles(): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    session_id: string;
    segment_id: string | null;
    local_path: string | null;
  }>(
    `SELECT s.id AS session_id, a.id AS segment_id, a.local_path
     FROM sessions s
     LEFT JOIN audio_segments a ON a.session_id = s.id AND a.sequence = 0
     WHERE s.local_status IN ('recording', 'paused')`
  );
  let recoveredCount = 0;

  for (const row of rows) {
    const sessionDirectory = new Directory(sessionsDirectory, row.session_id);
    const audioDirectory = new Directory(sessionDirectory, "audio");
    if (!audioDirectory.exists) audioDirectory.create({ intermediates: true });

    const destination = new File(audioDirectory, "interrupted_recording.m4a");
    const source = row.local_path ? new File(row.local_path) : null;
    let recoveredFile: File | null = destination.exists ? destination : null;

    if (source?.exists && source.uri !== destination.uri) {
      if (destination.exists) {
        const keepSource = (source.size ?? 0) > (destination.size ?? 0);
        if (keepSource) {
          destination.delete();
          source.move(destination);
        } else {
          source.delete();
        }
      } else {
        source.move(destination);
      }
      recoveredFile = destination;
    } else if (source?.exists) {
      recoveredFile = source;
    }

    const interruptedPath = recoveredFile?.uri ?? row.local_path;
    if (row.segment_id && interruptedPath) {
      await markSegmentInterrupted(
        row.segment_id,
        interruptedPath,
        recoveredFile?.size ?? 0
      );
      if (recoveredFile?.exists && (recoveredFile.size ?? 0) > 0) {
        recoveredCount++;
      }
    }

    const ts = new Date().toISOString();
    await db.runAsync(
      `UPDATE sessions
       SET local_status = 'interrupted', ended_at = COALESCE(ended_at, ?),
           sync_status = 'local_only', updated_at = ?,
           local_version = local_version + 1
       WHERE id = ?`,
      [ts, ts, row.session_id]
    );
  }

  return recoveredCount;
}

function removeEmptyAudioDirectories(sessionId: string): void {
  const sessionDirectory = new Directory(sessionsDirectory, sessionId);
  const audioDirectory = new Directory(sessionDirectory, "audio");

  if (audioDirectory.exists && audioDirectory.list().length === 0) {
    audioDirectory.delete();
  }
  if (sessionDirectory.exists && sessionDirectory.list().length === 0) {
    sessionDirectory.delete();
  }
}
