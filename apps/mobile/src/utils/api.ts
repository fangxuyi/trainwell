import { File } from "expo-file-system";
import { getAuthToken } from "../auth/token";

const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
  }
}

async function apiError(res: Response, path: string): Promise<ApiError> {
  const text = await res.text().catch(() => res.statusText);
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return new ApiError(`API ${path} failed (${res.status}): ${text}`, res.status, body);
}

// Builds request headers with the current Clerk session token (if signed in),
// so the API can identify the user and scope data to them.
async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return {
    ...(extra ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await apiError(res, path);
  }
  return res.json() as Promise<T>;
}

export async function apiGet<T>(path: string, timeoutMs = 5000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      signal: controller.signal,
      headers: await authHeaders(),
    });
    if (!res.ok) throw await apiError(res, path);
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok && res.status !== 404) {
    throw await apiError(res, path);
  }
}

const AUDIO_CONTENT_TYPE = "audio/mp4";

// Uploads a recording straight to Vercel Blob via a presigned PUT, then registers
// it with the server (which transcribes it). Going direct-to-Blob bypasses
// Vercel's 4.5 MB serverless request-body limit, so full-length sessions upload.
export async function uploadAudioChunk(
  sessionId: string,
  chunkId: string,
  sequence: number,
  localPath: string,
  durationSeconds: number,
  sizeBytes: number
): Promise<string | null> {
  // 1. Ask the server for a presigned PUT URL (+ the eventual blob URL).
  const { presignedUrl, blobUrl, apiVersion } = await apiPost<{
    presignedUrl: string;
    blobUrl: string;
    apiVersion: string;
  }>(`/api/workouts/${sessionId}/audio-upload-url`, {
    sequence,
    contentType: AUDIO_CONTENT_TYPE,
  });

  // 2. Stream the file from disk directly to Blob. The presigned URL carries
  //    auth in its query params; the PUT just needs the matching content type.
  const file = new File(localPath);
  const result = await file.upload(presignedUrl, {
    httpMethod: "PUT",
    headers: {
      "x-content-type": AUDIO_CONTENT_TYPE,
      "x-api-version": apiVersion,
    },
    mimeType: AUDIO_CONTENT_TYPE,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Blob upload failed (${result.status}): ${result.body}`);
  }

  // 3. Register the uploaded blob so the server records it and transcribes.
  const segment = await apiPost<{
    remote_status?: string;
    warning?: string;
    message?: string;
  }>(`/api/workouts/${sessionId}/audio-segments`, {
    chunkId,
    sequence,
    blobUrl,
    durationSeconds,
    sizeBytes,
  });
  if (segment.remote_status === "failed") {
    throw new Error(segment.message ?? segment.warning ?? "Transcription failed");
  }

  return blobUrl;
}
