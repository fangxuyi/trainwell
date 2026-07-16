import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/auth";
import { refundSessionCredits } from "@/lib/credits";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { id } = await params;
  const rows = await sql`
    SELECT * FROM sessions WHERE id = ${id} AND user_id = ${userId}
  `;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const { id } = await params;
  const rows = await sql`
    SELECT id FROM sessions WHERE id = ${id} AND user_id = ${userId}
  `;
  if (rows.length === 0) {
    return new NextResponse(null, { status: 204 });
  }
  await refundSessionCredits(id);
  await sql`DELETE FROM sessions WHERE id = ${id} AND user_id = ${userId}`;
  return new NextResponse(null, { status: 204 });
}
