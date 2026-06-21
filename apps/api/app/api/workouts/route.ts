import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await sql`
    SELECT * FROM sessions ORDER BY started_at DESC LIMIT 100
  `;
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    id,
    workoutType,
    trainerName,
    goals = [],
    processingMode = "automatic_hybrid",
    audioRetentionPolicy = "delete_after_review",
    timezone = "UTC",
    startedAt,
    endedAt,
    durationSeconds,
  } = body;

  if (!id || !startedAt) {
    return NextResponse.json(
      { error: "id and startedAt are required" },
      { status: 400 }
    );
  }

  // Idempotent: if session already exists, return it
  const existing = await sql`
    SELECT * FROM sessions WHERE id = ${id}
  `;
  if (existing.length > 0) {
    return NextResponse.json(existing[0], { status: 200 });
  }

  const rows = await sql`
    INSERT INTO sessions (
      id, started_at, ended_at, duration_seconds, timezone,
      workout_type, trainer_name, goals, processing_mode,
      audio_retention_policy, local_status, remote_status, sync_status
    ) VALUES (
      ${id}, ${startedAt}, ${endedAt ?? null}, ${durationSeconds ?? null},
      ${timezone}, ${workoutType ?? null}, ${trainerName ?? null},
      ${JSON.stringify(goals)}, ${processingMode},
      ${audioRetentionPolicy}, 'locally_complete', 'uploaded', 'pending'
    ) RETURNING *
  `;

  return NextResponse.json(rows[0], { status: 201 });
}
