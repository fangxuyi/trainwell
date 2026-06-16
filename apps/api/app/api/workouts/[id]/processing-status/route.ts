import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  const rows = await sql`SELECT * FROM sessions WHERE id = ${sessionId}`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const session = rows[0];
  const transcriptRows = await sql`
    SELECT COUNT(*) as count FROM transcript_segments WHERE session_id = ${sessionId}
  `;

  return NextResponse.json({
    sessionId,
    remoteStatus: session.remote_status,
    transcriptSegmentCount: parseInt(transcriptRows[0].count, 10),
    extractionComplete: session.exercises && JSON.parse(session.exercises as string).length > 0,
    summaryComplete: !!session.markdown_content,
    errorMessage: session.remote_status === "failed" ? "Processing failed" : null,
  });
}
