import { handleCallback } from "@vercel/queue";
import {
  ProcessingDeferredError,
  runQueuedProcessing,
} from "@/lib/workout-processing";

export const maxDuration = 300;

interface WorkoutProcessingMessage {
  sessionId: string;
}

export const POST = handleCallback<WorkoutProcessingMessage>(
  async (message) => {
    if (!message || typeof message.sessionId !== "string" || !message.sessionId.trim()) {
      throw new Error("Queue message is missing sessionId");
    }
    await runQueuedProcessing(message.sessionId);
  },
  {
    visibilityTimeoutSeconds: 300,
    retry: (error, metadata) => {
      if (error instanceof ProcessingDeferredError) {
        return { afterSeconds: Math.max(1, Math.ceil(error.retryAfterMs / 1_000)) };
      }
      if (metadata.deliveryCount >= 20) return { acknowledge: true };
      return { afterSeconds: Math.min(300, 5 * 2 ** Math.min(metadata.deliveryCount, 6)) };
    },
  }
);
