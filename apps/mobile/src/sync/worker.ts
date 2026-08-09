import type { ProcessingStatusResponse, SyncJob } from "@trainwell/schemas";
import {
  completeSessionJobsByType,
  enqueueJob,
  getPendingJobsBySession,
  getRunnableJobsBySession,
  getDueJobs,
  hasUncompletedSessionJob,
  markJobRunning,
  markJobCompleted,
  markJobBlocked,
  markJobDeferred,
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
import { serializeSyncIssue, syncIssueFromError } from "./errors";

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 60; // 5 minutes
const activeWorkers = new Map<string, Promise<void>>();
const rerunRequested = new Set<string>();

export function runSyncWorker(sessionId: string): Promise<void> {
  const activeWorker = activeWorkers.get(sessionId);
  if (activeWorker) {
    rerunRequested.add(sessionId);
    return activeWorker;
  }

  const worker = (async () => {
    do {
      rerunRequested.delete(sessionId);
      await runSyncWorkerInternal(sessionId);
    } while (rerunRequested.delete(sessionId));
  })().finally(() => {
    activeWorkers.delete(sessionId);
    rerunRequested.delete(sessionId);
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

  const hasPendingFinalization = await hasUncompletedSessionJob(
    sessionId,
    "finalize_remote_session"
  );
  const unfinishedJobs = await getPendingJobsBySession(sessionId);
  const hasUnfinishedTransfer = unfinishedJobs.some(
    (job) => job.type === "create_remote_session" || job.type === "upload_audio_chunk"
  );
  let jobs = await getRunnableJobsBySession(sessionId);

  // Reconciliation is read-first and safe for terminal local errors. Never
  // replace reviewed local edits while a finalization job still needs to send
  // them to the server.
  if (jobs.length === 0) {
    const reconciled = await reconcileRemoteCompletion(
      sessionId,
      hasPendingFinalization
    ).catch((error) => {
      console.warn("[SyncWorker] remote reconciliation failed", sessionId, error);
      return false;
    });
    if (reconciled || sessionCheck.localStatus !== "syncing") return;

    // An explicit retry can reach this branch for legacy sessions whose old
    // transfer jobs already completed. Give the processing stage a persistent
    // job so any new transient failure receives backoff and survives restart.
    jobs = [await enqueueJob(sessionId, "fetch_processing_result")];
  }

  const finalizationJobs = jobs.filter((job) => job.type === "finalize_remote_session");
  const transferJobs = jobs.filter(
    (job) => job.type === "create_remote_session" || job.type === "upload_audio_chunk"
  );

  if (finalizationJobs.length > 0 && !hasUnfinishedTransfer) {
    await updateSessionStatus(sessionId, {
      localStatus: "syncing",
      syncStatus: "pending",
    });
    try {
      const job = finalizationJobs[0];
      await runJob(job, () => handleFinalizeRemoteSession(job));
      await completeSessionJobsByType(sessionId, "finalize_remote_session");
      const remote = await apiGet<Record<string, unknown>>(
        `/api/workouts/${sessionId}`
      );
      await saveSyncResult(sessionId, remote);
      await updateSessionStatus(sessionId, {
        localStatus: "cached",
        remoteStatus: "finalized",
        syncStatus: "synchronized",
      });
      await cleanupConfirmedAudio(sessionId, "finalized");
    } catch (error) {
      console.error("[SyncWorker] finalization sync failed for session", sessionId, error);
      await updateSessionAfterFailure(sessionId);
    }
    return;
  }

  await updateSessionStatus(sessionId, { localStatus: "syncing", syncStatus: "pending" });

  try {
    // Step 1: create session remotely (must run before uploads)
    const createJob = transferJobs.find((j) => j.type === "create_remote_session");
    if (createJob) {
      await runJob(createJob, () => handleCreateRemoteSession(createJob));
    }

    // Step 2: upload all audio chunks (sequentially, in order)
    const uploadJobs = transferJobs
      .filter((j) => j.type === "upload_audio_chunk")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const job of uploadJobs) {
      await runJob(job, () => handleUploadAudioChunk(job));
    }

    const remainingTransfers = (await getPendingJobsBySession(sessionId)).some(
      (job) => job.type === "create_remote_session" || job.type === "upload_audio_chunk"
    );
    if (remainingTransfers) {
      await updateSessionStatus(sessionId, {
        localStatus: "locally_complete",
        syncStatus: "pending",
      });
      return;
    }

    // Step 3: processing/result retrieval is itself durable. Transfer jobs may
    // already be complete when a status request fails, so this job is what lets
    // foreground recovery resume instead of declaring a permanent local error.
    const processingJob =
      jobs.find((job) => job.type === "fetch_processing_result") ??
      (await enqueueJob(sessionId, "fetch_processing_result"));
    const remoteStatus = await runProcessingJob(processingJob);
    if (remoteStatus === "processing") {
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

    await updateSessionStatus(sessionId, {
      localStatus: "cached",
      syncStatus: "synchronized",
    });
    await cleanupConfirmedAudio(sessionId, remoteStatus);
  } catch (err) {
    console.error("[SyncWorker] failed for session", sessionId, err);
    await updateSessionAfterFailure(sessionId);
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
    const storedError = serializeSyncIssue(syncIssueFromError(err, job.type));
    if (err instanceof ApiError && err.status === 402) {
      await markJobBlocked(job.id, storedError);
      throw err;
    }
    await markJobFailed(job.id, storedError, job.attemptCount + 1);
    throw err;
  }
}

async function runProcessingJob(
  job: SyncJob
): Promise<"processing" | "review_required" | "finalized"> {
  await markJobRunning(job.id);
  try {
    const remoteStatus = await handleProcessing(job.sessionId);
    if (remoteStatus === "processing") {
      await markJobDeferred(
        job.id,
        new Date(Date.now() + 15_000).toISOString()
      );
      return remoteStatus;
    }
    await markJobCompleted(job.id);
    return remoteStatus;
  } catch (error) {
    const storedError = serializeSyncIssue(
      syncIssueFromError(error, "fetch_processing_result")
    );
    if (error instanceof ApiError && error.status === 402) {
      await markJobBlocked(job.id, storedError);
    } else {
      await markJobFailed(job.id, storedError, job.attemptCount + 1);
    }
    throw error;
  }
}

async function handleProcessing(
  sessionId: string
): Promise<"processing" | "review_required" | "finalized"> {
  const initial = await apiGet<ProcessingStatusResponse>(
    `/api/workouts/${sessionId}/processing-status`
  );
  let remoteStatus = initial.remoteStatus;

  if (remoteStatus !== "review_required" && remoteStatus !== "finalized") {
    if (remoteStatus !== "processing") {
      await apiPost<unknown>(`/api/workouts/${sessionId}/process`, {});
      remoteStatus = "processing";
    }

    let attempts = 0;
    while (attempts < MAX_POLL_ATTEMPTS) {
      await sleep(POLL_INTERVAL_MS);
      const status = await apiGet<ProcessingStatusResponse>(
        `/api/workouts/${sessionId}/processing-status`
      );
      remoteStatus = status.remoteStatus;
      if (remoteStatus === "review_required" || remoteStatus === "finalized") break;
      if (remoteStatus === "failed") {
        throw new Error(status.errorMessage ?? "Processing failed on server");
      }
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
    return "processing";
  }
  const remote = await apiGet<Record<string, unknown>>(`/api/workouts/${sessionId}`);
  await saveSyncResult(sessionId, remote);
  return remoteStatus;
}

async function reconcileRemoteCompletion(
  sessionId: string,
  hasPendingFinalization: boolean
): Promise<boolean> {
  const status = await apiGet<ProcessingStatusResponse>(
    `/api/workouts/${sessionId}/processing-status`
  );
  if (
    status.remoteStatus !== "finalized" &&
    (status.remoteStatus !== "review_required" || hasPendingFinalization)
  ) {
    return false;
  }

  const remote = await apiGet<Record<string, unknown>>(`/api/workouts/${sessionId}`);
  await saveSyncResult(sessionId, remote);
  await Promise.all([
    completeSessionJobsByType(sessionId, "create_remote_session"),
    completeSessionJobsByType(sessionId, "upload_audio_chunk"),
    completeSessionJobsByType(sessionId, "fetch_processing_result"),
    ...(status.remoteStatus === "finalized"
      ? [completeSessionJobsByType(sessionId, "finalize_remote_session")]
      : []),
  ]);
  await updateSessionStatus(sessionId, {
    localStatus: "cached",
    remoteStatus: status.remoteStatus,
    syncStatus: "synchronized",
  });
  await cleanupConfirmedAudio(sessionId, status.remoteStatus);
  return true;
}

async function updateSessionAfterFailure(sessionId: string): Promise<void> {
  const unfinished = await getPendingJobsBySession(sessionId);
  const blocked = unfinished.some((job) => job.status === "blocked");
  const retryable = unfinished.some(
    (job) => job.status === "pending" || job.status === "running" || job.status === "retry_wait"
  );
  await updateSessionStatus(sessionId, {
    localStatus: blocked || !retryable ? "local_error" : "locally_complete",
    syncStatus: blocked || !retryable ? "failed" : "pending",
  });
}

async function cleanupConfirmedAudio(
  sessionId: string,
  remoteStatus: "review_required" | "finalized"
): Promise<void> {
  const session = await getSessionById(sessionId);
  const shouldDelete =
    session?.audioRetentionPolicy === "delete_after_transcription" ||
    (remoteStatus === "finalized" && session?.audioRetentionPolicy === "delete_after_review");
  if (!shouldDelete) return;
  await deleteLocalAudio(sessionId).catch((error) =>
    console.warn("[SyncWorker] confirmed sync but local audio cleanup failed", sessionId, error)
  );
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
