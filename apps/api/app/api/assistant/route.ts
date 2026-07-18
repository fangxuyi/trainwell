import { NextRequest, NextResponse } from "next/server";
import { answerWorkoutQuestion, rewriteWorkoutQuestion } from "@/lib/extract";
import { getUserId, unauthorized } from "@/lib/auth";
import { retrieveWorkoutContext } from "@/lib/assistant-retrieval";
import type { AssistantConversationMessage } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_MESSAGE_LENGTH = 2_000;

function normalizeHistory(value: unknown): AssistantConversationMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((message): message is Record<string, unknown> => Boolean(message) && typeof message === "object")
    .filter((message) => message.role === "user" || message.role === "assistant")
    .filter((message) => typeof message.content === "string" && message.content.trim().length > 0)
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: (message.content as string).trim().slice(0, MAX_HISTORY_MESSAGE_LENGTH),
    }));
}

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { question, sessionId, history: rawHistory } = await req.json();
  if (typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const history = normalizeHistory(rawHistory);
  const retrievalQuestion = history.length > 0
    ? await rewriteWorkoutQuestion(question.trim(), history).catch(() => question.trim())
    : question.trim();
  const retrieval = await retrieveWorkoutContext(
    userId,
    retrievalQuestion,
    typeof sessionId === "string" && sessionId.trim() ? sessionId : undefined
  );
  const result = await answerWorkoutQuestion(question.trim(), retrieval.context, history);
  return NextResponse.json({
    ...result,
    citations: retrieval.citations,
  });
}
