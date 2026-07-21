import sql from "./db";
import { synthesizeWorkoutData } from "./extract";
import { generateSummaryText } from "./markdown";
import {
  attachExerciseDatasetCandidates,
  canonicalizeExtraction,
  preloadExerciseDataset,
} from "./exercise-dataset";
import {
  distillWorkoutTranscriptWindowed,
  formatDistilledWorkoutTranscript,
} from "./transcript-distillation";

async function timedStage<T>(
  sessionId: string,
  stage: string,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  console.info(`[pipeline] session=${sessionId} stage=${stage} status=started`);
  try {
    const result = await operation();
    console.info(
      `[pipeline] session=${sessionId} stage=${stage} status=completed duration_ms=${Date.now() - startedAt}`
    );
    return result;
  } catch (error) {
    console.error(
      `[pipeline] session=${sessionId} stage=${stage} status=failed duration_ms=${Date.now() - startedAt}`,
      error
    );
    throw error;
  }
}

export async function transcribeAndExtract(sessionId: string): Promise<void> {
  const pipelineStartedAt = Date.now();
  console.info(`[pipeline] session=${sessionId} status=started`);

  // Transcription happens per-chunk at upload time; just fetch existing segments.
  const transcriptRows = await timedStage(sessionId, "load_transcript", () => sql`
      SELECT * FROM transcript_segments
      WHERE session_id = ${sessionId}
      ORDER BY start_seconds ASC
    `);

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

  // First isolate transcript-supported exercise evidence into a compact,
  // window-safe timeline. Then synthesize one coherent workout record from
  // that reduced transcript so session-level conclusions see the whole workout.
  preloadExerciseDataset();
  const distilled = await timedStage(sessionId, "distill_transcript", () =>
    distillWorkoutTranscriptWindowed(
      sessionId,
      transcriptRows.map((s) => ({
        startSeconds: s.start_seconds as number,
        text: s.text as string,
      }))
    )
  );
  const groundedDistillation = await timedStage(
    sessionId,
    "retrieve_exercise_candidates",
    () => attachExerciseDatasetCandidates(distilled)
  ).catch((error) => {
    console.warn(`Exercise candidate retrieval skipped for session ${sessionId}:`, error);
    return distilled;
  });
  const distilledTranscript = formatDistilledWorkoutTranscript(groundedDistillation);
  const rawExtraction = await timedStage(sessionId, "synthesize_workout", () =>
    synthesizeWorkoutData(sessionId, distilledTranscript)
  );
  const extraction = await timedStage(sessionId, "canonicalize_exercises", () =>
    canonicalizeExtraction(rawExtraction, { allowFuzzyMatch: false })
  ).catch((error) => {
    console.warn(`Exercise canonicalization skipped for session ${sessionId}:`, error);
    return rawExtraction;
  });

  // Generate compact summary in workout-summary skill format
  const sessionRows = await timedStage(sessionId, "load_session", () =>
    sql`SELECT * FROM sessions WHERE id = ${sessionId}`
  );
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
  const summaryText = await timedStage(sessionId, "generate_summary", async () =>
    generateSummaryText(session, extraction)
  );

  // Persist extraction results
  await timedStage(sessionId, "persist_recap", () => sql`
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
    `);

  console.info(
    `[pipeline] session=${sessionId} status=completed duration_ms=${Date.now() - pipelineStartedAt}`
  );
}
