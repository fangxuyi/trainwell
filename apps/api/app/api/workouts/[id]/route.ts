import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rows = await sql`SELECT * FROM sessions WHERE id = ${id}`;
  if (rows.length === 0) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json(rows[0]);
}
