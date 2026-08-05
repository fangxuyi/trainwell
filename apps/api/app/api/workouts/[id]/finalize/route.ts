import { NextRequest, NextResponse, after } from "next/server";
import { send } from "@vercel/queue";
import { requireSessionOwner } from "@/lib/auth";
import { evaluateAndDeliverEvaluationProposal } from "@/lib/evaluation";
import { finalizeAndIndexSession } from "@/lib/session-index";
import type { ExtractionOutput } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const owner = await requireSessionOwner(id);
  if (owner instanceof NextResponse) return owner;

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.exercises)) {
    return NextResponse.json({ error: "exercises must be an array" }, { status: 400 });
  }

  const result = await finalizeAndIndexSession(
    id,
    owner.userId,
    body.exercises as ExtractionOutput["exercises"]
  );
  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (result.evaluationProposalId) {
    try {
      await send(
        "evaluation-proposals",
        { proposalId: result.evaluationProposalId },
        {
          idempotencyKey: `evaluation-proposal:${result.evaluationProposalId}`,
          retentionSeconds: 604_800,
        }
      );
    } catch (error) {
      console.warn("Evaluation queue publish failed; using delivery fallback", error);
      after(() =>
        evaluateAndDeliverEvaluationProposal(result.evaluationProposalId as string).catch(
          (deliveryError) =>
            console.error("Evaluation proposal delivery fallback failed", deliveryError)
        )
      );
    }
  }

  return NextResponse.json({
    id: result.id,
    remote_status: result.remoteStatus,
    remote_version: result.remoteVersion,
    indexed_chunks: result.chunks,
    evaluation_proposal_id: result.evaluationProposalId,
  });
}
