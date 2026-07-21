import type {
  ExerciseRecord,
  ExerciseSet,
  ExtractionOutput,
  NextSessionPlan,
  PainObservation,
  SourcedNote,
} from "@/lib/types";
import { generateText } from "@/lib/language-model";

const EXTRACTION_VERSION = "2.0-two-stage";

const SYNTHESIS_SYSTEM_PROMPT = `You are the synthesis stage of a workout processing pipeline. Convert a distilled, evidence-only workout timeline into one coherent structured workout record.

Rules:
- Use only information in the distilled workout transcript
- Distinguish between COMPLETED exercises and PLANNED/FUTURE exercises
- "Next time try X" or "try X next session" means a next-session recommendation, NOT a completed set
- If a value is uncertain, preserve that uncertainty with a low confidence score and status "weakly_inferred"
- If a value is explicitly preserved in the evidence timeline, use confidence 0.9+ and status "explicit"
- Never invent data that is absent from the distilled transcript
- Body weight exercises have no weight value
- Record pain/discomfort observations without diagnosis
- Preserve the supplied approximate start and end seconds for each exercise
- Use a clear conventional canonicalName when identifiable, retain supplied spoken wording in spokenNames, and do not force an unclear match
- Dataset candidates are retrieval hints, not proof that an exercise occurred. Use a candidate name only when it is explicitly marked recommended=true and the transcript evidence supports it.
- When no candidate is marked recommended=true, preserve the original evidence name as canonicalName. Never choose a weaker candidate or invent another catalog exercise.
- Do not use candidate metadata to invent performed sets, reps, weights, body regions, or coaching cues.
- Trainer cues are workout evidence only and were intentionally excluded from dataset candidate scoring.
- Consolidate duplicate evidence entries only when their names, timestamps, and details show that they describe the same exercise crossing a processing boundary
- Preserve separate exercise blocks when the same movement occurred at meaningfully different times
- Capture completed set-by-set reps and weights from the evidence timeline
- Keep techniqueNotes and trainerNotes to personalized corrections, safety modifications, progression/regression guidance, or repeated emphasis. Omit generic exercise instructions that do not add session-specific value.
- Derive session themes, accomplishments, improvement areas, and next-session plans only from explicit session-level evidence or repeated exercise evidence

Return ONLY valid JSON matching the ExtractionOutput schema.`;

const OUTPUT_SCHEMA = `{
  "sessionId": "string",
  "extractionVersion": "string",
  "exercises": [
    {
      "id": "string (uuid)",
      "canonicalName": "string",
      "spokenNames": ["string"],
      "category": "string | null",
      "bodyRegions": ["string"],
      "equipment": ["string"],
      "sequenceNumber": 0,
      "startedAtSeconds": 0,
      "endedAtSeconds": 60,
      "planned": false,
      "completed": true,
      "sets": [
        {
          "setNumber": 1,
          "setType": "working",
          "plannedReps": null,
          "completedReps": 10,
          "weight": { "value": 25, "unit": "lb", "confidence": 0.97, "status": "explicit", "sourceSegmentIds": [] },
          "duration": null,
          "restAfterSeconds": 60,
          "rpe": null,
          "completed": true,
          "formQuality": null,
          "userNotes": [],
          "trainerNotes": [],
          "confidence": 0.9,
          "sourceSegmentIds": []
        }
      ],
      "techniqueNotes": [],
      "userNotes": [],
      "trainerNotes": [],
      "painObservations": [],
      "progressionSuggestion": null,
      "confidence": 0.9
    }
  ],
  "sessionNotes": ["string"],
  "techniqueThemes": ["string"],
  "accomplishments": ["string"],
  "improvementAreas": ["string"],
  "painObservations": [
    { "bodyPart": "string", "description": "string", "severity": "mild", "sourceSegmentIds": [] }
  ],
  "nextSessionPlan": {
    "exercises": [
      { "exerciseName": "string", "targetSets": 3, "targetReps": "8-10", "targetWeight": "30 lb", "notes": [], "sourceSegmentIds": [] }
    ],
    "generalNotes": ["string"],
    "sourceSegmentIds": []
  },
  "overallDifficulty": { "value": 7, "unit": "/10", "confidence": 0.8, "status": "strongly_inferred", "sourceSegmentIds": [] },
  "energyLevel": null,
  "openQuestions": ["string"]
}`;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && !!item.trim());
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sourcedNotes(value: unknown): SourcedNote[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (note): note is JsonRecord =>
        isRecord(note) && typeof note.text === "string" && !!note.text.trim()
    )
    .map((note) => ({
      ...(note as unknown as SourcedNote),
      text: (note.text as string).trim(),
      confidence: finiteNumber(note.confidence, 0.5),
      sourceSegmentIds: stringArray(note.sourceSegmentIds),
    }));
}

