import { generateText } from "@/lib/language-model";

const DISTILLATION_VERSION = "1.1-candidate-ready";
const DISTILLATION_WINDOW_SECONDS = 900;
const DISTILLATION_CONTEXT_SECONDS = 90;

export type TranscriptWindowSegment = {
  startSeconds: number;
  text: string;
};

export type DistilledExerciseStatus =
  | "performed"
  | "active_instruction"
  | "planned_future"
  | "mentioned_only"
  | "unclear";

type DistilledSet = {
  setNumber?: number;
  status: "completed" | "planned" | "unclear";
  reps?: number;
  weightValue?: number;
  weightUnit?: string;
  durationSeconds?: number;
  restAfterSeconds?: number;
  rpe?: number;
  evidence: string[];
};

export type ExerciseDatasetCandidate = {
  datasetId?: string;
  name: string;
  equipment?: string;
  target?: string;
  bodyPart?: string;
  category?: string;
  muscleGroup?: string;
  score: number;
  recommended: boolean;
  reasons: string[];
};

export type DistilledExercise = {
  evidenceId: string;
  name: string;
  spokenNames: string[];
  movementDescription?: string;
  bodyRegions: string[];
  category?: string;
  startedAtSeconds?: number;
  endedAtSeconds?: number;
  status: DistilledExerciseStatus;
  equipment: string[];
  sets: DistilledSet[];
  cues: string[];
  userObservations: string[];
  painObservations: string[];
  progressionSuggestions: string[];
  confidence: number;
  datasetCandidates: ExerciseDatasetCandidate[];
};

type DistilledSessionSignal = {
  type:
    | "accomplishment"
    | "improvement"
    | "pain"
    | "next_session"
    | "difficulty"
    | "energy"
    | "general";
  text: string;
  timestampSeconds?: number;
};

export type DistilledWorkoutTranscript = {
  sessionId: string;
  distillationVersion: string;
  exercises: DistilledExercise[];
  sessionSignals: DistilledSessionSignal[];
};

const DISTILLATION_SYSTEM_PROMPT = `You are the evidence-distillation stage of a workout processing pipeline. Convert a timestamped workout transcript into a compact exercise timeline for another model to synthesize later.

Rules:
- Extract facts and transcript-supported observations only. Do not write a workout recap or infer overall themes.
- Identify each exercise, its neutral movement description, body regions, approximate start and end time, completion status, sets, reps, weight, duration, equipment, personalized coaching cues, user observations, pain, and progression suggestions when supported.
- Describe the movement mechanics concisely when they are stated or directly observable from the conversation. Do not fill in generic textbook instructions.
- Include body regions and category only when the transcript supports them. Do not infer them solely from general knowledge of an exercise name.
- Keep cues specific to this session. Omit generic instructions and unrelated conversation.
- Classify every exercise as performed, active_instruction, planned_future, mentioned_only, or unclear.
- Use performed only when the transcript contains action evidence such as counted reps, completed sets, weight being used, ongoing form corrections during execution, or explicit completion language.
- Use active_instruction when the trainer is setting up or directly instructing the movement for the current session but performance is not yet confirmed.
- Use planned_future for an exercise proposed for later or a future session.
- Use mentioned_only for examples, comparisons, stories, another person's training, or an exercise discussed without current instruction or execution.
- Use unclear when there is not enough context to choose another classification. Do not upgrade unclear or mentioned_only to performed.
- Preserve trainer-spoken exercise names. Use a conventional exercise name only when identifiable; otherwise use the clearest transcript wording.
- Never invent missing sets, reps, weights, times, cues, or outcomes.
- The transcript may mix Chinese and English. Produce concise English evidence without changing measurements.
- When PRIMARY and CONTEXT ONLY sections are present, extract evidence only from PRIMARY. Context may resolve continuity or references but must never be counted again.
- Return only valid JSON matching the supplied schema.`;

