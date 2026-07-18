import { NextResponse } from "next/server";
import { getUserId, unauthorized } from "@/lib/auth";
import sql from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const rows = await sql`
    SELECT id, user_id, body_part, value, unit, measured_at, note, created_at, updated_at
    FROM body_measurements
    WHERE user_id = ${userId}
    ORDER BY measured_at DESC, created_at DESC
  `;
  return NextResponse.json(rows);
}
