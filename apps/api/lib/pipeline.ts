import sql from "./db";
import { transcribeAudioUrl } from "./transcribe";
import { extractWorkoutData } from "./extract";
import { generateMarkdown } from "./markdown";
import { randomUUID } from "crypto";

export async function transcribeAndExtract(sessionId: string): Promise<void> {
  // 1. Get all uploaded audio segments in order
  const segments = await sql`
    SELECT * FROM audio_segments
    WHERE session_id = ${sessionId}
      AND remote_status = 'uploaded'
      AND blob_url IS NOT NULL
    ORDER BY sequence ASC
  `;

  if (segments.length === 0) {
    throw new Error(`No uploaded audio segments for session ${sessionId}`);
  }

  // 2. Transcribe each chunk, accumulating offset
  const allTranscriptSegments = [];
  let offsetSeconds = 0;

  for (const seg of segments) {
    const transcriptSegs = await transcribeAudioUrl(
      seg.blob_url,
      seg.id,
      offsetSeconds
    );
    allTranscriptSegments.push(...transcriptSegs);
    offsetSeconds += seg.duration_seconds;
  }

  // 3. Save transcript segments
  for (const seg of allTranscriptSegments) {
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

  // 4. Build full transcript text for extraction
  const fullTranscript = allTranscriptSegments
    .map((s) => `[${formatTime(s.startSeconds)}] ${s.text}`)
    .join("\n");

  // 5. Extract workout data with Claude
  const extraction = await extractWorkoutData(sessionId, fullTranscript);

  // 6. Generate Markdown
  const sessionRows = await sql`SELECT * FROM sessions WHERE id = ${sessionId}`;
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
  const markdown = generateMarkdown(session, extraction, allTranscriptSegments);

  // 7. Update session with results
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
      markdown_content = ${markdown},
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
