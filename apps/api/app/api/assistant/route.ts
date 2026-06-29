import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
import { embedText } from "@/lib/voyage";
import { answerWorkoutQuestion } from "@/lib/extract";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TOP_K = 8;

export async function POST(req: NextRequest) {
  const { question } = await req.json();
  if (!question?.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  // Embed the question
  const queryEmbedding = await embedText(question);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  // Vector similarity search across all session chunks
  const chunks = await sql`
    SELECT
      sc.content,
      sc.chunk_type,
      sc.session_id,
      s.started_at,
      s.workout_type,
      s.trainer_name,
      1 - (sc.embedding <=> ${embeddingStr}::vector) AS similarity
    FROM session_chunks sc
    JOIN sessions s ON s.id = sc.session_id
    ORDER BY sc.embedding <=> ${embeddingStr}::vector
    LIMIT ${TOP_K}
  `;

  if (chunks.length === 0) {
    // Fall back to most recent sessions if no chunks indexed yet
    const sessions = await sql`
      SELECT id, started_at, markdown_content, exercises, session_notes
      FROM sessions
      WHERE remote_status IN ('review_required', 'finalized')
      ORDER BY started_at DESC
      LIMIT 5
    `;
    const fallbackContext = sessions
      .map((s) => {
        const date = new Date(s.started_at as string).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
        if (s.markdown_content) return `=== ${date} ===\n${s.markdown_content}`;
        return `=== ${date} === (no summary yet)`;
      })
      .join("\n\n");

    const result = await answerWorkoutQuestion(question, fallbackContext || "No sessions found.");
    return NextResponse.json(result);
  }

  // Build context from retrieved chunks
  const context = chunks
    .map((c) => {
      const date = new Date(c.started_at as string).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
      });
      return `[${date} — ${c.workout_type ?? "Workout"}${c.trainer_name ? ` with ${c.trainer_name}` : ""}]\n${c.content}`;
    })
    .join("\n\n---\n\n");

  const result = await answerWorkoutQuestion(question, context);
  return NextResponse.json(result);
}
