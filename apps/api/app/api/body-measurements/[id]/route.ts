import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorized } from "@/lib/auth";
import sql from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_BODY_PART_LENGTH = 60;
const MAX_NOTE_LENGTH = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const bodyPart = typeof body?.bodyPart === "string" ? body.bodyPart.trim() : "";
  const value = Number(body?.value);
  const unit = body?.unit;
  const measuredAt = typeof body?.measuredAt === "string" ? body.measuredAt : "";
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, MAX_NOTE_LENGTH) : null;

  if (
    !UUID_PATTERN.test(id) ||
    !bodyPart ||
    bodyPart.length > MAX_BODY_PART_LENGTH ||
    !Number.isFinite(value) ||
    value <= 0 ||
    (unit !== "cm" && unit !== "in") ||
    !measuredAt ||
    Number.isNaN(Date.parse(measuredAt))
  ) {
    return NextResponse.json({ error: "Invalid body measurement" }, { status: 400 });
  }

  const conflicting = await sql`
    SELECT user_id FROM body_measurements WHERE id = ${id} LIMIT 1
  `;
  if (conflicting.length > 0 && conflicting[0].user_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await sql`
    INSERT INTO body_measurements (
      id, user_id, body_part, value, unit, measured_at, note
    ) VALUES (
      ${id}, ${userId}, ${bodyPart}, ${value}, ${unit}, ${new Date(measuredAt).toISOString()}, ${note || null}
    )
    ON CONFLICT (id) DO UPDATE SET
      body_part = EXCLUDED.body_part,
      value = EXCLUDED.value,
      unit = EXCLUDED.unit,
      measured_at = EXCLUDED.measured_at,
      note = EXCLUDED.note,
      updated_at = now()
    WHERE body_measurements.user_id = ${userId}
    RETURNING id, user_id, body_part, value, unit, measured_at, note, created_at, updated_at
  `;
  return NextResponse.json(rows[0]);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await sql`
    DELETE FROM body_measurements WHERE id = ${id} AND user_id = ${userId}
  `;
  return new NextResponse(null, { status: 204 });
}
