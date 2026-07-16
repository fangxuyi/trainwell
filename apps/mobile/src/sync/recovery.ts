import {
  ensureJob,
  recoverInterruptedJobs,
  resetSessionJobsForRetry,
} from "../db/syncJobs";
import {
  cleanupOrphanedAudioFiles,
  recoverInterruptedRecordingFiles,
} from "../storage/audioFiles";
import {
  getAudioSegmentsBySession,
  markInterruptedSegmentStored,
} from "../db/audio";
import { getSessionById, updateSessionStatus } from "../db/sessions";
import { File } from "expo-file-system";
import { now } from "../utils/time";
import {
  reconcileUnsyncedSessions,
  retryStalledSessions,
  runSyncWorker,
} from "./worker";

let preparation: Promise<void> | null = null;
let recovery: Promise<void> | null = null;

export function prepareLocalRecovery(): Promise<void> {
  if (!preparation) {
    preparation = (async () => {
      await recoverInterruptedJobs();
      const recoveredRecordings = await recoverInterruptedRecordingFiles();
      if (recoveredRecordings > 0) {
        console.info(
          `[SyncRecovery] Preserved ${recoveredRecordings} interrupted recording(s)`
        );
      }
      const deletedCount = await cleanupOrphanedAudioFiles();
      if (deletedCount > 0) {
        console.info(`[SyncRecovery] Deleted ${deletedCount} orphaned audio file(s)`);
      }
    })().catch((error) => {
      preparation = null;
      throw error;
    });
  }
  return preparation;
}

export function runSyncRecovery(): Promise<void> {
  if (recovery) return recovery;

  recovery = (async () => {
    await prepareLocalRecovery();
    await retryStalledSessions();
    await reconcileUnsyncedSessions();
  })().finally(() => {
    recovery = null;
  });
  return recovery;
}

export async function retrySessionSync(sessionId: string): Promise<void> {
  await resetSessionJobsForRetry(sessionId);
  await runSyncWorker(sessionId);
}

export async function processInterruptedRecording(sessionId: string): Promise<void> {
  const session = await getSessionById(sessionId);
  if (!session || session.localStatus !== "interrupted") {
    throw new Error("This session is not an interrupted recording.");
  }

  const segments = await getAudioSegmentsBySession(sessionId);
  const segment = segments.find((candidate) => candidate.localStatus === "interrupted");
  if (!segment) throw new Error("No interrupted recording metadata was found.");

  const file = new File(segment.localPath);
  if (!file.exists || (file.size ?? 0) === 0) {
    throw new Error("No recoverable recording file was found on this phone.");
  }

  await ensureJob(sessionId, "create_remote_session");
  await ensureJob(sessionId, "upload_audio_chunk", segment.id);
  await resetSessionJobsForRetry(sessionId);
  await markInterruptedSegmentStored(segment.id, file.size ?? 0);
  await updateSessionStatus(sessionId, {
    localStatus: "locally_complete",
    remoteStatus: "not_created",
    syncStatus: "pending",
    endedAt: session.endedAt ?? now(),
  });
  await runSyncWorker(sessionId);
}
