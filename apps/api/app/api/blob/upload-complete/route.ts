import { NextRequest, NextResponse, after } from "next/server";
import sql from "@/lib/db";
import { transcribeAudioUrl } from "@/lib/transcribe";
import { transcribeAndExtract } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Blob calls this when a presigned upload finishes (see the
// onUploadCompleted wiring in audio-upload-url). It lets the server transcribe
// and run the full pipeline WITHOUT the app being open — the file uploads on a
// native background URLSession that survives the app being suspended or killed,
// but the app's JS never runs again, so the processing has to happen here.
//
// This is additive: the foreground sync path still does the same work when the
// app stays open. Both paths are idempotent (segment upsert, transcription
// skipped once a segment is 'transcribed', pipeline skipped once the session is
// already processed), so running both is safe.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    type?: string;
    payload?: {
      blob?: { url?: string };
      tokenPayload?: string | null;
    };
  } | null;

  // Only act on completion events; ack anything else.
  if (!body || body.type !== "blob.upload-completed") {
    return NextResponse.json({ ok: true });
  }

  const blobUrl = body.payload?.blob?.url;
  let payload: {
    sessionId?: string;
    chunkId?: string;
    sequence?: number;
    secret?: string;
  } = {};
  try {
    payload = JSON.parse(body.payload?.tokenPayload ?? "{}");
  } catch {
    // fall through to the missing-fields guard
  }

  const expectedSecret = process.env.BLOB_CALLBACK_SECRET ?? "";
  if (expectedSecret && payload.secret !== expectedSecret) {
    return NextResponse.json({ error: "invalid callback" }, { status: 403 });
  }

  const { sessionId, chunkId, sequence = 0 } = payload;
  if (!sessionId || !chunkId || !blobUrl) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  // Ack fast — Blob expects a prompt response — and do the heavy work after.
  after(async () => {
    try {
      // Register the segment (may already exist from the foreground path).
      await sql`
        INSERT INTO audio_segments (id, session_id, sequence, blob_url, remote_status)
        VALUES (${chunkId}, ${sessionId}, ${sequence}, ${blobUrl}, 'uploaded')
        ON CONFLICT (id) DO UPDATE
          SET blob_url = EXCLUDED.blob_url, updated_at = now()
      `;

      // Transcribe only if not already done — avoids duplicate transcript rows
      // when the foreground path already handled this segment.
      const seg = await sql`
        SELECT remote_status FROM audio_segments WHERE id = ${chunkId}
      `;
      if (seg[0]?.remote_status !== "transcribed") {
        const offsetRow = await sql`
          SELECT COALESCE(SUM(duration_seconds), 0)::float AS offset_seconds
          FROM audio_segments
          WHERE session_id = ${sessionId} AND sequence < ${sequence}
        `;
        const offsetSeconds = parseFloat(offsetRow[0].offset_seconds as string ?? "0");
        const transcriptSegs = await transcribeAudioUrl(blobUrl, chunkId, offsetSeconds);

        for (const s of transcriptSegs) {
          await sql`
            INSERT INTO transcript_segments (
              id, session_id, audio_segment_id, start_seconds, end_seconds,
              speaker, text, confidence, reviewed
            ) VALUES (
              ${s.id}, ${sessionId}, ${s.audioSegmentId},
              ${s.startSeconds}, ${s.endSeconds},
              ${s.speaker}, ${s.text}, ${s.confidence ?? null}, false
            ) ON CONFLICT (id) DO NOTHING
          `;
        }
        await sql`
          UPDATE audio_segments
          SET remote_status = ${transcriptSegs.length > 0 ? "transcribed" : "failed"},
              updated_at = now()
          WHERE id = ${chunkId}
        `;
      }

      // Run the pipeline unless the session is already processed.
      const sessionRows = await sql`
        SELECT remote_status FROM sessions WHERE id = ${sessionId}
      `;
      const status = sessionRows[0]?.remote_status as string | undefined;
      if (status === "review_required" || status === "finalized") {
        return;
      }

      await sql`
        UPDATE sessions SET remote_status = 'processing', updated_at = now()
        WHERE id = ${sessionId}
      `;
      await transcribeAndExtract(sessionId);
    } catch (err) {
      console.error("[upload-complete] processing failed for", sessionId, err);
      await sql`
        UPDATE sessions SET remote_status = 'failed', updated_at = now()
        WHERE id = ${sessionId}
      `;
    }
  });

  return NextResponse.json({ ok: true });
}
