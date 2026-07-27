import { NextRequest, NextResponse, after } from "next/server";
import { send } from "@vercel/queue";
import sql from "@/lib/db";
import { requireSessionOwner } from "@/lib/auth";
import { enqueueProcessingJob } from "@/lib/processing-queue";
import { runQueuedProcessing } from "@/lib/workout-processing";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  const owner = await requireSessionOwner(sessionId);
  if (owner instanceof NextResponse) return owner;

  const sessions = await sql`SELECT remote_status FROM sessions WHERE id = ${sessionId}`;
  if (sessions.length === 0) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { reprocess?: boolean };
  const remoteStatus = String(sessions[0].remote_status);
  if (remoteStatus === "finalized") {
    return NextResponse.json({ status: remoteStatus });
  }
  const forceReprocess = body.reprocess === true && remoteStatus === "review_required";
  if (remoteStatus === "review_required" && !forceReprocess) {
    return NextResponse.json({ status: remoteStatus });
  }

  const job = await enqueueProcessingJob(sessionId, { force: forceReprocess });

  await sql`
    UPDATE sessions
    SET remote_status = 'processing', updated_at = now()
    WHERE id = ${sessionId}
  `;

  try {
    await send(
      "workout-processing",
      { sessionId },
      {
        idempotencyKey: `workout-processing:${sessionId}:${job.attemptCount + 1}`,
        retentionSeconds: 604_800,
      }
    );
  } catch (error) {
    console.warn("Vercel Queue publish failed; using immediate processing fallback", error);
    after(() => runQueuedProcessing(sessionId).catch(() => undefined));
  }

  return NextResponse.json({
    status: "processing",
    queueStatus: job.status,
    message: job.message,
    retryAt: job.availableAt,
  });
}
