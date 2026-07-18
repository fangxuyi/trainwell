import sql from "./db";
import { chunksFromSession, type SessionIndexRow } from "./session-index";
import type { AssistantQuestionResponse, ExerciseRecord, ExerciseSet } from "./types";
import { embedText } from "./voyage";

const CANDIDATE_LIMIT = 24;
const RESULT_LIMIT = 8;
const MIN_VECTOR_SIMILARITY = 0.2;
const RRF_OFFSET = 60;
const MAX_CONTEXT_CHARS = 18_000;

type Citation = AssistantQuestionResponse["citations"][number];
type RetrievalMode = "session" | "latest" | "exercise_history" | "recent_history" | "hybrid";

interface RetrievedChunk {
  id: string;
  content: string;
  chunk_type: string;
  session_id: string;
  started_at: string;
  workout_type: string | null;
  trainer_name: string | null;
  similarity?: number;
  text_rank?: number;
}

export interface WorkoutRetrievalResult {
  context: string;
  citations: Citation[];
  mode: RetrievalMode;
}

function parseArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .map((token) => token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token);
}

function classifyQuestion(question: string, sessionId?: string): RetrievalMode {
  if (sessionId) return "session";

  const normalized = question.toLowerCase();
  if (/\b(last|latest|most recent)(?:\s+\w+){0,2}\s+(session|workout|training)\b/.test(normalized)) {
    return "latest";
  }
  if (/\b(progress|progressed|progression|trend|improv|improved|stronger|heaviest|max|maximum|personal record|volume|over time|\bpr\b)/.test(normalized)) {
    return "exercise_history";
  }
  if (/\b(last week|last month|last year|recently|workout history|how often|how many (sessions|workouts)|when did)\b/.test(normalized)) {
    return "recent_history";
  }
  return "hybrid";
}

async function getFinalizedSessions(
  userId: string,
  options: { sessionId?: string; limit: number; since?: Date }
): Promise<SessionIndexRow[]> {
  const since = options.since?.toISOString();

  if (options.sessionId) {
    return await sql`
      SELECT * FROM sessions
      WHERE id = ${options.sessionId}
        AND user_id = ${userId}
        AND remote_status = 'finalized'
      LIMIT 1
    ` as SessionIndexRow[];
  }

  if (since) {
    return await sql`
      SELECT * FROM sessions
      WHERE user_id = ${userId}
        AND remote_status = 'finalized'
        AND started_at >= ${since}
      ORDER BY started_at DESC
      LIMIT ${options.limit}
    ` as SessionIndexRow[];
  }

  return await sql`
    SELECT * FROM sessions
    WHERE user_id = ${userId}
      AND remote_status = 'finalized'
    ORDER BY started_at DESC
    LIMIT ${options.limit}
  ` as SessionIndexRow[];
}

function sessionContext(session: SessionIndexRow): string {
  const header = `FINALIZED SESSION ${session.id} — ${formatDate(session.started_at)}`;
  const chunks = chunksFromSession(session).map((chunk) => chunk.content);
  return `${header}\n${chunks.join("\n\n")}`;
}

function citationForSession(session: SessionIndexRow, excerpt?: string): Citation {
  return {
    sessionId: session.id,
    date: formatDate(session.started_at),
    excerpt: excerpt ?? (session.workout_type as string | undefined) ?? "Finalized workout session",
  };
}

function formatSet(set: ExerciseSet): string {
  const details = [
    set.completedReps != null ? `${set.completedReps} reps` : null,
    set.weight ? `${set.weight.value}${set.weight.unit}` : null,
    set.duration ? `${set.duration.value}${set.duration.unit}` : null,
    set.distance ? `${set.distance.value}${set.distance.unit}` : null,
    set.rpe != null ? `RPE ${set.rpe}` : null,
  ].filter(Boolean);
  return details.join(" @ ") || "completed";
}

