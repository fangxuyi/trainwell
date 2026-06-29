import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import sql from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";

async function tryUpload(label: string, buffer: ArrayBuffer, buildForm: (b: ArrayBuffer) => FormData) {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: buildForm(buffer),
    });
    const text = await res.text();
    if (res.ok) {
      const data = JSON.parse(text) as { text?: string };
      return { label, status: res.status, ok: true, preview: (data.text ?? "").slice(0, 80) };
    }
    return { label, status: res.status, ok: false, error: text.slice(0, 200) };
  } catch (e) {
    return { label, status: 0, ok: false, error: String(e) };
  }
}

export async function GET() {
  const KEY = process.env.GROQ_API_KEY;

  // Get most recent blob URL
  const rows = await sql`
    SELECT blob_url FROM audio_segments
    WHERE blob_url IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `;
  if (rows.length === 0) return NextResponse.json({ error: "no audio segments found" });

  const blobUrl = rows[0].blob_url as string;
  const result = await get(blobUrl, { access: "private" });
  if (!result?.stream) return NextResponse.json({ error: "blob not found" });

  const buffer = await new Response(result.stream).arrayBuffer();
  const magic = Buffer.from(buffer).slice(0, 12).toString("hex");

  const tests = await Promise.all([
    tryUpload("Blob audio/mp4 filename audio.m4a", buffer, (b) => {
      const f = new FormData();
      f.append("file", new Blob([b], { type: "audio/mp4" }), "audio.m4a");
      f.append("model", "whisper-large-v3-turbo");
      return f;
    }),
    tryUpload("Blob audio/m4a filename audio.m4a", buffer, (b) => {
      const f = new FormData();
      f.append("file", new Blob([b], { type: "audio/m4a" }), "audio.m4a");
      f.append("model", "whisper-large-v3-turbo");
      return f;
    }),
    tryUpload("Blob audio/mp4 filename audio.mp4", buffer, (b) => {
      const f = new FormData();
      f.append("file", new Blob([b], { type: "audio/mp4" }), "audio.mp4");
      f.append("model", "whisper-large-v3-turbo");
      return f;
    }),
    tryUpload("Blob no-type filename audio.m4a", buffer, (b) => {
      const f = new FormData();
      f.append("file", new Blob([b]), "audio.m4a");
      f.append("model", "whisper-large-v3-turbo");
      return f;
    }),
    tryUpload("File name=audio.m4a type=audio/mp4", buffer, (b) => {
      const f = new FormData();
      f.append("file", new File([b], "audio.m4a", { type: "audio/mp4" }));
      f.append("model", "whisper-large-v3-turbo");
      return f;
    }),
  ]);

  return NextResponse.json({
    blobUrl,
    sizeBytes: buffer.byteLength,
    magicHex: magic,
    keyPresent: !!KEY,
    keyPrefix: KEY ? KEY.slice(0, 8) + "..." : null,
    tests,
  });
}
