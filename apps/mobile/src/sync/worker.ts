import type { ProcessingStatusResponse, SyncJob } from "@trainwell/schemas";
import {
  getPendingJobsBySession,
  getDueJobs,
  markJobRunning,
  markJobCompleted,
  markJobBlocked,
  markJobFailed,
} from "../db/syncJobs";
import {
  getAudioSegmentById,
  markSegmentUploaded,
} from "../db/audio";
import { ApiError, apiPost, apiGet, uploadAudioChunk } from "../utils/api";
import {
  getSessionById,
  updateSessionStatus,
  saveSyncResult,
  getUnsyncedSessions,
} from "../db/sessions";
import { deleteLocalAudio } from "../storage/audioFiles";

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 60; // 5 minutes
const activeWorkers = new Map<string, Promise<void>>();

export function runSyncWorker(sessionId: string): Promise<void> {
  const activeWorker = activeWorkers.get(sessionId);
  if (activeWorker) {
    return activeWorker.then(
      () => runSyncWorker(sessionId),
      () => runSyncWorker(sessionId)
    );
  }

  const worker = runSyncWorkerInternal(sessionId).finally(() => {
    activeWorkers.delete(sessionId);
  });
  activeWorkers.set(sessionId, worker);
  return worker;
}

async function runSyncWorkerInternal(sessionId: string): Promise<void> {
  // Skip sessions that haven't been stopped yet — create_remote_session hasn't
  // been enqueued and the server session doesn't exist, so chunk uploads would
  // fail with a FK violation.
  const sessionCheck = await getSessionById(sessionId);
  if (!sessionCheck) return;
  if (
    sessionCheck.localStatus === "draft" ||
    sessionCheck.localStatus === "recording" ||
    sessionCheck.localStatus === "paused" ||
    sessionCheck.localStatus === "interrupted"
  ) {
    return;
  }

  const jobs = await getPendingJobsBySession(sessionId);
  const finalizationJobs = jobs.filter((job) => job.type === "finalize_remote_session");
  const processingJobs = jobs.filter(
    (job) => job.type === "create_remote_session" || job.type === "upload_audio_chunk"
  );

  if (finalizationJobs.length > 0 && processingJobs.length === 0) {
    await updateSessionStatus(sessionId, {
      localStatus: "syncing",
      syncStatus: "pending",
    });
    try {
      for (const job of finalizationJobs) {
        await runJob(job, () => handleFinalizeRemoteSession(job));
      }
      const remote = await apiGet<Record<string, unknown>>(
        `/api/workouts/${sessionId}`
      );
      await saveSyncResult(sessionId, remote);
      await updateSessionStatus(sessionId, {
        localStatus: "cached",
        remoteStatus: "finalized",
        syncStatus: "synchronized",
      });
    } catch (error) {
      console.error("[SyncWorker] finalization sync failed for session", sessionId, error);
      const retryable = await getPendingJobsBySession(sessionId);
      await updateSessionStatus(sessionId, {
        localStatus: retryable.length > 0 ? "locally_complete" : "local_error",
        syncStatus: "failed",
      });
    }
    return;
  }

  await updateSessionStatus(sessionId, { localStatus: "syncing", syncStatus: "pending" });

  try {
    // Step 1: create session remotely (must run before uploads)
    const createJob = jobs.find((j) => j.type === "create_remote_session");
    if (createJob) {
      await runJob(createJob, () => handleCreateRemoteSession(createJob));
    }

    // Step 2: upload all audio chunks (sequentially, in order)
    const uploadJobs = jobs
      .filter((j) => j.type === "upload_audio_chunk")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const job of uploadJobs) {
      await runJob(job, () => handleUploadAudioChunk(job));
    }

    // Step 3: trigger extraction — but first check whether the server already
    // finished. When the app is killed mid-sync, the server-side pipeline still
    // completes; on the next run we must NOT re-trigger it (wasteful re-run of
    // Claude extraction), just pick up the finished result.
    const initial = await apiGet<ProcessingStatusResponse>(
      `/api/workouts/${sessionId}/processing-status`
    );
    let remoteStatus = initial.remoteStatus;

    if (remoteStatus !== "review_required" && remoteStatus !== "finalized") {
      // Only trigger processing if it hasn't already started. If the server is
      // already 'processing' (a prior run kicked it off), just poll — re-POSTing
      // would start a duplicate pipeline run.
      if (remoteStatus !== "processing") {
        await apiPost<unknown>(`/api/workouts/${sessionId}/process`, {});
      }

      // Step 4: poll for completion
      let attempts = 0;
      while (attempts < MAX_POLL_ATTEMPTS) {
        await sleep(POLL_INTERVAL_MS);
        const status = await apiGet<ProcessingStatusResponse>(
          `/api/workouts/${sessionId}/processing-status`
        );
        remoteStatus = status.remoteStatus;
        if (remoteStatus === "review_required" || remoteStatus === "finalized") break;
        if (remoteStatus === "failed") throw new Error("Processing failed on server");
        const retryIsDue = !status.retryAt || new Date(status.retryAt).getTime() <= Date.now();
        const shouldKickQueue =
          status.queueStatus === "pending" ||
          (status.queueStatus === "retry_wait" && retryIsDue) ||
          status.queueStatus == null ||
          attempts % 12 === 11;
        if (remoteStatus === "processing" && shouldKickQueue) {
          await apiPost<unknown>(`/api/workouts/${sessionId}/process`, {}).catch((error) =>
            console.warn("[SyncWorker] processing queue kick failed", error)
          );
        }
        attempts++;
      }
    }

    if (remoteStatus !== "review_required" && remoteStatus !== "finalized") {
      await updateSessionStatus(sessionId, {
        localStatus: "locally_complete",
        remoteStatus: "processing",
        syncStatus: "pending",
      });
      console.info(
        `[SyncWorker] server processing continues for ${sessionId}; foreground recovery will reconcile it`
      );
      return;
    }

    // Step 5: fetch result and save locally
    const remote = await apiGet<Record<string, unknown>>(
      `/api/workouts/${sessionId}`
    );
    await saveSyncResult(sessionId, remote);

    await updateSessionStatus(sessionId, {
      localStatus: "cached",
      syncStatus: "synchronized",
    });

    // Delete local audio files if policy calls for it after transcription
    const finalSession = await getSessionById(sessionId);
    if (finalSession?.audioRetentionPolicy === "delete_after_transcription") {
      await deleteLocalAudio(sessionId);
    }
  } catch (err) {
    console.error("[SyncWorker] failed for session", sessionId, err);
    // Check whether there are still retry-able jobs in the queue.
    // If so, the session is locally complete but waiting for the next
    // attempt — don't mark it as a permanent error.
    const retryable = await getPendingJobsBySession(sessionId);
    const blocked = retryable.some((job) => job.status === "blocked");
    await updateSessionStatus(sessionId, {
      localStatus: blocked || retryable.length === 0 ? "local_error" : "locally_complete",
      syncStatus: "failed",
    });
  }
}