function painObservations(value: unknown): PainObservation[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (observation): observation is JsonRecord =>
        isRecord(observation) &&
        typeof observation.description === "string" &&
        !!observation.description.trim()
    )
    .map((observation) => ({
      ...(observation as unknown as PainObservation),
      description: (observation.description as string).trim(),
      sourceSegmentIds: stringArray(observation.sourceSegmentIds),
    }));
}

function normalizeSet(value: unknown, index: number): ExerciseSet | null {
  if (!isRecord(value)) return null;
  return {
    ...(value as unknown as ExerciseSet),
    setNumber: finiteNumber(value.setNumber, index + 1),
    completed: typeof value.completed === "boolean" ? value.completed : false,
    userNotes: sourcedNotes(value.userNotes),
    trainerNotes: sourcedNotes(value.trainerNotes),
    confidence: finiteNumber(value.confidence, 0.5),
    sourceSegmentIds: stringArray(value.sourceSegmentIds),
  };
}

function normalizeExercise(
  sessionId: string,
  value: unknown,
  index: number
): ExerciseRecord | null {
  if (!isRecord(value)) return null;
  const canonicalName =
    typeof value.canonicalName === "string" ? value.canonicalName.trim() : "";
  if (!canonicalName || !Array.isArray(value.sets)) return null;
  const sets = value.sets
    .map((set, setIndex) => normalizeSet(set, setIndex))
    .filter((set): set is ExerciseSet => !!set);

  return {
    ...(value as unknown as ExerciseRecord),
    id:
      typeof value.id === "string" && value.id.trim()
        ? value.id.trim()
        : `${sessionId}-exercise-${index + 1}`,
    canonicalName,
    spokenNames: stringArray(value.spokenNames),
    bodyRegions: stringArray(value.bodyRegions),
    equipment: stringArray(value.equipment),
    sequenceNumber: finiteNumber(value.sequenceNumber, index + 1),
    planned: typeof value.planned === "boolean" ? value.planned : false,
    completed: typeof value.completed === "boolean" ? value.completed : false,
    sets,
    techniqueNotes: sourcedNotes(value.techniqueNotes),
    userNotes: sourcedNotes(value.userNotes),
    trainerNotes: sourcedNotes(value.trainerNotes),
    painObservations: painObservations(value.painObservations),
    progressionSuggestion: isRecord(value.progressionSuggestion)
      ? sourcedNotes([value.progressionSuggestion])[0]
      : undefined,
    confidence: finiteNumber(value.confidence, 0.5),
  };
}

function normalizeNextSessionPlan(value: unknown): NextSessionPlan | undefined {
  if (!isRecord(value)) return undefined;
  const exercises = Array.isArray(value.exercises)
    ? value.exercises
        .filter(
          (exercise): exercise is JsonRecord =>
            isRecord(exercise) &&
            typeof exercise.exerciseName === "string" &&
            !!exercise.exerciseName.trim()
        )
        .map((exercise) => ({
          ...(exercise as unknown as NextSessionPlan["exercises"][number]),
          exerciseName: (exercise.exerciseName as string).trim(),
          notes: stringArray(exercise.notes),
          sourceSegmentIds: stringArray(exercise.sourceSegmentIds),
        }))
    : [];
  const generalNotes = stringArray(value.generalNotes);
  if (exercises.length === 0 && generalNotes.length === 0) return undefined;
  return {
    exercises,
    generalNotes,
    sourceSegmentIds: stringArray(value.sourceSegmentIds),
  };
}

