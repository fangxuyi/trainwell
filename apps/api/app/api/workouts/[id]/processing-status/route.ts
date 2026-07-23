import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
import { requireSessionOwner } from "@/lib/auth";
import { getLanguageModelQueueDelay } from "@/lib/language-model";
import { getProcessingJob } from "@/lib/processing-queue";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  const owner = await requireSessionOwner(sessionId);
  if (owner instanceof NextResponse) return owner;

  const rows = await sql`SELECT * FROM sessions WHERE id = ${sessionId}`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const session = rows[0];
  const transcriptRows = await sql`
    SELECT COUNT(*) as count FROM transcript_segments WHERE session_id = ${sessionId}
  `;
  const [job, providerQueue] = await Promise.all([
    getProcessingJob(sessionId),
    getLanguageModelQueueDelay(),
  ]);
  const providerBlockedUntil = providerQueue.blockedUntil
    ? new Date(providerQueue.blockedUntil)
    : null;
  const isProviderRateLimited =
    providerBlockedUntil != null && providerBlockedUntil.getTime() > Date.now();
  const retryAt = isProviderRateLimited
    ? providerBlockedUntil?.toISOString()
    : job?.status === "retry_wait"
      ? job.availableAt
      : null;
  const processingMessage = isProviderRateLimited
    ? "The AI provider is temporarily busy. Your recap will retry automatically."
    : job?.message ??
      (session.remote_status === "processing" ? "Building your recap." : null);

  return NextResponse.json({
    sessionId,
    remoteStatus: session.remote_status,
    transcriptSegmentCount: parseInt(transcriptRows[0].count, 10),
    extractionComplete: (() => { try { const ex = session.exercises; if (!ex) return false; const p = typeof ex === "string" ? JSON.parse(ex) : ex; return Array.isArray(p) && p.length > 0; } catch { return false; } })(),
    summaryComplete: !!session.markdown_content,
    queueStatus: job?.status ?? null,
    processingStage: job?.stage ?? null,
    processingMessage,
    processingAttemptCount: job?.attemptCount ?? 0,
    retryAt,
    rateLimited: isProviderRateLimited || job?.status === "retry_wait",
    errorMessage:
      session.remote_status === "failed"
        ? job?.error ?? "Processing failed"
        : null,
  });
}