// Re-run the sync worker for any session that has jobs due for retry.
// Call this when the app comes to the foreground — internet may be back.
export async function retryStalledSessions(): Promise<void> {
  const due = await getDueJobs();
  const sessionIds = [...new Set(due.map((j) => j.sessionId))];
  for (const sessionId of sessionIds) {
    try {
      await runSyncWorker(sessionId);
    } catch (error) {
      console.error("[SyncRecovery] Retry failed for session", sessionId, error);
    }
  }
}

// Reconcile sessions that started syncing but never finished locally — the
// server may have completed the pipeline while the app was backgrounded or
// killed. Re-running the sync worker checks the server status and pulls down
// the finished result (it no longer re-triggers processing if already done).
// Call this on app foreground. Covers cases retryStalledSessions misses,
// because those sessions have no pending jobs left to be "due".
export async function reconcileUnsyncedSessions(): Promise<void> {
  const sessions = await getUnsyncedSessions();
  for (const session of sessions) {
    try {
      await runSyncWorker(session.id);
    } catch (error) {
      console.error("[SyncRecovery] Reconciliation failed for session", session.id, error);
    }
  }
}

async function runJob(job: SyncJob, handler: () => Promise<void>): Promise<void> {
  await markJobRunning(job.id);
  try {
    await handler();
    await markJobCompleted(job.id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 402) {
      await markJobBlocked(job.id, err.message);
      throw err;
    }
    await markJobFailed(job.id, (err as Error).message, job.attemptCount + 1);
    throw err;
  }
}

async function handleCreateRemoteSession(job: SyncJob): Promise<void> {
  const session = await getSessionById(job.sessionId);
  if (!session) throw new Error(`Session ${job.sessionId} not found`);

  await apiPost<unknown>("/api/workouts", {
    id: session.id,
    workoutType: session.workoutType,
    trainerName: session.trainerName,
    goals: session.goals,
    processingMode: session.processingMode,
    audioRetentionPolicy: session.audioRetentionPolicy,
    timezone: session.timezone,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationSeconds: session.durationSeconds,
  });
}

async function handleUploadAudioChunk(job: SyncJob): Promise<void> {
  if (!job.payloadReference) throw new Error("Missing audio segment ID");

  const segment = await getAudioSegmentById(job.payloadReference);
  if (!segment) throw new Error(`Audio segment not found: ${job.payloadReference}`);

  const blobUrl = await uploadAudioChunk(
    job.sessionId,
    segment.id,
    segment.sequence,
    segment.localPath,
    segment.durationSeconds,
    segment.sizeBytes
  );

  await markSegmentUploaded(segment.id, blobUrl ?? "");
}

async function handleFinalizeRemoteSession(job: SyncJob): Promise<void> {
  const session = await getSessionById(job.sessionId);
  if (!session) throw new Error(`Session ${job.sessionId} not found`);

  await apiPost<unknown>(`/api/workouts/${job.sessionId}/finalize`, {
    exercises: session.exercises,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
