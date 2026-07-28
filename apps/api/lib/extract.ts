import type { ExerciseRecord, ExtractionOutput, SourcedValue } from "@/lib/types";
import { generateText } from "@/lib/language-model";
import {
  BOUNDARY_RECONCILIATION_JSON_SCHEMA,
  EXTRACTION_JSON_SCHEMA,
} from "@/lib/structured-output-schemas";

const EXTRACTION_VERSION = "1.1-boundary";

const SYSTEM_PROMPT = `You are a workout data extraction assistant. Your job is to analyze a workout session transcript and extract structured exercise data.

Rules:
- Extract only information explicitly stated or strongly implied in the transcript
- Distinguish between COMPLETED exercises and PLANNED/FUTURE exercises
- "Next time try X" or "try X next session" means a next-session recommendation, NOT a completed set
- If a value is uncertain, use a low confidence score (0.0-0.5) and status "weakly_inferred"
- If a value is explicitly stated, use confidence 0.9+ and status "explicit"
- Never invent data that isn't in the transcript
- Body weight exercises have no weight value
- Record pain/discomfort observations without diagnosis
- Each transcript line starts with [mm:ss] — use these to estimate startedAtSeconds and endedAtSeconds for each exercise (convert mm:ss to total seconds). These are approximate — your best estimate is better than null.
- The transcript may include Chinese or English speech mixed together.
- Use a clear, conventional canonicalName when the exercise is identifiable, while retaining trainer-spoken wording in spokenNames. Do not force a guess when the movement is unclear.
- Capture completed set-by-set reps and weights when stated. Use approximate/weakly_inferred values only when the transcript supports them.
- Keep techniqueNotes and trainerNotes to personalized corrections, safety modifications, progression/regression guidance, or repeated emphasis. Omit generic exercise instructions that do not add session-specific value.
- When a transcript contains PRIMARY and CONTEXT ONLY sections, extract evidence only from PRIMARY. Use context to understand exercise continuity and references, but never count context-only sets, reps, weights, or cues again.

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

export async function extractWorkoutData(
  sessionId: string,
  transcript: string,
  scopeInstruction?: string
): Promise<ExtractionOutput> {
  const text = await generateText({
    system: SYSTEM_PROMPT,
    maxOutputTokens: 4096,
    jsonSchema: EXTRACTION_JSON_SCHEMA,
    schemaName: "workout_extraction",
    maxQueueWaitMs: 180_000,
    prompt: `Extract workout data from this session transcript. Session ID: ${sessionId}

TRANSCRIPT:
${transcript}

${scopeInstruction ? `WINDOW SCOPE:\n${scopeInstruction}\n` : ""}

