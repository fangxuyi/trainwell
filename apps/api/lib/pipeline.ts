import sql from "./db";
import { extractWorkoutDataWindowed } from "./extract";
import { generateSummaryText } from "./markdown";
import { canonicalizeExtraction } from "./exercise-dataset";

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

  // Extract workout data with the configured language-model provider. Long
  // sessions are split into time windows and extracted in parallel; short
  // sessions still run as one call.
  const rawExtraction = await extractWorkoutDataWindowed(
    sessionId,
    transcriptRows.map((s) => ({
      startSeconds: s.start_seconds as number,
      text: s.text as string,
    }))
  );
  const extraction = await canonicalizeExtraction(rawExtraction).catch((error) => {
    console.warn(`Exercise canonicalization skipped for session ${sessionId}:`, error);
    return rawExtraction;
  });

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

}
