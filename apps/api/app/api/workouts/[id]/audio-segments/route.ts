import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import sql from "@/lib/db";
import { transcribeAudioUrl } from "@/lib/transcribe";

export const dynamic = "force-dynamic";

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

  // Idempotent: return existing chunk if already transcribed
  const existing = await sql`
    SELECT * FROM audio_segments WHERE id = ${chunkId}
  `;
  if (existing.length > 0 && existing[0].remote_status === "transcribed") {
    return NextResponse.json(existing[0], { status: 200 });
  }

  const durationSeconds = parseFloat((formData.get("durationSeconds") as string) ?? "0");
  const sizeBytes = parseInt((formData.get("sizeBytes") as string) ?? "0", 10);

  let blobUrl: string | null = null;

  if (audioFile) {
    const blob = await put(
      `sessions/${sessionId}/audio/chunk_${String(sequence).padStart(4, "0")}.m4a`,
      audioFile,
      { access: "private", contentType: "audio/mp4", addRandomSuffix: false }
    );
    blobUrl = blob.url;
  }

  // Save audio segment row first
  const rows = await sql`
    INSERT INTO audio_segments (
      id, session_id, sequence, blob_url, duration_seconds,
      size_bytes, sha256, remote_status
    ) VALUES (
      ${chunkId}, ${sessionId}, ${sequence}, ${blobUrl},
      ${durationSeconds}, ${sizeBytes}, ${sha256}, 'uploaded'
    )
    ON CONFLICT (id) DO UPDATE
      SET blob_url = EXCLUDED.blob_url, remote_status = 'uploaded',
          updated_at = now()
    RETURNING *
  `;
  const segment = rows[0];

  // Transcribe immediately — compute offset from previous chunks
  if (blobUrl) {
    try {
      const offsetRow = await sql`
        SELECT COALESCE(SUM(duration_seconds), 0)::float AS offset_seconds
        FROM audio_segments
        WHERE session_id = ${sessionId} AND sequence < ${sequence}
      `;
      const offsetSeconds = parseFloat(offsetRow[0].offset_seconds as string ?? "0");

      const transcriptSegs = await transcribeAudioUrl(blobUrl, chunkId, offsetSeconds);

      for (const seg of transcriptSegs) {
        await sql`
          INSERT INTO transcript_segments (
            id, session_id, audio_segment_id, start_seconds, end_seconds,
            speaker, text, confidence, reviewed
          ) VALUES (
            ${seg.id}, ${sessionId}, ${seg.audioSegmentId},
            ${seg.startSeconds}, ${seg.endSeconds},
            ${seg.speaker}, ${seg.text}, ${seg.confidence ?? null}, false
          ) ON CONFLICT (id) DO NOTHING
        `;
      }

      await sql`
        UPDATE audio_segments SET remote_status = 'transcribed', updated_at = now()
        WHERE id = ${chunkId}
      `;
      segment.remote_status = "transcribed";
    } catch (err) {
      // Log but don't fail the upload — pipeline can retry transcription
      console.error(`Transcription failed for chunk ${chunkId}:`, err);
    }
  }

  return NextResponse.json(segment, { status: 201 });
}