Return JSON matching this schema:
${OUTPUT_SCHEMA}`,
  });

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/) ??
    text.match(/(\{[\s\S]+\})/);

  if (!jsonMatch) throw new Error("No JSON found in extraction response");

  const parsed = JSON.parse(jsonMatch[1]) as ExtractionOutput;
  parsed.extractionVersion = EXTRACTION_VERSION;
  parsed.sessionId = sessionId;

  return parsed;
}

// A single model call generating a full hour's structured JSON can approach the
// output and serverless time limits. Long sessions are split into time windows,
// extracted in parallel, and merged to keep each request bounded.
const EXTRACTION_WINDOW_SECONDS = 900; // 15 minutes
const EXTRACTION_CONTEXT_SECONDS = 90;
const BOUNDARY_RECONCILIATION_SECONDS = 180;

type WindowSegment = { startSeconds: number; text: string };

function formatSegment(segment: WindowSegment): string {
  const minutes = Math.floor(segment.startSeconds / 60);
  const seconds = Math.floor(segment.startSeconds % 60);
  return `[${minutes}:${seconds.toString().padStart(2, "0")}] ${segment.text}`;
}

function windowTranscript(segments: WindowSegment[]): string {
  return segments.map(formatSegment).join("\n");
}

function scopedWindowTranscript(windows: WindowSegment[][], index: number): string {
  const primary = windows[index];
  const primaryStart = primary[0].startSeconds;
  const nextStart = windows[index + 1]?.[0].startSeconds;
  const before = (windows[index - 1] ?? []).filter(
    (segment) => segment.startSeconds >= primaryStart - EXTRACTION_CONTEXT_SECONDS
  );
  const after = (windows[index + 1] ?? []).filter(
    (segment) => nextStart != null && segment.startSeconds < nextStart + EXTRACTION_CONTEXT_SECONDS
  );

  return [
    before.length ? `CONTEXT ONLY — BEFORE\n${windowTranscript(before)}` : null,
    `PRIMARY — EXTRACT EVIDENCE FROM THIS SECTION\n${windowTranscript(primary)}`,
    after.length ? `CONTEXT ONLY — AFTER\n${windowTranscript(after)}` : null,
  ]
    .filter((section): section is string => !!section)
    .join("\n\n");
}

export async function extractWorkoutDataWindowed(
  sessionId: string,
  segments: WindowSegment[]
): Promise<ExtractionOutput> {
  const lastStart = segments.length ? segments[segments.length - 1].startSeconds : 0;

  // Short sessions: a single call, unchanged behaviour.
  if (segments.length === 0 || lastStart <= EXTRACTION_WINDOW_SECONDS * 1.5) {
    return extractWorkoutData(sessionId, windowTranscript(segments));
  }

  // Split into contiguous time windows.
  const windows: WindowSegment[][] = [];
  let current: WindowSegment[] = [];
  let windowStart = segments[0].startSeconds;
  for (const s of segments) {
    if (s.startSeconds >= windowStart + EXTRACTION_WINDOW_SECONDS && current.length) {
      windows.push(current);
      current = [];
      windowStart = s.startSeconds;
    }
    current.push(s);
  }
  if (current.length) windows.push(current);

  const scopeInstruction =
    "Extract only work supported by the PRIMARY section. Use CONTEXT ONLY sections to identify an exercise that crosses the boundary and to resolve pronouns or continuation, but do not count context-only evidence. Preserve the global transcript timestamps.";
  const partials = await Promise.all(
    windows.map((_, index) =>
      extractWorkoutData(sessionId, scopedWindowTranscript(windows, index), scopeInstruction)
    )
  );
  const merged = mergeExtractions(sessionId, partials);
  const exercises = await reconcileBoundaryExercises(
    sessionId,
    segments,
    windows,
    partials
  );
  return {
    ...merged,
    extractionVersion: EXTRACTION_VERSION,
    exercises,
  };
}

function uniqueStrings(arr: string[]): string[] {
  return [...new Set(arr.filter((x) => x && x.trim()))];
}

function bestSourced(
  vals: (SourcedValue<number> | undefined)[]
): SourcedValue<number> | undefined {
  return vals
    .filter((v): v is SourcedValue<number> => !!v)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
}

function mergeExtractions(
  sessionId: string,
  partials: ExtractionOutput[]
): ExtractionOutput {
  const exercises = partials
    .flatMap((p) => p.exercises ?? [])
    .sort((a, b) => (a.startedAtSeconds ?? 0) - (b.startedAtSeconds ?? 0))
    .map((ex, i) => ({ ...ex, sequenceNumber: i + 1 }));

  const nextExercises = partials.flatMap((p) => p.nextSessionPlan?.exercises ?? []);
  const nextNotes = uniqueStrings(partials.flatMap((p) => p.nextSessionPlan?.generalNotes ?? []));

  return {
    sessionId,
    extractionVersion: EXTRACTION_VERSION,
    exercises,
    sessionNotes: uniqueStrings(partials.flatMap((p) => p.sessionNotes ?? [])),
    techniqueThemes: uniqueStrings(partials.flatMap((p) => p.techniqueThemes ?? [])),
    accomplishments: uniqueStrings(partials.flatMap((p) => p.accomplishments ?? [])),
    improvementAreas: uniqueStrings(partials.flatMap((p) => p.improvementAreas ?? [])),
    painObservations: partials.flatMap((p) => p.painObservations ?? []),
    nextSessionPlan:
      nextExercises.length || nextNotes.length
        ? { exercises: nextExercises, generalNotes: nextNotes, sourceSegmentIds: [] }
        : undefined,
    overallDifficulty: bestSourced(partials.map((p) => p.overallDifficulty)),
    energyLevel: bestSourced(partials.map((p) => p.energyLevel)),
    openQuestions: uniqueStrings(partials.flatMap((p) => p.openQuestions ?? [])),
  };
}

function boundaryTranscript(
  segments: WindowSegment[],
  boundarySeconds: number
): string {
  const before = segments.filter(
    (segment) =>
      segment.startSeconds >= boundarySeconds - BOUNDARY_RECONCILIATION_SECONDS &&
      segment.startSeconds < boundarySeconds
  );
  const after = segments.filter(
    (segment) =>
      segment.startSeconds >= boundarySeconds &&
      segment.startSeconds < boundarySeconds + BOUNDARY_RECONCILIATION_SECONDS
  );
  return [
    `THREE-MINUTE CONTEXT BEFORE BOUNDARY\n${windowTranscript(before)}`,
    `THREE-MINUTE CONTEXT AFTER BOUNDARY\n${windowTranscript(after)}`,
  ].join("\n\n");
}

function edgeExercise(
  extraction: ExtractionOutput,
  side: "left" | "right"
): ExerciseRecord | undefined {
  const exercises = [...(extraction.exercises ?? [])].sort(
    (left, right) =>
      (left.startedAtSeconds ?? 0) - (right.startedAtSeconds ?? 0)
  );
  return side === "left" ? exercises.at(-1) : exercises[0];
}

function isNearBoundary(
  exercise: ExerciseRecord,
  boundarySeconds: number,
  side: "left" | "right"
): boolean {
  const edge =
    side === "left"
      ? exercise.endedAtSeconds ?? exercise.startedAtSeconds
      : exercise.startedAtSeconds ?? exercise.endedAtSeconds;
  return (
    Number.isFinite(edge) &&
    Math.abs((edge as number) - boundarySeconds) <=
      BOUNDARY_RECONCILIATION_SECONDS
  );
}

function parseJsonObject(text: string): Record<string, unknown> {
  const jsonMatch =
    text.match(/```(?:json)?\s*([\s\S]+?)\s*```/) ??
    text.match(/(\{[\s\S]+\})/);
  if (!jsonMatch) throw new Error("No JSON found in boundary response");
  return JSON.parse(jsonMatch[1]) as Record<string, unknown>;
}

function isExerciseRecord(value: unknown): value is ExerciseRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.canonicalName === "string" &&
    Array.isArray(record.sets) &&
    Array.isArray(record.spokenNames) &&
    Array.isArray(record.trainerNotes)
  );
}

async function resolveBoundaryPair(
  sessionId: string,
  boundaryIndex: number,
  boundarySeconds: number,
  transcript: string,
  left: ExerciseRecord,
  right: ExerciseRecord
): Promise<ExerciseRecord | null> {
  const text = await generateText({
    system: `You reconcile workout extraction only at a transcript processing boundary.