function parseExtractionResponse(sessionId: string, text: string): ExtractionOutput {
  const jsonMatch =
    text.match(/```(?:json)?\s*([\s\S]+?)\s*```/) ?? text.match(/(\{[\s\S]+\})/);
  if (!jsonMatch) throw new Error("No JSON found in extraction response");

  const parsed: unknown = JSON.parse(jsonMatch[1]);
  if (!isRecord(parsed)) throw new Error("Extraction response was not an object");
  if (!Array.isArray(parsed.exercises)) {
    throw new Error("Extraction response did not contain an exercises array");
  }

  const exercises = parsed.exercises.map((exercise, index) =>
    normalizeExercise(sessionId, exercise, index)
  );
  if (exercises.some((exercise) => !exercise)) {
    throw new Error("Extraction response contained a malformed exercise");
  }

  return {
    sessionId,
    extractionVersion: EXTRACTION_VERSION,
    exercises: exercises.filter((exercise): exercise is ExerciseRecord => !!exercise),
    sessionNotes: stringArray(parsed.sessionNotes),
    techniqueThemes: stringArray(parsed.techniqueThemes),
    accomplishments: stringArray(parsed.accomplishments),
    improvementAreas: stringArray(parsed.improvementAreas),
    painObservations: painObservations(parsed.painObservations),
    nextSessionPlan: normalizeNextSessionPlan(parsed.nextSessionPlan),
    overallDifficulty: isRecord(parsed.overallDifficulty)
      ? (parsed.overallDifficulty as unknown as ExtractionOutput["overallDifficulty"])
      : undefined,
    energyLevel: isRecord(parsed.energyLevel)
      ? (parsed.energyLevel as unknown as ExtractionOutput["energyLevel"])
      : undefined,
    openQuestions: stringArray(parsed.openQuestions),
  };
}

export async function synthesizeWorkoutData(
  sessionId: string,
  distilledTranscript: string
): Promise<ExtractionOutput> {
  const text = await generateText({
    system: SYNTHESIS_SYSTEM_PROMPT,
    maxOutputTokens: 6144,
    prompt: `Synthesize the final workout record for session ${sessionId}.

DISTILLED WORKOUT TRANSCRIPT:
${distilledTranscript}

Return JSON matching this schema:
${OUTPUT_SCHEMA}`,
  });

  return parseExtractionResponse(sessionId, text);
}

export async function answerWorkoutQuestion(
  question: string,
  context: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<{ answer: string; citations: Array<{ sessionId: string; date: string; excerpt: string }> }> {
  const conversation = history.length > 0
    ? JSON.stringify(history)
    : "No previous messages.";
  const answer = await generateText({
    system: `You are a personal training assistant. Answer questions about the user's workout history concisely and accurately. Treat finalized session records and explicitly labeled computed totals as authoritative. Only state facts that are present in the provided context. Refer to supporting workouts by their human-readable date, never by an internal ID or UUID. Use simple Markdown with short headings, bullets, and bold emphasis when it improves readability. Do not infer facts from missing or unfinalized sessions.`,
    maxOutputTokens: 1024,
    prompt: `WORKOUT HISTORY CONTEXT:
${context}

PREVIOUS CONVERSATION:
${conversation}

QUESTION: ${question}

Answer the question based on the context above. Keep it concise and cite specific finalized sessions by date. Never expose internal session IDs.`,
  });

  return {
    answer,
    citations: [],
  };
}

export async function rewriteWorkoutQuestion(
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }>
): Promise<string> {
  if (history.length === 0) return question;

  const rewritten = await generateText({
    system: `Rewrite a follow-up workout-history question as a standalone retrieval query. Use the previous conversation only to resolve references such as exercises, dates, trainers, and "that session". Do not answer the question, add facts, or include commentary. Return only the rewritten query.`,
    maxOutputTokens: 180,
    prompt: `PREVIOUS CONVERSATION:
${JSON.stringify(history)}

FOLLOW-UP QUESTION:
${question}`,
  });

  return rewritten.trim().slice(0, 1_000) || question;
}
