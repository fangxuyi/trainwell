import type { SyncJobType } from "@trainwell/schemas";
import { ApiError } from "../utils/api";

export type SessionSyncIssueCode =
  | "insufficient_credits"
  | "authentication"
  | "network"
  | "upload"
  | "processing"
  | "finalization"
  | "server"
  | "unknown";

export interface SessionSyncIssue {
  code: SessionSyncIssueCode;
  message: string;
  retryable: boolean;
  requiredCredits?: number;
  creditBalance?: number;
}

interface StoredSyncIssue extends SessionSyncIssue {
  version: 1;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function apiMessage(error: ApiError): string | null {
  const body = recordValue(error.body);
  const value = body?.message ?? body?.error;
  return typeof value === "string" && value !== "insufficient_credits" ? value : null;
}

export function syncIssueFromError(error: unknown, type: SyncJobType): SessionSyncIssue {
  if (error instanceof ApiError && error.status === 402) {
    const body = recordValue(error.body);
    const balance = recordValue(body?.balance);
    return {
      code: "insufficient_credits",
      message: "Your credit balance is too low to process this recording.",
      retryable: false,
      requiredCredits:
        typeof body?.requiredCredits === "number" ? body.requiredCredits : undefined,
      creditBalance:
        typeof balance?.totalCredits === "number" ? balance.totalCredits : undefined,
    };
  }

  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return {
      code: "authentication",
      message: "Your sign-in session could not authorize this sync.",
      retryable: true,
    };
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  const normalized = rawMessage.toLowerCase();
  if (
    (error instanceof Error && error.name === "AbortError") ||
    normalized.includes("network request failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("network connection")
  ) {
    return {
      code: "network",
      message: "The network connection was interrupted. Motion Memo will retry automatically.",
      retryable: true,
    };
  }

  if (type === "upload_audio_chunk" || normalized.includes("blob upload")) {
    return {
      code: "upload",
      message: "The recording upload did not finish. The audio remains on this phone.",
      retryable: true,
    };
  }

  if (type === "finalize_remote_session") {
    return {
      code: "finalization",
      message:
        error instanceof ApiError
          ? apiMessage(error) ?? "Your review could not be finalized on the server."
          : "Your review could not be finalized on the server.",
      retryable: true,
    };
  }

  if (type === "request_processing" || type === "fetch_processing_result") {
    return {
      code: "processing",
      message:
        error instanceof ApiError
          ? apiMessage(error) ?? "The recap could not finish processing."
          : "The recap could not finish processing.",
      retryable: true,
    };
  }

  if (error instanceof ApiError && error.status >= 500) {
    return {
      code: "server",
      message: apiMessage(error) ?? "The server could not complete the sync.",
      retryable: true,
    };
  }

  return {
    code: "unknown",
    message: rawMessage || "The session could not be synchronized.",
    retryable: true,
  };
}

export function serializeSyncIssue(issue: SessionSyncIssue): string {
  return JSON.stringify({ version: 1, ...issue } satisfies StoredSyncIssue);
}

export function parseSyncIssue(value?: string): SessionSyncIssue | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredSyncIssue>;
    if (
      parsed.version === 1 &&
      typeof parsed.code === "string" &&
      typeof parsed.message === "string" &&
      typeof parsed.retryable === "boolean"
    ) {
      return parsed as StoredSyncIssue;
    }
  } catch {
    // Older rows contain a plain error string.
  }
  return { code: "unknown", message: value, retryable: true };
}
