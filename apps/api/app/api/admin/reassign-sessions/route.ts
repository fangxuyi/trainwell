import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

export const dynamic = "force-dynamic";

// One-off admin utility: reassign orphaned ('local') sessions — created before
// auth existed — to a real Clerk user. Protected by ADMIN_SECRET. Only moves
// sessions that are still user_id='local', so it can't steal another user's data.
export async function POST(req: NextRequest) {
  const { secret, userId, sessionIds } = (await req.json().catch(() => ({}))) as {
    secret?: string;
    userId?: string;
    sessionIds?: string[];
  };

  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!userId || !Array.isArray(sessionIds) || sessionIds.length === 0) {
    return NextResponse.json(
      { error: "userId and non-empty sessionIds[] are required" },
      { status: 400 }
    );
  }

  const updated: string[] = [];
  const skipped: string[] = [];
  for (const id of sessionIds) {
    const rows = await sql`
      UPDATE sessions SET user_id = ${userId}, updated_at = now()
      WHERE id = ${id} AND user_id = 'local'
      RETURNING id
    `;
    if (rows.length) updated.push(id);
    else skipped.push(id);
  }

  return NextResponse.json({ updated, skipped, count: updated.length });
}