function exerciseHistoryContext(sessions: SessionIndexRow[], question: string): string {
  const questionTokens = new Set(tokenize(question));
  const histories = new Map<string, Array<{ session: SessionIndexRow; exercise: ExerciseRecord }>>();

  for (const session of sessions) {
    for (const exercise of parseArray<ExerciseRecord>(session.exercises).filter((item) => item.completed)) {
      const name = exercise.canonicalName.trim();
      const entries = histories.get(name) ?? [];
      entries.push({ session, exercise });
      histories.set(name, entries);
    }
  }

  const matchingNames = [...histories.keys()].filter((name) =>
    tokenize(name).some((token) => questionTokens.has(token))
  );
  const selectedNames = matchingNames.length > 0
    ? matchingNames
    : [...histories.entries()]
        .sort((left, right) => right[1].length - left[1].length)
        .slice(0, 6)
        .map(([name]) => name);

  const sections = selectedNames.map((name) => {
    const entries = histories.get(name) ?? [];
    const maxima = new Map<string, number>();
    const volumes = new Map<string, number>();
    let totalCompletedSets = 0;
    let totalCompletedReps = 0;

    const timeline = [...entries].reverse().map(({ session, exercise }) => {
      const sets = exercise.sets.filter((set) => set.completed);
      totalCompletedSets += sets.length;
      for (const set of sets) {
        totalCompletedReps += set.completedReps ?? 0;
        if (set.weight) {
          const unit = set.weight.unit;
          maxima.set(unit, Math.max(maxima.get(unit) ?? 0, set.weight.value));
          volumes.set(unit, (volumes.get(unit) ?? 0) + set.weight.value * (set.completedReps ?? 0));
        }
      }
      return `- ${formatDate(session.started_at)} [session ${session.id}]: ${sets.map(formatSet).join("; ") || "no completed sets"}`;
    });

    const stats = [
      `${entries.length} sessions`,
      `${totalCompletedSets} completed sets`,
      `${totalCompletedReps} completed reps`,
      ...[...maxima].map(([unit, value]) => `maximum ${value}${unit}`),
      ...[...volumes].map(([unit, value]) => `recorded volume ${Math.round(value)} ${unit}-reps`),
    ];
    return `EXERCISE: ${name}\nComputed totals: ${stats.join(", ")}\nTimeline:\n${timeline.join("\n")}`;
  });

  return `STRUCTURED FINALIZED EXERCISE HISTORY\n${sections.join("\n\n")}`;
}

function relativeHistoryStart(question: string): Date | undefined {
  const normalized = question.toLowerCase();
  const days = normalized.includes("last week")
    ? 7
    : normalized.includes("last month")
      ? 31
      : normalized.includes("last year")
        ? 365
        : normalized.includes("recent")
          ? 90
          : undefined;
  return days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;
}

function historyContext(sessions: SessionIndexRow[]): string {
  const entries = sessions.map((session) => {
    const exercises = parseArray<ExerciseRecord>(session.exercises)
      .filter((exercise) => exercise.completed)
      .map((exercise) => exercise.canonicalName);
    return `- ${formatDate(session.started_at)} [session ${session.id}]: ${session.workout_type ?? "Workout"}; exercises: ${exercises.join(", ") || "none recorded"}`;
  });
  return `STRUCTURED FINALIZED SESSION HISTORY\nMatching sessions: ${sessions.length}\n${entries.join("\n")}`;
}

async function hybridChunks(userId: string, question: string): Promise<RetrievedChunk[]> {
  const lexicalRows = await sql`
    SELECT
      sc.id, sc.content, sc.chunk_type, sc.session_id,
      s.started_at, s.workout_type, s.trainer_name,
      ts_rank_cd(
        to_tsvector('english', sc.content),
        websearch_to_tsquery('english', ${question})
      ) AS text_rank
    FROM session_chunks sc
    JOIN sessions s ON s.id = sc.session_id
    WHERE s.user_id = ${userId}
      AND s.remote_status = 'finalized'
      AND to_tsvector('english', sc.content) @@ websearch_to_tsquery('english', ${question})
    ORDER BY text_rank DESC
    LIMIT ${CANDIDATE_LIMIT}
  ` as RetrievedChunk[];

  let vectorRows: RetrievedChunk[] = [];
  try {
    const queryEmbedding = await embedText(question);
    const embedding = `[${queryEmbedding.join(",")}]`;
    vectorRows = await sql`
      SELECT
        sc.id, sc.content, sc.chunk_type, sc.session_id,
        s.started_at, s.workout_type, s.trainer_name,
        1 - (sc.embedding <=> ${embedding}::vector) AS similarity
      FROM session_chunks sc
      JOIN sessions s ON s.id = sc.session_id
      WHERE s.user_id = ${userId}
        AND s.remote_status = 'finalized'
      ORDER BY sc.embedding <=> ${embedding}::vector
      LIMIT ${CANDIDATE_LIMIT}
    ` as RetrievedChunk[];
    vectorRows = vectorRows.filter((row) => Number(row.similarity) >= MIN_VECTOR_SIMILARITY);
  } catch (error) {
    console.warn("Semantic workout retrieval failed; using lexical results:", error);
  }

  const scores = new Map<string, { chunk: RetrievedChunk; score: number }>();
  const addRanking = (rows: RetrievedChunk[]) => {
    rows.forEach((chunk, index) => {
      const current = scores.get(chunk.id) ?? { chunk, score: 0 };
      current.score += 1 / (RRF_OFFSET + index + 1);
      scores.set(chunk.id, current);
    });
  };
  addRanking(lexicalRows);
  addRanking(vectorRows);

  return [...scores.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, RESULT_LIMIT)
    .map(({ chunk }) => chunk);
}

