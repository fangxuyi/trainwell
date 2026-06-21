const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    throw new Error(`API GET ${path} failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function uploadAudioChunk(
  sessionId: string,
  chunkId: string,
  sequence: number,
  localPath: string,
  durationSeconds: number,
  sizeBytes: number
): Promise<string | null> {
  const fileRes = await fetch(localPath);
  const blob = await fileRes.blob();

  const form = new FormData();
  form.append("chunkId", chunkId);
  form.append("sequence", String(sequence));
  form.append("durationSeconds", String(durationSeconds));
  form.append("sizeBytes", String(sizeBytes));
  form.append("audio", blob, "audio.m4a");

  const res = await fetch(
    `${BASE_URL}/api/workouts/${sessionId}/audio-segments`,
    { method: "POST", body: form }
  );
  if (!res.ok) {
    throw new Error(`Upload chunk failed (${res.status})`);
  }
  const data = (await res.json()) as { blob_url?: string };
  return data.blob_url ?? null;
}