const DISTILLATION_SCHEMA = `{
  "exercises": [
    {
      "evidenceId": "short stable label",
      "name": "exercise name",
      "spokenNames": ["trainer wording"],
      "movementDescription": "neutral transcript-supported movement description",
      "bodyRegions": ["body region mentioned or clearly described"],
      "category": "strength | mobility | balance | cardio | recovery | other | null",
      "startedAtSeconds": 0,
      "endedAtSeconds": 120,
      "status": "performed | active_instruction | planned_future | mentioned_only | unclear",
      "equipment": ["equipment"],
      "sets": [
        {
          "setNumber": 1,
          "status": "completed | planned | unclear",
          "reps": 10,
          "weightValue": 25,
          "weightUnit": "lb",
          "durationSeconds": null,
          "restAfterSeconds": null,
          "rpe": null,
          "evidence": ["concise supporting fact"]
        }
      ],
      "cues": ["personalized trainer cue"],
      "userObservations": ["user-reported observation"],
      "painObservations": ["non-diagnostic discomfort observation"],
      "progressionSuggestions": ["future progression or regression"],
      "confidence": 0.9
    }
  ],
  "sessionSignals": [
    {
      "type": "accomplishment | improvement | pain | next_session | difficulty | energy | general",
      "text": "concise transcript-supported statement",
      "timestampSeconds": 120
    }
  ]
}`;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(optionalString).filter((item): item is string => !!item);
}

function parseJsonObject(text: string): JsonRecord {
  const jsonMatch =
    text.match(/```(?:json)?\s*([\s\S]+?)\s*```/) ?? text.match(/(\{[\s\S]+\})/);
  if (!jsonMatch) throw new Error("No JSON found in transcript distillation response");

  const parsed: unknown = JSON.parse(jsonMatch[1]);
  if (!isRecord(parsed)) throw new Error("Transcript distillation response was not an object");
  return parsed;
}

function normalizeSetStatus(value: unknown): "completed" | "planned" | "unclear" {
  if (value === "completed" || value === "planned") return value;
  return "unclear";
}

function normalizeExerciseStatus(value: unknown): DistilledExerciseStatus {
  if (
    value === "performed" ||
    value === "active_instruction" ||
    value === "planned_future" ||
    value === "mentioned_only"
  ) {
    return value;
  }
  return "unclear";
}

function normalizeSet(value: unknown, index: number): DistilledSet | null {
  if (!isRecord(value)) return null;
  return {
    setNumber: optionalNumber(value.setNumber) ?? index + 1,
    status: normalizeSetStatus(value.status),
    reps: optionalNumber(value.reps),
    weightValue: optionalNumber(value.weightValue),
    weightUnit: optionalString(value.weightUnit),
    durationSeconds: optionalNumber(value.durationSeconds),
    restAfterSeconds: optionalNumber(value.restAfterSeconds),
    rpe: optionalNumber(value.rpe),
    evidence: stringArray(value.evidence),
  };
}

function normalizeExercise(
  value: unknown,
  windowIndex: number,
  exerciseIndex: number
): DistilledExercise | null {
  if (!isRecord(value)) return null;
  const name = optionalString(value.name);
  if (!name) return null;
  const sets = Array.isArray(value.sets)
    ? value.sets
        .map((set, index) => normalizeSet(set, index))
        .filter((set): set is DistilledSet => !!set)
    : [];

  return {
    evidenceId:
      optionalString(value.evidenceId) ?? `window-${windowIndex + 1}-exercise-${exerciseIndex + 1}`,
    name,
    spokenNames: stringArray(value.spokenNames),
    movementDescription: optionalString(value.movementDescription),
    bodyRegions: stringArray(value.bodyRegions),
    category: optionalString(value.category),
    startedAtSeconds: optionalNumber(value.startedAtSeconds),
    endedAtSeconds: optionalNumber(value.endedAtSeconds),
    status: normalizeExerciseStatus(value.status),
    equipment: stringArray(value.equipment),
    sets,
    cues: stringArray(value.cues),
    userObservations: stringArray(value.userObservations),
    painObservations: stringArray(value.painObservations),
    progressionSuggestions: stringArray(value.progressionSuggestions),
    confidence: Math.min(1, Math.max(0, optionalNumber(value.confidence) ?? 0.5)),
    datasetCandidates: [],
  };
}

function normalizeSignal(value: unknown): DistilledSessionSignal | null {
  if (!isRecord(value)) return null;
  const text = optionalString(value.text);
  if (!text) return null;
  const allowedTypes = new Set<DistilledSessionSignal["type"]>([
    "accomplishment",
    "improvement",
    "pain",
    "next_session",
    "difficulty",
    "energy",
    "general",
  ]);
  const type = optionalString(value.type);
  return {
    type: type && allowedTypes.has(type as DistilledSessionSignal["type"])
      ? (type as DistilledSessionSignal["type"])
      : "general",
    text,
    timestampSeconds: optionalNumber(value.timestampSeconds),
  };
}

