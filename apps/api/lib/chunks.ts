import type { ExtractionOutput } from "@/lib/types";

export interface SessionChunk {
  chunkType: string;
  content: string;
}

interface SessionMeta {
  id: string;
  started_at: string;
  duration_seconds?: number | null;
  workout_type?: string | null;
  trainer_name?: string | null;
}

export function chunkExtraction(
  session: SessionMeta,
  extraction: ExtractionOutput
): SessionChunk[] {
  const chunks: SessionChunk[] = [];
  const date = new Date(session.started_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const durationMin = session.duration_seconds
    ? Math.round(session.duration_seconds / 60)
    : null;

  // Overview chunk
  const overviewLines = [
    `Session date: ${date}`,
    durationMin ? `Duration: ${durationMin} minutes` : null,
    session.workout_type ? `Workout type: ${session.workout_type}` : null,
    session.trainer_name ? `Trainer: ${session.trainer_name}` : null,
    extraction.overallDifficulty
      ? `Overall difficulty: ${extraction.overallDifficulty.value}/10`
      : null,
    extraction.sessionNotes.length > 0
      ? `Session notes: ${extraction.sessionNotes.join("; ")}`
      : null,
    extraction.techniqueThemes.length > 0
      ? `Technique themes: ${extraction.techniqueThemes.join("; ")}`
      : null,
    extraction.accomplishments.length > 0
      ? `Accomplishments: ${extraction.accomplishments.join("; ")}`
      : null,
    extraction.improvementAreas.length > 0
      ? `Areas for improvement: ${extraction.improvementAreas.join("; ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  chunks.push({ chunkType: "overview", content: overviewLines });

  // One chunk per completed exercise
  for (const ex of extraction.exercises.filter((e) => e.completed)) {
    const lines = [`Exercise: ${ex.canonicalName}`];
    if (ex.equipment.length > 0) lines.push(`Equipment: ${ex.equipment.join(", ")}`);

    const completedSets = ex.sets.filter((s) => s.completed);
    if (completedSets.length > 0) {
      lines.push(`Sets completed: ${completedSets.length}`);
      const firstSet = completedSets[0];
      if (firstSet?.completedReps != null) lines.push(`Reps: ${firstSet.completedReps}`);
      if (firstSet?.weight) lines.push(`Weight: ${firstSet.weight.value}${firstSet.weight.unit}`);
    }

    const notes = [
      ...ex.techniqueNotes.map((n) => n.text),
      ...ex.trainerNotes.map((n) => n.text),
    ];
    if (notes.length > 0) lines.push(`Cues: ${notes.join("; ")}`);

    if (ex.painObservations.length > 0) {
      lines.push(
        `Discomfort: ${ex.painObservations.map((p) => `${p.bodyPart ?? ""} ${p.description}`).join("; ")}`
      );
    }

    chunks.push({
      chunkType: "exercise",
      content: `Session: ${date}\n${lines.join("\n")}`,
    });
  }

  // Next session plan chunk
  if (extraction.nextSessionPlan) {
    const planLines = [
      `Next session plan (from session on ${date}):`,
      ...extraction.nextSessionPlan.exercises.map(
        (e) =>
          `- ${e.exerciseName}${e.targetSets ? ` ${e.targetSets} sets` : ""}${e.targetReps ? ` × ${e.targetReps} reps` : ""}${e.targetWeight ? ` @ ${e.targetWeight}` : ""}`
      ),
      ...extraction.nextSessionPlan.generalNotes,
    ];
    chunks.push({ chunkType: "next_plan", content: planLines.join("\n") });
  }

  return chunks;
}

export function chunkMarkdown(
  session: SessionMeta,
  markdown: string
): SessionChunk[] {
  const chunks: SessionChunk[] = [];
  const date = new Date(session.started_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Split markdown on H2/H3 headers, keeping each section as a chunk
  const sections = markdown.split(/\n(?=#{1,3} )/);

  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed.length < 30) continue; // skip tiny sections

    // Cap each chunk at ~1500 chars so embeddings stay focused
    if (trimmed.length <= 1500) {
      chunks.push({
        chunkType: "markdown_section",
        content: `Session: ${date}\n${trimmed}`,
      });
    } else {
      // Split long sections into ~1500 char chunks on paragraph boundaries
      const paras = trimmed.split(/\n{2,}/);
      let buf = `Session: ${date}\n`;
      for (const para of paras) {
        if (buf.length + para.length > 1500 && buf.length > 100) {
          chunks.push({ chunkType: "markdown_section", content: buf.trim() });
          buf = `Session: ${date}\n`;
        }
        buf += para + "\n\n";
      }
      if (buf.trim().length > 50) {
        chunks.push({ chunkType: "markdown_section", content: buf.trim() });
      }
    }
  }

  return chunks.length > 0
    ? chunks
    : [{ chunkType: "markdown_section", content: `Session: ${date}\n${markdown.slice(0, 1500)}` }];
}
