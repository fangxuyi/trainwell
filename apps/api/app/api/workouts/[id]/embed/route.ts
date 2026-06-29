import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
import { embedTexts } from "@/lib/voyage";
import { chunkExtraction, chunkMarkdown } from "@/lib/chunks";
import type { ExtractionOutput } from "@/lib/types";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const rows = await sql`SELECT * FROM sessions WHERE id = ${id}`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const session = rows[0];

  // Delete existing chunks for this session (re-embed is idempotent)
  await sql`DELETE FROM session_chunks WHERE session_id = ${id}`;

  let chunks;
  if (session.markdown_content && !session.extraction_version) {
    // Imported session — chunk the markdown directly
    chunks = chunkMarkdown(
      { id, started_at: session.started_at as string, duration_seconds: session.duration_seconds as number | null },
      session.markdown_content as string
    );
  } else {
    // Recorded session — chunk the extraction data
    const extraction: ExtractionOutput = {
      sessionId: id,
      extractionVersion: session.extraction_version as string ?? "1.0",
      exercises: Array.isArray(session.exercises) ? session.exercises as ExtractionOutput["exercises"] : [],
      sessionNotes: Array.isArray(session.session_notes) ? session.session_notes as string[] : [],
      techniqueThemes: Array.isArray(session.technique_themes) ? session.technique_themes as string[] : [],
      accomplishments: Array.isArray(session.accomplishments) ? session.accomplishments as string[] : [],
      improvementAreas: Array.isArray(session.improvement_areas) ? session.improvement_areas as string[] : [],
      painObservations: Array.isArray(session.pain_observations) ? session.pain_observations as ExtractionOutput["painObservations"] : [],
      nextSessionPlan: (session.next_session_plan as ExtractionOutput["nextSessionPlan"]) ?? undefined,
      overallDifficulty: session.overall_difficulty ? { value: session.overall_difficulty as number, unit: "/10", confidence: 1, status: "explicit" as const, sourceSegmentIds: [] } : undefined,
      energyLevel: session.energy_level ? { value: session.energy_level as number, unit: "/10", confidence: 1, status: "explicit" as const, sourceSegmentIds: [] } : undefined,
      openQuestions: [],
    };
    chunks = chunkExtraction(
      {
        id,
        started_at: session.started_at as string,
        duration_seconds: session.duration_seconds as number | null,
        workout_type: session.workout_type as string | null,
        trainer_name: session.trainer_name as string | null,
      },
      extraction
    );
  }

  if (chunks.length === 0) {
    return NextResponse.json({ chunks: 0 });
  }

  // Embed all chunks in one Voyage API call
  const embeddings = await embedTexts(chunks.map((c) => c.content));

  // Persist
  for (let i = 0; i < chunks.length; i++) {
    const chunkId = randomUUID();
    const embeddingStr = `[${embeddings[i].join(",")}]`;
    await sql`
      INSERT INTO session_chunks (id, session_id, chunk_type, content, embedding)
      VALUES (
        ${chunkId},
        ${id},
        ${chunks[i].chunkType},
        ${chunks[i].content},
        ${embeddingStr}::vector
      )
    `;
  }

  return NextResponse.json({ chunks: chunks.length });
}
