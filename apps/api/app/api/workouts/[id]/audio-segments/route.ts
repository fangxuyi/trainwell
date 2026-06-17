import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import sql from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rows = await sql`
    SELECT * FROM audio_segments WHERE session_id = ${id} ORDER BY sequence ASC
  `;
  return NextResponse.json(rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  // Expects multipart/form-data with: chunkId, sequence, sha256 (optional), audio file
  const formData = await req.formData();
  const chunkId = formData.get("chunkId") as string;
  const sequence = parseInt(formData.get("sequence") as string, 10);
  const sha256 = formData.get("sha256") as string | null;
  const audioFile = formData.get("audio") as File | null;

  if (!chunkId || isNaN(sequence)) {
    return NextResponse.json(
      { error: "chunkId and sequence are required" },
      { status: 400 }
    );
  }

  // Idempotent: return existing chunk if already uploaded
  const existing = await sql`
    SELECT * FROM audio_segments WHERE id = ${chunkId}
  `;
  if (existing.length > 0 && existing[0].remote_status === "uploaded") {
    return NextResponse.json(existing[0], { status: 200 });
  }

  let blobUrl: string | null = null;

  if (audioFile) {
    const blob = await put(
      `sessions/${sessionId}/audio/chunk_${String(sequence).padStart(4, "0")}.m4a`,
      audioFile,
      { access: "public", contentType: "audio/mp4", addRandomSuffix: false }
    );
    blobUrl = blob.url;
  }

  const rows = await sql`
    INSERT INTO audio_segments (
      id, session_id, sequence, blob_url, duration_seconds,
      size_bytes, sha256, remote_status
    ) VALUES (
      ${chunkId}, ${sessionId}, ${sequence}, ${blobUrl},
      ${parseFloat((formData.get("durationSeconds") as string) ?? "0")},
      ${parseInt((formData.get("sizeBytes") as string) ?? "0", 10)},
      ${sha256}, 'uploaded'
    )
    ON CONFLICT (id) DO UPDATE
      SET blob_url = EXCLUDED.blob_url, remote_status = 'uploaded',
          updated_at = now()
    RETURNING *
  `;

  return NextResponse.json(rows[0], { status: 201 });
}