function formatSegment(segment: TranscriptWindowSegment): string {
  const minutes = Math.floor(segment.startSeconds / 60);
  const seconds = Math.floor(segment.startSeconds % 60);
  return `[${minutes}:${seconds.toString().padStart(2, "0")}] ${segment.text}`;
}

function formatWindow(segments: TranscriptWindowSegment[]): string {
  return segments.map(formatSegment).join("\n");
}

function scopedWindowTranscript(
  windows: TranscriptWindowSegment[][],
  index: number
): string {
  const primary = windows[index];
  const primaryStart = primary[0].startSeconds;
  const nextStart = windows[index + 1]?.[0].startSeconds;
  const before = (windows[index - 1] ?? []).filter(
    (segment) => segment.startSeconds >= primaryStart - DISTILLATION_CONTEXT_SECONDS
  );
  const after = (windows[index + 1] ?? []).filter(
    (segment) =>
      nextStart != null && segment.startSeconds < nextStart + DISTILLATION_CONTEXT_SECONDS
  );

  return [
    before.length ? `CONTEXT ONLY — BEFORE\n${formatWindow(before)}` : null,
    `PRIMARY — EXTRACT EVIDENCE FROM THIS SECTION\n${formatWindow(primary)}`,
    after.length ? `CONTEXT ONLY — AFTER\n${formatWindow(after)}` : null,
  ]
    .filter((section): section is string => !!section)
    .join("\n\n");
}

async function distillWindow(
  sessionId: string,
  transcript: string,
  windowIndex: number
): Promise<DistilledWorkoutTranscript> {
  const text = await generateText({
    system: DISTILLATION_SYSTEM_PROMPT,
    maxOutputTokens: 4096,
    prompt: `Distill workout evidence for session ${sessionId}, window ${windowIndex + 1}.

TRANSCRIPT:
${transcript}

Return JSON matching this schema:
${DISTILLATION_SCHEMA}`,
  });
  const parsed = parseJsonObject(text);
  const exercises = Array.isArray(parsed.exercises)
    ? parsed.exercises
        .map((exercise, index) => normalizeExercise(exercise, windowIndex, index))
        .filter((exercise): exercise is DistilledExercise => !!exercise)
    : [];
  const sessionSignals = Array.isArray(parsed.sessionSignals)
    ? parsed.sessionSignals
        .map(normalizeSignal)
        .filter((signal): signal is DistilledSessionSignal => !!signal)
    : [];

  return {
    sessionId,
    distillationVersion: DISTILLATION_VERSION,
    exercises,
    sessionSignals,
  };
}

export async function distillWorkoutTranscriptWindowed(
  sessionId: string,
  segments: TranscriptWindowSegment[]
): Promise<DistilledWorkoutTranscript> {
  if (segments.length === 0) {
    return {
      sessionId,
      distillationVersion: DISTILLATION_VERSION,
      exercises: [],
      sessionSignals: [],
    };
  }

  const windows: TranscriptWindowSegment[][] = [];
  let current: TranscriptWindowSegment[] = [];
  let windowStart = segments[0].startSeconds;
  for (const segment of segments) {
    if (
      segment.startSeconds >= windowStart + DISTILLATION_WINDOW_SECONDS &&
      current.length > 0
    ) {
      windows.push(current);
      current = [];
      windowStart = segment.startSeconds;
    }
    current.push(segment);
  }
  if (current.length > 0) windows.push(current);

  const partials = await Promise.all(
    windows.map((window, index) =>
      distillWindow(
        sessionId,
        windows.length === 1 ? formatWindow(window) : scopedWindowTranscript(windows, index),
        index
      )
    )
  );

  return {
    sessionId,
    distillationVersion: DISTILLATION_VERSION,
    exercises: partials
      .flatMap((partial) => partial.exercises)
      .sort((left, right) =>
        (left.startedAtSeconds ?? Number.MAX_SAFE_INTEGER) -
        (right.startedAtSeconds ?? Number.MAX_SAFE_INTEGER)
      ),
    sessionSignals: partials
      .flatMap((partial) => partial.sessionSignals)
      .sort((left, right) =>
        (left.timestampSeconds ?? Number.MAX_SAFE_INTEGER) -
        (right.timestampSeconds ?? Number.MAX_SAFE_INTEGER)
      ),
  };
}

function formatOptionalNumber(value: number | undefined): string {
  return value == null ? "unknown" : String(value);
}

