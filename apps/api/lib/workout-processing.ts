import sql from "./db";
import {
  LanguageModelQueueTimeoutError,
  LanguageModelRateLimitError,
} from "./language-model";
import { transcribeAndExtract } from "./pipeline";
import {
  claimProcessingJob,
  completeProcessingJob,
  deferProcessingJob,
  failProcessingJob,
} from "./processing-queue";

export class ProcessingDeferredError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super("Workout processing was deferred for an AI provider cooldown.");
    this.name = "ProcessingDeferredError";
  }
}

export async function runQueuedProcessing(sessionId: string): Promise<void> {
  const claimed = await claimProcessingJob(sessionId);
  if (!claimed) return;

  try {
    await transcribeAndExtract(sessionId);
    await completeProcessingJob(sessionId, claimed.leaseOwner);
  } catch (error) {
    if (
      error instanceof LanguageModelRateLimitError ||
      error instanceof LanguageModelQueueTimeoutError
    ) {
      await deferProcessingJob(
        sessionId,
        claimed.leaseOwner,
        error.retryAfterMs,
        error.message
      );
      throw new ProcessingDeferredError(error.retryAfterMs);
    }

    console.error("Pipeline failed for", sessionId, error);
    const message = error instanceof Error ? error.message : String(error);
    await failProcessingJob(sessionId, claimed.leaseOwner, message);
    await sql`
      UPDATE sessions
      SET remote_status = 'failed', updated_at = now()
      WHERE id = ${sessionId}
    `;
  }
}
