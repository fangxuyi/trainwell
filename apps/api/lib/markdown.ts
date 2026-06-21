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

function fmtTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function generateSummaryText(
  session: SessionRow,
  extraction: ExtractionOutput
): string {
  const date = new Date(session.started_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const lines: string[] = [`Workout Summary for ${date}`, ""];

  const completed = extraction.exercises.filter((e) => e.completed);

  if (completed.length === 0) {
    lines.push("No exercises recorded.");
    return lines.join("\n");
  }

  completed.forEach((ex, idx) => {
    const timeRange =
      ex.startedAtSeconds != null && ex.endedAtSeconds != null
        ? `, ${fmtTime(ex.startedAtSeconds)}-${fmtTime(ex.endedAtSeconds)}`
        : "";

    const completedSets = ex.sets.filter((s) => s.completed);
    const totalSets = completedSets.length;
    const firstSet = completedSets[0];
    let volume = "";
    if (totalSets > 0) {
      volume += `, ${totalSets} set${totalSets !== 1 ? "s" : ""}`;
      const reps = firstSet?.completedReps;
      if (reps != null) volume += ` × ${reps} reps`;
      const w = firstSet?.weight;
      if (w) volume += ` @ ${w.value}${w.unit}`;
    }

    lines.push(`${idx + 1}. ${ex.canonicalName}${timeRange}${volume}`);

    const cue =
      ex.techniqueNotes[0]?.text ??
      ex.trainerNotes[0]?.text ??
      ex.userNotes[0]?.text;
    if (cue) lines.push(`- ${cue}`);

    lines.push("");
  });

  if (extraction.sessionNotes.length > 0) {
    lines.push(`Note: ${extraction.sessionNotes[0]}`);
  }

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