export function formatDistilledWorkoutTranscript(
  distilled: DistilledWorkoutTranscript
): string {
  const synthesisExercises = distilled.exercises.filter(
    (exercise) => exercise.status !== "mentioned_only"
  );
  const lines = [
    `DISTILLED WORKOUT TRANSCRIPT v${distilled.distillationVersion}`,
    `Session: ${distilled.sessionId}`,
    "",
    "EXERCISE TIMELINE",
  ];

  if (synthesisExercises.length === 0) lines.push("No actionable exercise evidence identified.");

  synthesisExercises.forEach((exercise, index) => {
    lines.push(
      "",
      `Exercise evidence ${index + 1}: ${exercise.name}`,
      `Evidence ID: ${exercise.evidenceId}`,
      `Time: ${formatOptionalNumber(exercise.startedAtSeconds)}-${formatOptionalNumber(exercise.endedAtSeconds)} seconds`,
      `Status: ${exercise.status}`,
      `Confidence: ${exercise.confidence}`
    );
    if (exercise.spokenNames.length > 0) {
      lines.push(`Spoken names: ${exercise.spokenNames.join("; ")}`);
    }
    if (exercise.movementDescription) {
      lines.push(`Movement description: ${exercise.movementDescription}`);
    }
    if (exercise.bodyRegions.length > 0) {
      lines.push(`Body regions: ${exercise.bodyRegions.join("; ")}`);
    }
    if (exercise.category) lines.push(`Category: ${exercise.category}`);
    if (exercise.equipment.length > 0) {
      lines.push(`Equipment: ${exercise.equipment.join("; ")}`);
    }
    if (exercise.datasetCandidates.length > 0) {
      lines.push("Dataset candidates (retrieval hints, not transcript evidence):");
      exercise.datasetCandidates.forEach((candidate, candidateIndex) => {
        const metadata = [
          candidate.equipment ? `equipment=${candidate.equipment}` : null,
          candidate.target ? `target=${candidate.target}` : null,
          candidate.bodyPart ? `body=${candidate.bodyPart}` : null,
          candidate.category ? `category=${candidate.category}` : null,
          candidate.muscleGroup ? `muscle=${candidate.muscleGroup}` : null,
        ].filter((item): item is string => !!item);
        lines.push(
          `- Candidate ${candidateIndex + 1}: ${candidate.name} ` +
            `(datasetId=${candidate.datasetId ?? "unknown"}, score=${candidate.score.toFixed(3)}, ` +
            `recommended=${candidate.recommended})`
        );
        if (metadata.length > 0) lines.push(`  Metadata: ${metadata.join(", ")}`);
        if (candidate.reasons.length > 0) {
          lines.push(`  Match reasons: ${candidate.reasons.join("; ")}`);
        }
      });
    } else {
      lines.push("Dataset candidates: none sufficiently relevant");
    }
    exercise.sets.forEach((set) => {
      const details = [
        `status=${set.status}`,
        set.reps != null ? `reps=${set.reps}` : null,
        set.weightValue != null
          ? `weight=${set.weightValue}${set.weightUnit ? ` ${set.weightUnit}` : ""}`
          : null,
        set.durationSeconds != null ? `duration=${set.durationSeconds}s` : null,
        set.restAfterSeconds != null ? `rest=${set.restAfterSeconds}s` : null,
        set.rpe != null ? `rpe=${set.rpe}` : null,
      ].filter((detail): detail is string => !!detail);
      lines.push(`Set ${set.setNumber ?? "?"}: ${details.join(", ")}`);
      set.evidence.forEach((evidence) => lines.push(`- Set evidence: ${evidence}`));
    });
    exercise.cues.forEach((cue) => lines.push(`- Trainer cue: ${cue}`));
    exercise.userObservations.forEach((note) => lines.push(`- User observation: ${note}`));
    exercise.painObservations.forEach((note) => lines.push(`- Pain observation: ${note}`));
    exercise.progressionSuggestions.forEach((note) =>
      lines.push(`- Progression suggestion: ${note}`)
    );
  });

  lines.push("", "SESSION-LEVEL EVIDENCE");
  if (distilled.sessionSignals.length === 0) lines.push("No session-level evidence identified.");
  distilled.sessionSignals.forEach((signal) => {
    const timestamp = signal.timestampSeconds == null ? "unknown" : `${signal.timestampSeconds}s`;
    lines.push(`- [${signal.type} at ${timestamp}] ${signal.text}`);
  });

  return lines.join("\n");
}
