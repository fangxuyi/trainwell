import { NextRequest, NextResponse, after } from "next/server";
import sql from "@/lib/db";
import { transcribeAndExtract } from "@/lib/pipeline";
import { requireSessionOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  const owner = await requireSessionOwner(sessionId);
  if (owner instanceof NextResponse) return owner;

  const sessions = await sql`SELECT * FROM sessions WHERE id = ${sessionId}`;
  if (sessions.length === 0) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  await sql`
    UPDATE sessions
    SET remote_status = 'processing', updated_at = now()
    WHERE id = ${sessionId}
  `;

  // after() keeps the Vercel function alive after the response is sent
  after(async () => {
    try {
      await transcribeAndExtract(sessionId);
    } catch (err) {
      console.error("Pipeline failed for", sessionId, err);
      await sql`
        UPDATE sessions
        SET remote_status = 'failed', updated_at = now()
        WHERE id = ${sessionId}
      `;
    }
  });

  return NextResponse.json({ status: "processing" });
}
