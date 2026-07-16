import { Directory, File, Paths } from "expo-file-system";
import { getAudioSegmentsBySession, markSegmentDeleted } from "../db/audio";
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
