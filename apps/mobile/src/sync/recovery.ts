import {
  recoverInterruptedJobs,
  resetSessionJobsForRetry,
} from "../db/syncJobs";
import { cleanupOrphanedAudioFiles } from "../storage/audioFiles";
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
