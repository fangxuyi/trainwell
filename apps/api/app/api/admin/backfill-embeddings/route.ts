import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
import { indexFinalizedSession, type SessionIndexRow } from "@/lib/session-index";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { secret } = await req.json().catch(() => ({}));
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sessions = await sql`
    SELECT * FROM sessions
    WHERE remote_status = 'finalized'
    ORDER BY started_at ASC
  `;

  const results: { id: string; chunks: number; error?: string }[] = [];

  for (const session of sessions) {
    try {
      const chunks = await indexFinalizedSession(session as SessionIndexRow);
      results.push({ id: session.id as string, chunks });
    } catch (err) {
      results.push({ id: session.id as string, chunks: 0, error: (err as Error).message });
    }
  }

  return NextResponse.json({ results });
}
