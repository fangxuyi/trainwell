import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionOutput, SourcedValue } from "@/lib/types";

let anthropic: Anthropic;
function getAnthropic() {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

const EXTRACTION_VERSION = "1.0";

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
  const message = await getAnthropic().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Extract workout data from this session transcript. Session ID: ${sessionId}

TRANSCRIPT:
${transcript}

${scopeInstruction ? `WINDOW SCOPE:\n${scopeInstruction}\n` : ""}

Return JSON matching this schema:
${OUTPUT_SCHEMA}`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = content.text.match(/```(?:json)?\s*([\s\S]+?)\s*```/) ??
    content.text.match(/(\{[\s\S]+\})/);

  if (!jsonMatch) throw new Error("No JSON found in extraction response");

  const parsed = JSON.parse(jsonMatch[1]) as ExtractionOutput;
  parsed.extractionVersion = EXTRACTION_VERSION;
  parsed.sessionId = sessionId;

  return parsed;
}

// A single Claude call generating a full hour's structured JSON runs close to
// the token cap (~60-70s of output generation) and blows the serverless
// timeout. For long sessions we split the transcript into time windows,
// extract each in parallel (each call is small and fast), and merge — which
// both fits the timeout and is faster wall-clock.
const EXTRACTION_WINDOW_SECONDS = 900; // 15 minutes
const EXTRACTION_CONTEXT_SECONDS = 90;

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
  return mergeExtractions(sessionId, partials);
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

// Merges per-window extractions into one. Exercises are kept (ordered by time,
// re-sequenced); string lists are concatenated + de-duped; session-level scalar
// values take the highest-confidence reading. An exercise that straddles a
// window boundary may appear twice — an acceptable, rare imperfection.
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

export async function answerWorkoutQuestion(
  question: string,
  context: string
): Promise<{ answer: string; citations: Array<{ sessionId: string; date: string; excerpt: string }> }> {
  const message = await getAnthropic().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `You are a personal training assistant. Answer questions about the user's workout history concisely and accurately. Only state facts that are present in the provided context. Cite the specific session when referencing workout data.`,
    messages: [
      {
        role: "user",
        content: `WORKOUT HISTORY CONTEXT:
${context}

QUESTION: ${question}

Answer the question based on the context above. Keep it concise and cite specific sessions.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  return {
    answer: content.text,
    citations: [],
  };
}