function chunkContext(chunks: RetrievedChunk[]): string {
  return chunks.map((chunk) => {
    const label = `${formatDate(chunk.started_at)} — ${chunk.workout_type ?? "Workout"}${chunk.trainer_name ? ` with ${chunk.trainer_name}` : ""}`;
    return `[${label}; session ${chunk.session_id}]\n${chunk.content}`;
  }).join("\n\n---\n\n");
}

function citationsFromChunks(chunks: RetrievedChunk[]): Citation[] {
  const citations = new Map<string, Citation>();
  for (const chunk of chunks) {
    if (!citations.has(chunk.session_id)) {
      citations.set(chunk.session_id, {
        sessionId: chunk.session_id,
        date: formatDate(chunk.started_at),
        excerpt: chunk.content.slice(0, 180),
      });
    }
  }
  return [...citations.values()];
}

function combineContext(...sections: string[]): string {
  return sections.filter(Boolean).join("\n\n===\n\n").slice(0, MAX_CONTEXT_CHARS);
}

function deduplicateCitations(citations: Citation[]): Citation[] {
  return [...new Map(citations.map((citation) => [citation.sessionId, citation])).values()];
}

export async function retrieveWorkoutContext(
  userId: string,
  question: string,
  sessionId?: string
): Promise<WorkoutRetrievalResult> {
  const mode = classifyQuestion(question, sessionId);

  if (mode === "session") {
    const sessions = await getFinalizedSessions(userId, { sessionId, limit: 1 });
    return {
      context: sessions[0] ? sessionContext(sessions[0]) : "No finalized session found.",
      citations: sessions[0] ? [citationForSession(sessions[0])] : [],
      mode,
    };
  }

  if (mode === "latest") {
    const sessions = await getFinalizedSessions(userId, { limit: 1 });
    return {
      context: sessions[0] ? sessionContext(sessions[0]) : "No finalized sessions found.",
      citations: sessions[0] ? [citationForSession(sessions[0])] : [],
      mode,
    };
  }

  if (mode === "exercise_history") {
    const [sessions, semanticChunks] = await Promise.all([
      getFinalizedSessions(userId, { limit: 100 }),
      hybridChunks(userId, question),
    ]);
    return {
      context: combineContext(exerciseHistoryContext(sessions, question), chunkContext(semanticChunks)),
      citations: deduplicateCitations([
        ...sessions.slice(0, 20).map((session) => citationForSession(session)),
        ...citationsFromChunks(semanticChunks),
      ]),
      mode,
    };
  }

  if (mode === "recent_history") {
    const [sessions, semanticChunks] = await Promise.all([
      getFinalizedSessions(userId, { limit: 50, since: relativeHistoryStart(question) }),
      hybridChunks(userId, question),
    ]);
    return {
      context: combineContext(historyContext(sessions), chunkContext(semanticChunks)),
      citations: deduplicateCitations([
        ...sessions.slice(0, 20).map((session) => citationForSession(session)),
        ...citationsFromChunks(semanticChunks),
      ]),
      mode,
    };
  }

  const semanticChunks = await hybridChunks(userId, question);
  if (semanticChunks.length > 0) {
    return {
      context: chunkContext(semanticChunks),
      citations: citationsFromChunks(semanticChunks),
      mode,
    };
  }

  const sessions = await getFinalizedSessions(userId, { limit: 5 });
  return {
    context: sessions.length > 0
      ? combineContext(...sessions.map(sessionContext))
      : "No finalized sessions found.",
    citations: sessions.map((session) => citationForSession(session)),
    mode,
  };
}
