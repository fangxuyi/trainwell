import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { id, title, startedAt, endedAt, durationSeconds, markdownContent, timezone = "UTC" } = body;

  if (!startedAt || !markdownContent) {
    return NextResponse.json(
      { error: "startedAt and markdownContent are required" },
      { status: 400 }
    );
  }

  const sessionId: string = id ?? randomUUID();

  const existing = await sql`SELECT id FROM sessions WHERE id = ${sessionId}`;
  if (existing.length > 0) {
    return NextResponse.json(existing[0], { status: 200 });
  }

  const rows = await sql`
    INSERT INTO sessions (
      id, started_at, ended_at, duration_seconds, timezone,
      workout_type, processing_mode, audio_retention_policy,
      local_status, remote_status, sync_status,
      markdown_content
    ) VALUES (
      ${sessionId},
      ${startedAt},
      ${endedAt ?? null},
      ${durationSeconds ?? null},
      ${timezone},
      ${"Strength Training"},
      ${"local_only"},
      ${"keep_forever"},
      ${"cached"},
      ${"finalized"},
      ${"synced"},
      ${markdownContent}
    ) RETURNING *
  `;

  return NextResponse.json(rows[0], { status: 201 });
}
