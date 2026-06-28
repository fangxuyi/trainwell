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

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`API DELETE ${path} failed (${res.status})`);
  }
}

export async function uploadAudioChunk(
  sessionId: string,
  chunkId: string,
  sequence: number,
  localPath: string,
  durationSeconds: number,
  sizeBytes: number
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("chunkId", chunkId);
    form.append("sequence", String(sequence));
    form.append("durationSeconds", String(durationSeconds));
    form.append("sizeBytes", String(sizeBytes));
    // XHR's native FormData in React Native handles { uri, name, type } file objects
    form.append("audio", { uri: localPath, name: "audio.wav", type: "audio/wav" } as any);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE_URL}/api/workouts/${sessionId}/audio-segments`);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as { blob_url?: string };
          resolve(data.blob_url ?? null);
        } catch {
          resolve(null);
        }
      } else {
        reject(new Error(`Upload chunk failed (${xhr.status}): ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during chunk upload"));
    xhr.send(form);
  });
}
