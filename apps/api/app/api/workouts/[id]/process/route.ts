import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
import { transcribeAndExtract } from "@/lib/pipeline";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  const sessions = await sql`SELECT * FROM sessions WHERE id = ${sessionId}`;
  if (sessions.length === 0) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Mark as processing — don't await the pipeline (fire and forget)
  await sql`
    UPDATE sessions
    SET remote_status = 'processing', updated_at = now()
    WHERE id = ${sessionId}
  `;

  // Run pipeline in background (Vercel Edge doesn't support long-running jobs,
  // but for personal use on Vercel Functions this is acceptable)
  transcribeAndExtract(sessionId).catch(async (err) => {
    console.error("Pipeline failed for", sessionId, err);
    await sql`
      UPDATE sessions
      SET remote_status = 'failed', updated_at = now()
      WHERE id = ${sessionId}
    `;
  });

  return NextResponse.json({ status: "processing" });
}
