import type { NeonQueryFunctionInTransaction } from "@neondatabase/serverless";
import sql from "./db";
import { chunkExtraction, chunkMarkdown, type SessionChunk } from "./chunks";
import type { ExtractionOutput } from "./types";
import { embedTexts } from "./voyage";

export interface SessionIndexRow extends Record<string, unknown> {
  id: string;
  started_at: string;
  remote_status?: string;
}

interface PreparedChunk {
  chunk: SessionChunk;
  embedding: string;
}

function arrayValue<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function extractionFromSession(session: SessionIndexRow): ExtractionOutput {
  const overallDifficulty = session.overall_difficulty;
  const energyLevel = session.energy_level;

  return {
    sessionId: session.id,
    extractionVersion: (session.extraction_version as string | undefined) ?? "1.0",
    exercises: arrayValue<ExtractionOutput["exercises"][number]>(session.exercises),
    sessionNotes: arrayValue<string>(session.session_notes),
    techniqueThemes: arrayValue<string>(session.technique_themes),
    accomplishments: arrayValue<string>(session.accomplishments),
    improvementAreas: arrayValue<string>(session.improvement_areas),
    painObservations: arrayValue<ExtractionOutput["painObservations"][number]>(session.pain_observations),
    nextSessionPlan: (session.next_session_plan as ExtractionOutput["nextSessionPlan"]) ?? undefined,
    overallDifficulty:
      typeof overallDifficulty === "number"
        ? { value: overallDifficulty, unit: "/10", confidence: 1, status: "user_corrected", sourceSegmentIds: [] }
        : undefined,
    energyLevel:
      typeof energyLevel === "number"
        ? { value: energyLevel, unit: "/10", confidence: 1, status: "user_corrected", sourceSegmentIds: [] }
        : undefined,
    openQuestions: [],
  };
}

export function chunksFromSession(session: SessionIndexRow): SessionChunk[] {
  const metadata = {
    id: session.id,
    started_at: session.started_at,
    duration_seconds: session.duration_seconds as number | null | undefined,
    workout_type: session.workout_type as string | null | undefined,
    trainer_name: session.trainer_name as string | null | undefined,
  };

  if (session.markdown_content && !session.extraction_version) {
    return chunkMarkdown(metadata, session.markdown_content as string);
  }

  return chunkExtraction(metadata, extractionFromSession(session));
}

async function prepareChunks(session: SessionIndexRow): Promise<PreparedChunk[]> {
  const chunks = chunksFromSession(session);
  const embeddings = chunks.length > 0
    ? await embedTexts(chunks.map((chunk) => chunk.content))
    : [];

  return chunks.map((chunk, index) => ({
    chunk,
    embedding: `[${embeddings[index].join(",")}]`,
  }));
}

function replacementQueries(
  transaction: NeonQueryFunctionInTransaction<false, false>,
  sessionId: string,
  chunks: PreparedChunk[]
) {
  return [
    transaction`DELETE FROM session_chunks WHERE session_id = ${sessionId}`,
    ...chunks.map(({ chunk, embedding }, index) => transaction`
      INSERT INTO session_chunks (id, session_id, chunk_type, content, embedding)
      VALUES (
        ${`${sessionId}:${chunk.chunkType}:${index}`},
        ${sessionId},
        ${chunk.chunkType},
        ${chunk.content},
        ${embedding}::vector
      )
    `),
  ];
}

export async function indexFinalizedSession(session: SessionIndexRow): Promise<number> {
  if (session.remote_status !== "finalized") {
    throw new Error(`Session ${session.id} must be finalized before indexing`);
  }

  const chunks = await prepareChunks(session);

  await sql.transaction((transaction) => replacementQueries(transaction, session.id, chunks));

  return chunks.length;
}

export async function finalizeAndIndexSession(
  sessionId: string,
  userId: string,
  exercises: ExtractionOutput["exercises"]
): Promise<{ id: string; remoteStatus: string; remoteVersion: number; chunks: number } | null> {
  const rows = await sql`
    SELECT * FROM sessions
    WHERE id = ${sessionId} AND user_id = ${userId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;

  const current = rows[0] as SessionIndexRow;
  const finalized: SessionIndexRow = {
    ...current,
    exercises,
    remote_status: "finalized",
  };
  const chunks = await prepareChunks(finalized);
  const results = await sql.transaction((transaction) => [
    transaction`
      UPDATE sessions
      SET exercises = ${JSON.stringify(exercises)}::jsonb,
          remote_status = 'finalized',
          remote_version = COALESCE(remote_version, 0) + 1,
          updated_at = now()
      WHERE id = ${sessionId} AND user_id = ${userId}
      RETURNING id, remote_status, remote_version
    `,
    ...replacementQueries(transaction, sessionId, chunks),
  ]);
  const updated = results[0][0];
  if (!updated) return null;

  return {
    id: updated.id as string,
    remoteStatus: updated.remote_status as string,
    remoteVersion: updated.remote_version as number,
    chunks: chunks.length,
  };
}
