import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
import { answerWorkoutQuestion } from "@/lib/extract";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { question } = await req.json();
  if (!question?.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  // Gather recent session context
  const sessions = await sql`
    SELECT id, started_at, workout_type, trainer_name, exercises,
           session_notes, next_session_plan, overall_difficulty
    FROM sessions
    WHERE remote_status IN ('review_required', 'finalized')
    ORDER BY started_at DESC
    LIMIT 20
  `;

  const context = sessions
    .map((s) => {
      const date = new Date(s.started_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      const exercises = (s.exercises as unknown[]) ?? [];
      return `Session ${s.id} (${date}) — ${s.workout_type ?? "Workout"}: ${exercises.length} exercises`;
    })
    .join("\n");

  const result = await answerWorkoutQuestion(question, context);
  return NextResponse.json(result);
}
