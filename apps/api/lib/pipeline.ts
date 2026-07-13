import sql from "./db";
import { extractWorkoutData, extractWorkoutDataWindowed } from "./extract";
import { generateSummaryText } from "./markdown";
import { embedTexts } from "./voyage";
import { chunkExtraction } from "./chunks";
import { randomUUID } from "crypto";

export async function transcribeAndExtract(sessionId: string): Promise<void> {
  // Transcription happens per-chunk at upload time; just fetch existing segments.
  const transcriptRows = await sql`
    SELECT * FROM transcript_segments
    WHERE session_id = ${sessionId}
    ORDER BY start_seconds ASC
  `;

  if (transcriptRows.length === 0) {
    // Distinguish the causes so the failure isn't opaque: no audio uploaded at
    // all vs. audio uploaded but transcription never produced anything.
    const audioRows = await sql`
      SELECT remote_status, COUNT(*)::int AS n
      FROM audio_segments
      WHERE session_id = ${sessionId}
      GROUP BY remote_status
    `;
    if (audioRows.length === 0) {
      throw new Error(
        `No audio segments uploaded for session ${sessionId} — the recording never reached the server.`
      );
    }
    const breakdown = audioRows
      .map((r) => `${r.n} ${r.remote_status}`)
      .join(", ");
    throw new Error(
      `No transcript segments for session ${sessionId}: audio uploaded (${breakdown}) ` +
        `but transcription produced nothing. Check the transcription logs — usually an ` +
        `audio format/codec mismatch reaching Groq.`
    );
  }

  // Extract workout data with Claude. Long sessions are split into time windows
  // and extracted in parallel (a single hour-long extraction exceeds the
  // serverless timeout); short sessions still run as one call.
  const extraction = await extractWorkoutDataWindowed(
    sessionId,
    transcriptRows.map((s) => ({
      startSeconds: s.start_seconds as number,
      text: s.text as string,
    }))
  );

  // Generate compact summary in workout-summary skill format
  const sessionRows = await sql`SELECT * FROM sessions WHERE id = ${sessionId}`;
  if (sessionRows.length === 0) throw new Error(`Session ${sessionId} not found`);
  const session = sessionRows[0] as {
    id: string;
    started_at: string;
    ended_at?: string;
    duration_seconds?: number;
    workout_type?: string;
    trainer_name?: string;
    location?: string;
    goals?: string[];
    audio_retention_policy: string;
  };
  const summaryText = generateSummaryText(session, extraction);

  // Persist extraction results
  await sql`
    UPDATE sessions SET
      exercises = ${JSON.stringify(extraction.exercises)}::jsonb,
      session_notes = ${JSON.stringify(extraction.sessionNotes)},
      technique_themes = ${JSON.stringify(extraction.techniqueThemes)},
      accomplishments = ${JSON.stringify(extraction.accomplishments)},
      improvement_areas = ${JSON.stringify(extraction.improvementAreas)},
      pain_observations = ${JSON.stringify(extraction.painObservations)},
      next_session_plan = ${JSON.stringify(extraction.nextSessionPlan ?? null)},
      overall_difficulty = ${extraction.overallDifficulty?.value ?? null},
      energy_level = ${extraction.energyLevel?.value ?? null},
      markdown_content = ${summaryText},
      extraction_version = ${extraction.extractionVersion},
      remote_status = 'review_required',
      remote_version = remote_version + 1,
      updated_at = now()
    WHERE id = ${sessionId}
  `;

  // Embed chunks for RAG
  await embedSession(sessionId, session, extraction);
}

async function embedSession(
  sessionId: string,
  session: { id: string; started_at: string; duration_seconds?: number; workout_type?: string; trainer_name?: string },
  extraction: Awaited<ReturnType<typeof extractWorkoutData>>
): Promise<void> {
  const chunks = chunkExtraction(session, extraction);
  if (chunks.length === 0) return;

  await sql`DELETE FROM session_chunks WHERE session_id = ${sessionId}`;

  const embeddings = await embedTexts(chunks.map((c) => c.content));
  for (let i = 0; i < chunks.length; i++) {
    const embeddingStr = `[${embeddings[i].join(",")}]`;
    await sql`
      INSERT INTO session_chunks (id, session_id, chunk_type, content, embedding)
      VALUES (${randomUUID()}, ${sessionId}, ${chunks[i].chunkType}, ${chunks[i].content}, ${embeddingStr}::vector)
    `;
  }
}
