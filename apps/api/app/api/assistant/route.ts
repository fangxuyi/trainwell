import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
import { answerWorkoutQuestion } from "@/lib/extract";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { question } = await req.json();
  if (!question?.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const sessions = await sql`
    SELECT id, started_at, ended_at, duration_seconds, workout_type,
           trainer_name, exercises, session_notes, technique_themes,
           accomplishments, improvement_areas, overall_difficulty,
           energy_level, next_session_plan, markdown_content
    FROM sessions
    WHERE remote_status IN ('review_required', 'finalized')
    ORDER BY started_at DESC
    LIMIT 20
  `;

  const context = sessions
    .map((s) => {
      const date = new Date(s.started_at as string).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      const durationMin = s.duration_seconds
        ? Math.round((s.duration_seconds as number) / 60)
        : null;

      const header = `=== Session ${s.id} | ${date}${durationMin ? ` | ${durationMin} min` : ""} | ${s.workout_type ?? "Workout"}${s.trainer_name ? ` with ${s.trainer_name}` : ""} ===`;

      // Imported sessions: use full markdown content as context
      if (s.markdown_content && typeof s.markdown_content === "string") {
        return `${header}\n${s.markdown_content}`;
      }

      // Recorded sessions: use structured extraction data
      const exercises: Array<{
        canonicalName: string;
        completed: boolean;
        sets: Array<{
          completed: boolean;
          completedReps?: number;
          weight?: { value: number; unit: string };
        }>;
        techniqueNotes: Array<{ text: string }>;
        trainerNotes: Array<{ text: string }>;
      }> = Array.isArray(s.exercises) ? s.exercises as typeof exercises : [];

      const lines: string[] = [header];

      if (s.overall_difficulty != null) {
        lines.push(`Difficulty: ${s.overall_difficulty}/10`);
      }

      const completed = exercises.filter((e) => e.completed);
      if (completed.length > 0) {
        lines.push("Exercises:");
        completed.forEach((ex, i) => {
          const sets = ex.sets.filter((s) => s.completed);
          const reps = sets[0]?.completedReps;
          const weight = sets[0]?.weight;
          let line = `  ${i + 1}. ${ex.canonicalName} — ${sets.length} sets`;
          if (reps != null) line += ` × ${reps} reps`;
          if (weight) line += ` @ ${weight.value}${weight.unit}`;
          lines.push(line);
          const cue = ex.techniqueNotes[0]?.text ?? ex.trainerNotes[0]?.text;
          if (cue) lines.push(`     Cue: ${cue}`);
        });
      }

      const notes = Array.isArray(s.session_notes) ? s.session_notes as string[] : [];
      if (notes.length > 0) lines.push(`Notes: ${notes.join("; ")}`);

      const accomplishments = Array.isArray(s.accomplishments) ? s.accomplishments as string[] : [];
      if (accomplishments.length > 0) lines.push(`Wins: ${accomplishments.join("; ")}`);

      return lines.join("\n");
    })
    .join("\n\n");

  const result = await answerWorkoutQuestion(question, context || "No sessions with extracted data yet.");
  return NextResponse.json(result);
}
