import sql from "./db";
import { extractWorkoutData } from "./extract";
import { generateSummaryText } from "./markdown";

export async function transcribeAndExtract(sessionId: string): Promise<void> {
  // Transcription happens per-chunk at upload time; just fetch existing segments.
  const transcriptRows = await sql`
    SELECT * FROM transcript_segments
    WHERE session_id = ${sessionId}
    ORDER BY start_seconds ASC
  `;

  if (transcriptRows.length === 0) {
    throw new Error(`No transcript segments found for session ${sessionId}`);
  }

  // Build transcript text with timestamps for Claude
  const fullTranscript = transcriptRows
    .map((s) => `[${formatTime(s.start_seconds as number)}] ${s.text}`)
    .join("\n");

  // Extract workout data with Claude
  const extraction = await extractWorkoutData(sessionId, fullTranscript);

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

  // Persist results
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

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
