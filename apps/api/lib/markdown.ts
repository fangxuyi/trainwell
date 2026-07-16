import type {
  ExtractionOutput,
  ExerciseRecord,
  ExerciseSet,
  TranscriptSegment,
} from "@/lib/types";

interface SessionRow {
  id: string;
  started_at: string;
  ended_at?: string;
  duration_seconds?: number;
  workout_type?: string;
  trainer_name?: string;
  location?: string;
  goals?: string[];
  audio_retention_policy: string;
}

function fmtTotalDuration(secs: number): string {
  const totalSeconds = Math.max(0, Math.round(secs));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function fmtExerciseDuration(seconds: number, isCombined: boolean): string {
  if (seconds < 30) return `~${Math.max(1, Math.round(seconds))} sec`;

  const minutes = Math.max(1, Math.round(seconds / 60));
  return `~${minutes} min${isCombined ? " total" : ""}`;
}

function fmtSetVolume(sets: ExerciseSet[]): string | null {
  if (sets.length === 0) return null;

  const reps = sets.map((set) => set.completedReps).filter((reps): reps is number => reps != null);
  const setLabel = `${sets.length} set${sets.length === 1 ? "" : "s"}`;
  if (reps.length === 0) return setLabel;

  const repValues = [...new Set(reps)];
  const repsText = repValues.length === 1 ? String(repValues[0]) : reps.join("/");
  return `${setLabel} × ${repsText} reps`;
}

function fmtWeights(sets: ExerciseSet[]): string | null {
  const weights = sets
    .map((set) => set.weight)
    .filter((weight): weight is NonNullable<ExerciseSet["weight"]> => !!weight)
    .map((weight) => `${weight.value} ${weight.unit}`);

  if (weights.length === 0) return null;
  const values = [...new Set(weights)];
  return `@ ${values.join("/")}`;
}

function bestCoachNote(exercises: ExerciseRecord[]): string | null {
  for (const exercise of exercises) {
    const note = exercise.techniqueNotes[0]?.text ?? exercise.trainerNotes[0]?.text;
    if (note) return note;
  }
  return null;
}

export function generateSummaryText(
  session: SessionRow,
  extraction: ExtractionOutput
): string {
  const date = new Date(session.started_at).toISOString().slice(0, 10);
  const completed = extraction.exercises.filter((exercise) => exercise.completed);
  const lines: string[] = [`WorkoutSummary ${date}`];
  const inferredDuration = completed.reduce(
    (latestEnd, exercise) => Math.max(latestEnd, exercise.endedAtSeconds ?? 0),
    0
  );
  const totalDuration = session.duration_seconds ?? inferredDuration;
  const completedExerciseCount = new Set(
    completed.map((exercise) => exercise.canonicalName.trim().toLocaleLowerCase())
  ).size;

  if (totalDuration > 0) {
    lines.push(`Total length: ${fmtTotalDuration(totalDuration)}`);
  }
  lines.push(`Exercises completed: ${completedExerciseCount}`, "");

  if (completed.length === 0) {
    lines.push("No exercises recorded.");
    return lines.join("\n");
  }

  const grouped = new Map<string, ExerciseRecord[]>();
  for (const exercise of completed) {
    const key = exercise.canonicalName.trim().toLocaleLowerCase();
    const existing = grouped.get(key) ?? [];
    existing.push(exercise);
    grouped.set(key, existing);
  }

  [...grouped.values()].forEach((exercises, index) => {
    const first = exercises[0];
    const sets = exercises.flatMap((exercise) => exercise.sets.filter((set) => set.completed));
    const durationSeconds = exercises.reduce((total, exercise) => {
      if (exercise.startedAtSeconds == null || exercise.endedAtSeconds == null) return total;
      return total + Math.max(0, exercise.endedAtSeconds - exercise.startedAtSeconds);
    }, 0);
    const details = [
      durationSeconds > 0 ? fmtExerciseDuration(durationSeconds, exercises.length > 1) : null,
      fmtSetVolume(sets),
      fmtWeights(sets),
    ].filter((detail): detail is string => !!detail);

    lines.push(`${index + 1}. ${first.canonicalName}${details.length ? `, ${details.join(", ")}` : ""}`);

    const cue = bestCoachNote(exercises);
    if (cue) lines.push(`- ${cue}`);

    lines.push("");
  });

  return lines.join("\n").trim();
}

export function generateMarkdown(
  session: SessionRow,
  extraction: ExtractionOutput,
  transcriptSegments: TranscriptSegment[]
): string {
  const date = new Date(session.started_at);
  const dateStr = date.toISOString().split("T")[0];
  const timeStr = date.toTimeString().slice(0, 5).replace(":", "");
  const slug = (session.workout_type ?? "workout")
    .toLowerCase()
    .replace(/\s+/g, "-");
  const filename = `${dateStr}_${timeStr}_${slug}.md`;

  const durationMin = session.duration_seconds
    ? Math.round(session.duration_seconds / 60)
    : null;

  const lines: string[] = [];

  // Front matter
  lines.push("---");
  lines.push(`session_id: ${session.id}`);
  lines.push(`date: ${dateStr}`);
  lines.push(`start_time: "${date.toTimeString().slice(0, 5)}"`);
  if (session.ended_at) {
    lines.push(
      `end_time: "${new Date(session.ended_at).toTimeString().slice(0, 5)}"`
    );
  }
  if (durationMin) lines.push(`duration_minutes: ${durationMin}`);
  if (session.workout_type)
    lines.push(`workout_type: ${session.workout_type}`);
  if (session.trainer_name) lines.push(`trainer: ${session.trainer_name}`);
  lines.push(`status: review_required`);
  lines.push(`audio_retention: ${session.audio_retention_policy}`);
  lines.push("---");
  lines.push("");

  lines.push("# Workout Summary");
  lines.push("");
  lines.push("## Session Overview");
  lines.push("");
  lines.push(
    `- **Date:** ${date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`
  );
  if (durationMin) lines.push(`- **Duration:** ${durationMin} minutes`);
  if (session.workout_type)
    lines.push(`- **Workout Type:** ${session.workout_type}`);
  if (session.trainer_name) lines.push(`- **Trainer:** ${session.trainer_name}`);
  if (session.goals && session.goals.length > 0)
    lines.push(`- **Goal:** ${session.goals.join(", ")}`);
  if (extraction.overallDifficulty)
    lines.push(
      `- **Overall Difficulty:** ${extraction.overallDifficulty.value}/10`
    );
  if (extraction.energyLevel)
    lines.push(`- **Energy Level:** ${extraction.energyLevel.value}/10`);
  lines.push("");

  // Exercises
  const completed = extraction.exercises.filter((e) => e.completed);
  if (completed.length > 0) {
    lines.push("## Exercises Completed");
    lines.push("");
    completed.forEach((ex, idx) => {
      lines.push(`### ${idx + 1}. ${ex.canonicalName}`);
      lines.push("");
      if (ex.equipment.length > 0)
        lines.push(`- **Equipment:** ${ex.equipment.join(", ")}`);
      if (ex.sets.length > 0) {
        const totalSets = ex.sets.filter((s) => s.completed).length;
        lines.push(`- **Sets:** ${totalSets}`);
        const reps = ex.sets.map((s) => s.completedReps ?? "?").join(", ");
        if (reps !== "?, ".repeat(ex.sets.length - 1) + "?")
          lines.push(`- **Reps:** ${reps}`);
        const weight = ex.sets[0]?.weight;
        if (weight) lines.push(`- **Weight:** ${weight.value} ${weight.unit}`);
        const rest = ex.sets.find((s) => s.restAfterSeconds)?.restAfterSeconds;
        if (rest) lines.push(`- **Rest:** ${rest} seconds`);
      }
      lines.push(`- **Completion:** Completed`);
      lines.push("");

      // Set table
      if (ex.sets.length > 0) {
        lines.push("#### Set Details");
        lines.push("");
        lines.push("| Set | Weight | Reps | Rest | RPE | Notes |");
        lines.push("|---|---:|---:|---:|---:|---|");
        ex.sets.forEach((s) => {
          const w = s.weight ? `${s.weight.value} ${s.weight.unit}` : "—";
          const reps = s.completedReps ?? "—";
          const rest = s.restAfterSeconds ? `${s.restAfterSeconds}s` : "—";
          const rpe = s.rpe ?? "—";
          const notes = [
            ...s.userNotes.map((n) => n.text),
            ...s.trainerNotes.map((n) => n.text),
          ].join("; ") || "—";
          lines.push(
            `| ${s.setNumber} | ${w} | ${reps} | ${rest} | ${rpe} | ${notes} |`
          );
        });
        lines.push("");
      }

      // Technique notes
      if (ex.techniqueNotes.length > 0) {
        lines.push("#### Technique Notes");
        lines.push("");
        ex.techniqueNotes.forEach((n) => lines.push(`- ${n.text}`));
        lines.push("");
      }

      // Pain
      if (ex.painObservations.length > 0) {
        lines.push("#### Discomfort");
        lines.push("");
        ex.painObservations.forEach((p) =>
          lines.push(`- ${p.bodyPart ? `${p.bodyPart}: ` : ""}${p.description}`)
        );
        lines.push("");
      }

      // Progression
      if (ex.progressionSuggestion) {
        lines.push(
          `> **Next session:** ${ex.progressionSuggestion.text}`
        );
        lines.push("");
      }
    });
  }

  // Session notes
  if (extraction.sessionNotes.length > 0) {
    lines.push("## Session Notes");
    lines.push("");
    extraction.sessionNotes.forEach((n) => lines.push(`- ${n}`));
    lines.push("");
  }

  // Pain observations
  if (extraction.painObservations.length > 0) {
    lines.push("## Pain or Discomfort");
    lines.push("");
    extraction.painObservations.forEach((p) =>
      lines.push(
        `- ${p.bodyPart ? `**${p.bodyPart}:** ` : ""}${p.description}`
      )
    );
    lines.push("");
  }

  // Accomplishments
  if (extraction.accomplishments.length > 0) {
    lines.push("## What Went Well");
    lines.push("");
    extraction.accomplishments.forEach((a) => lines.push(`- ${a}`));
    lines.push("");
  }

  // Improvement areas
  if (extraction.improvementAreas.length > 0) {
    lines.push("## What Needs Improvement");
    lines.push("");
    extraction.improvementAreas.forEach((a) => lines.push(`- ${a}`));
    lines.push("");
  }

  // Next session plan
  if (extraction.nextSessionPlan) {
    lines.push("## Plan for Next Session");
    lines.push("");
    extraction.nextSessionPlan.exercises.forEach((ex) => {
      let line = `- **${ex.exerciseName}**`;
      if (ex.targetSets) line += ` — ${ex.targetSets} sets`;
      if (ex.targetReps) line += ` × ${ex.targetReps} reps`;
      if (ex.targetWeight) line += ` @ ${ex.targetWeight}`;
      lines.push(line);
      ex.notes.forEach((n) => lines.push(`  - ${n}`));
    });
    extraction.nextSessionPlan.generalNotes.forEach((n) =>
      lines.push(`- ${n}`)
    );
    lines.push("");
  }

  // Open questions
  if (extraction.openQuestions && extraction.openQuestions.length > 0) {
    lines.push("## Open Questions");
    lines.push("");
    extraction.openQuestions.forEach((q) => lines.push(`- ${q}`));
    lines.push("");
  }

  lines.push("## Source Notes");
  lines.push("");
  lines.push(
    "This summary was generated from the session transcript and requires user review."
  );

  return lines.join("\n");
}
