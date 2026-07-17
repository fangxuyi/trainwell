import { NextRequest, NextResponse } from "next/server";
import { requireSessionOwner } from "@/lib/auth";
import sql from "@/lib/db";

export const dynamic = "force-dynamic";

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

  const rows = await sql`
    UPDATE sessions
    SET exercises = ${JSON.stringify(body.exercises)}::jsonb,
        remote_status = 'finalized',
        remote_version = COALESCE(remote_version, 0) + 1,
        updated_at = now()
    WHERE id = ${id} AND user_id = ${owner.userId}
    RETURNING id, remote_status, remote_version
  `;

  return NextResponse.json(rows[0]);
}
