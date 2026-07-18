import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
import { requireSessionOwner } from "@/lib/auth";
import { indexFinalizedSession, type SessionIndexRow } from "@/lib/session-index";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const owner = await requireSessionOwner(id);
  if (owner instanceof NextResponse) return owner;

  const rows = await sql`SELECT * FROM sessions WHERE id = ${id}`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const session = rows[0] as SessionIndexRow;
  if (session.remote_status !== "finalized") {
    return NextResponse.json(
      { error: "Finalize this session before embedding it" },
      { status: 409 }
    );
  }

  const chunks = await indexFinalizedSession(session);
  return NextResponse.json({ chunks });
}
