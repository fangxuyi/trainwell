import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
import { embedTexts } from "@/lib/voyage";
import { chunkMarkdown, chunkExtraction } from "@/lib/chunks";
import type { ExtractionOutput } from "@/lib/types";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { secret } = await req.json().catch(() => ({}));
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sessions = await sql`
    SELECT * FROM sessions
    WHERE remote_status IN ('review_required', 'finalized')
    ORDER BY started_at ASC
  `;

  const results: { id: string; chunks: number; error?: string }[] = [];

  for (const session of sessions) {
    try {
      await sql`DELETE FROM session_chunks WHERE session_id = ${session.id}`;

      let chunks;
      if (session.markdown_content && !session.extraction_version) {
        chunks = chunkMarkdown(
          { id: session.id as string, started_at: session.started_at as string, duration_seconds: session.duration_seconds as number | null },
          session.markdown_content as string
        );
      } else {
        const extraction: ExtractionOutput = {
          sessionId: session.id as string,
          extractionVersion: session.extraction_version as string ?? "1.0",
          exercises: Array.isArray(session.exercises) ? session.exercises as ExtractionOutput["exercises"] : [],
          sessionNotes: Array.isArray(session.session_notes) ? session.session_notes as string[] : [],
          techniqueThemes: Array.isArray(session.technique_themes) ? session.technique_themes as string[] : [],
          accomplishments: Array.isArray(session.accomplishments) ? session.accomplishments as string[] : [],
          improvementAreas: Array.isArray(session.improvement_areas) ? session.improvement_areas as string[] : [],
          painObservations: Array.isArray(session.pain_observations) ? session.pain_observations as ExtractionOutput["painObservations"] : [],
          nextSessionPlan: (session.next_session_plan as ExtractionOutput["nextSessionPlan"]) ?? undefined,
          overallDifficulty: session.overall_difficulty ? { value: session.overall_difficulty as number, unit: "/10", confidence: 1, status: "explicit" as const, sourceSegmentIds: [] } : undefined,
          energyLevel: undefined,
          openQuestions: [],
        };
        chunks = chunkExtraction(
          {
            id: session.id as string,
            started_at: session.started_at as string,
            duration_seconds: session.duration_seconds as number | null,
            workout_type: session.workout_type as string | null,
            trainer_name: session.trainer_name as string | null,
          },
          extraction
        );
      }

      if (chunks.length === 0) {
        results.push({ id: session.id as string, chunks: 0 });
        continue;
      }

      const embeddings = await embedTexts(chunks.map((c) => c.content));
      for (let i = 0; i < chunks.length; i++) {
        const embeddingStr = `[${embeddings[i].join(",")}]`;
        await sql`
          INSERT INTO session_chunks (id, session_id, chunk_type, content, embedding)
          VALUES (${randomUUID()}, ${session.id}, ${chunks[i].chunkType}, ${chunks[i].content}, ${embeddingStr}::vector)
        `;
      }

      results.push({ id: session.id as string, chunks: chunks.length });
    } catch (err) {
      results.push({ id: session.id as string, chunks: 0, error: (err as Error).message });
    }
  }

  return NextResponse.json({ results });
}