Determine whether LEFT ENTRY and RIGHT ENTRY describe the same continuing exercise. Use only the supplied transcript evidence.

If they are different exercises, return sameExercise false and resolvedExercise null.
If they are the same exercise:
- Return one resolved exercise containing every distinct completed set exactly once.
- A set that starts before the boundary and finishes after it must appear once, using the completed total supported by the later evidence.
- Never add the earlier partial count as a separate set.
- Preserve genuinely separate sets on either side of the boundary.
- Preserve supported cues and notes, but do not add general exercise knowledge.

Return JSON only.`,
    maxOutputTokens: 4096,
    jsonSchema: BOUNDARY_RECONCILIATION_JSON_SCHEMA,
    schemaName: "boundary_reconciliation",
    maxQueueWaitMs: 180_000,
    prompt: `Session: ${sessionId}
Boundary ${boundaryIndex} at ${boundarySeconds} seconds.

BOUNDARY TRANSCRIPT:
${transcript}

LEFT ENTRY:
${JSON.stringify(left)}

RIGHT ENTRY:
${JSON.stringify(right)}

Return JSON:
{
  "sameExercise": true,
  "reason": "brief evidence-based explanation",
  "resolvedExercise": "one exercise object matching the exercises item in the extraction schema, or null"
}

EXTRACTION SCHEMA:
${OUTPUT_SCHEMA}`,
  });
  const parsed = parseJsonObject(text);
  if (parsed.sameExercise !== true) return null;
  if (!isExerciseRecord(parsed.resolvedExercise)) {
    throw new Error("Boundary response returned a malformed resolved exercise");
  }
  return parsed.resolvedExercise;
}

async function reconcileBoundaryExercises(
  sessionId: string,
  segments: WindowSegment[],
  windows: WindowSegment[][],
  partials: ExtractionOutput[]
): Promise<ExerciseRecord[]> {
  const entries = partials.flatMap((partial, windowIndex) =>
    (partial.exercises ?? []).map((exercise, exerciseIndex) => ({
      exercise: structuredClone(exercise),
      keys: [`${windowIndex}:${exerciseIndex}`],
    }))
  );

  for (let rightWindow = 1; rightWindow < windows.length; rightWindow += 1) {
    const boundarySeconds = windows[rightWindow][0]?.startSeconds;
    const leftOriginal = edgeExercise(partials[rightWindow - 1], "left");
    const rightOriginal = edgeExercise(partials[rightWindow], "right");
    if (
      !Number.isFinite(boundarySeconds) ||
      !leftOriginal ||
      !rightOriginal ||
      !isNearBoundary(leftOriginal, boundarySeconds, "left") ||
      !isNearBoundary(rightOriginal, boundarySeconds, "right")
    ) {
      continue;
    }

    const leftIndex = partials[rightWindow - 1].exercises.indexOf(leftOriginal);
    const rightIndex = partials[rightWindow].exercises.indexOf(rightOriginal);
    const leftKey = `${rightWindow - 1}:${leftIndex}`;
    const rightKey = `${rightWindow}:${rightIndex}`;
    const leftEntry = entries.find((entry) => entry.keys.includes(leftKey));
    const rightEntry = entries.find((entry) => entry.keys.includes(rightKey));
    if (!leftEntry || !rightEntry || leftEntry === rightEntry) continue;

    try {
      const resolved = await resolveBoundaryPair(
        sessionId,
        rightWindow,
        boundarySeconds,
        boundaryTranscript(segments, boundarySeconds),
        leftEntry.exercise,
        rightEntry.exercise
      );
      if (!resolved) continue;
      leftEntry.exercise = {
        ...resolved,
        id: leftEntry.exercise.id,
      };
      leftEntry.keys.push(...rightEntry.keys);
      entries.splice(entries.indexOf(rightEntry), 1);
    } catch (error) {
      console.warn(
        `Boundary reconciliation skipped for session ${sessionId} at ${boundarySeconds}s:`,
        error
      );
    }
  }

  return entries
    .map((entry) => entry.exercise)
    .sort(
      (left, right) =>
        (left.startedAtSeconds ?? 0) - (right.startedAtSeconds ?? 0)
    )
    .map((exercise, index) => ({
      ...exercise,
      sequenceNumber: index + 1,
    }));
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
