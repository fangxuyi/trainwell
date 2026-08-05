import { NextRequest, NextResponse } from "next/server";
import { send } from "@vercel/queue";
import sql from "@/lib/db";
import { isValidAdminSecret } from "@/lib/beta-access";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { secret?: unknown } | null;
  if (!isValidAdminSecret(body?.secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const proposals = await sql`
    SELECT id
    FROM evaluation_proposals
    WHERE github_issue_url IS NULL
      AND delivery_status IN ('pending', 'failed', 'awaiting_configuration')
    ORDER BY created_at ASC
    LIMIT 50
  `;

  const queued: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const proposal of proposals) {
    const proposalId = String(proposal.id);
    try {
      await send(
        "evaluation-proposals",
        { proposalId },
        {
          idempotencyKey: `evaluation-proposal-redelivery:${proposalId}:${Date.now()}`,
          retentionSeconds: 604_800,
        }
      );
      queued.push(proposalId);
    } catch (error) {
      failed.push({
        id: proposalId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({ queued, failed });
}
