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

  // Two upload paths:
  //  - application/json: the phone already uploaded the file directly to Blob
  //    (presigned PUT, bypassing the 4.5 MB serverless limit) and sends the
  //    resulting blobUrl. This is the path for full-length sessions.
  //  - multipart/form-data: the phone sends the file bytes and we put() it.
  //    Kept for small files / backward compatibility.
  const isJson = req.headers.get("content-type")?.includes("application/json");

  let chunkId: string;
  let sequence: number;
  let sha256: string | null = null;
  let durationSeconds = 0;
  let sizeBytes = 0;
  let blobUrl: string | null = null;

  if (isJson) {
    const body = (await req.json()) as {
      chunkId?: string;
      sequence?: number;
      blobUrl?: string;
      sha256?: string;
      durationSeconds?: number;
      sizeBytes?: number;
    };
    chunkId = body.chunkId ?? "";
    sequence = body.sequence ?? NaN;
    blobUrl = body.blobUrl ?? null;
    sha256 = body.sha256 ?? null;
    durationSeconds = body.durationSeconds ?? 0;
    sizeBytes = body.sizeBytes ?? 0;

    if (!blobUrl) {
      return NextResponse.json({ error: "blobUrl is required" }, { status: 400 });
    }
  } else {
    const formData = await req.formData();
    chunkId = formData.get("chunkId") as string;
    sequence = parseInt(formData.get("sequence") as string, 10);
    sha256 = formData.get("sha256") as string | null;
    durationSeconds = parseFloat((formData.get("durationSeconds") as string) ?? "0");
    sizeBytes = parseInt((formData.get("sizeBytes") as string) ?? "0", 10);

    const audioFile = formData.get("audio") as File | null;
    if (audioFile) {
      const blob = await put(
        `sessions/${sessionId}/audio/chunk_${String(sequence).padStart(4, "0")}.m4a`,
        audioFile,
        { access: "private", contentType: "audio/mp4", addRandomSuffix: false }
      );
      blobUrl = blob.url;
    }
  }

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

      // Guard the silent no-op: a workout chunk that transcribes to zero
      // segments almost always means a format/codec mismatch (e.g. an m4a sent
      // to a server that hands Groq the wrong content type) rather than genuine
      // silence. Surface it and mark the segment failed instead of falsely
      // reporting it "transcribed" and letting the pipeline die later with a
      // vague "no transcript segments" error.
      if (transcriptSegs.length === 0) {
        console.error(
          `Transcription produced 0 segments for chunk ${chunkId} ` +
            `(session ${sessionId}). Likely an audio format/codec mismatch.`
        );
        await sql`
          UPDATE audio_segments SET remote_status = 'failed', updated_at = now()
          WHERE id = ${chunkId}
        `;
        segment.remote_status = "failed";
        return NextResponse.json(
          {
            ...segment,
            warning: "transcription_empty",
            message:
              "Audio uploaded but transcription returned no text — check the audio format reaching Groq.",
          },
          { status: 201 }
        );
      }

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
      // Don't 500 the upload (the audio is safely stored), but do NOT swallow
      // the failure silently: persist it on the segment so it's queryable and
      // the pipeline can report the real reason instead of a generic error.
      console.error(`Transcription failed for chunk ${chunkId}:`, err);
      await sql`
        UPDATE audio_segments SET remote_status = 'failed', updated_at = now()
        WHERE id = ${chunkId}
      `;
      return NextResponse.json(
        {
          ...segment,
          remote_status: "failed",
          warning: "transcription_failed",
          message: (err as Error).message,
        },
        { status: 201 }
      );
    }
  }

  return NextResponse.json(segment, { status: 201 });
}
