import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/auth";
import {
  InsufficientCreditsError,
  reserveCreditsForSession,
} from "@/lib/credits";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const rows = await sql`
    SELECT * FROM sessions
    WHERE user_id = ${userId}
    ORDER BY started_at DESC LIMIT 100
  `;
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

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

  // Idempotent: if the user already created this session, ensure its credit
  // reservation still exists before allowing upload retries.
  const existing = await sql`
    SELECT * FROM sessions WHERE id = ${id} AND user_id = ${userId}
  `;
  if (existing.length > 0) {
    try {
      await reserveCreditsForSession(
        userId,
        id,
        Number(existing[0].duration_seconds ?? durationSeconds ?? 0)
      );
      return NextResponse.json(existing[0], { status: 200 });
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        return NextResponse.json(
          {
            error: "insufficient_credits",
            requiredCredits: error.requiredCredits,
            balance: error.balance,
          },
          { status: 402 }
        );
      }
      throw error;
    }
  }

  const rows = await sql`
    INSERT INTO sessions (
      id, user_id, started_at, ended_at, duration_seconds, timezone,
      workout_type, trainer_name, goals, processing_mode,
      audio_retention_policy, local_status, remote_status, sync_status
    ) VALUES (
      ${id}, ${userId}, ${startedAt}, ${endedAt ?? null}, ${durationSeconds ?? null},
      ${timezone}, ${workoutType ?? null}, ${trainerName ?? null},
      ${JSON.stringify(goals)}, ${processingMode},
      ${audioRetentionPolicy}, 'locally_complete', 'uploaded', 'pending'
    ) RETURNING *
  `;

  try {
    await reserveCreditsForSession(userId, id, Number(durationSeconds ?? 0));
    return NextResponse.json(rows[0], { status: 201 });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json(
        {
          error: "insufficient_credits",
          requiredCredits: error.requiredCredits,
          balance: error.balance,
        },
        { status: 402 }
      );
    }
    throw error;
  }
}
