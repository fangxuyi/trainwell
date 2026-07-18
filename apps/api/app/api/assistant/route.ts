import { NextRequest, NextResponse } from "next/server";
import { answerWorkoutQuestion } from "@/lib/extract";
import { getUserId, unauthorized } from "@/lib/auth";
import { retrieveWorkoutContext } from "@/lib/assistant-retrieval";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { question, sessionId } = await req.json();
  if (!question?.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const retrieval = await retrieveWorkoutContext(
    userId,
    question.trim(),
    typeof sessionId === "string" && sessionId.trim() ? sessionId : undefined
  );
  const result = await answerWorkoutQuestion(question.trim(), retrieval.context);
  return NextResponse.json({
    ...result,
    citations: retrieval.citations,
  });
}
