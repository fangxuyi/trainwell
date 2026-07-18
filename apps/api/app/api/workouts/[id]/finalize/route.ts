import { NextRequest, NextResponse } from "next/server";
import { requireSessionOwner } from "@/lib/auth";
import { finalizeAndIndexSession } from "@/lib/session-index";
import type { ExtractionOutput } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const result = await finalizeAndIndexSession(
    id,
    owner.userId,
    body.exercises as ExtractionOutput["exercises"]
  );
  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: result.id,
    remote_status: result.remoteStatus,
    remote_version: result.remoteVersion,
    indexed_chunks: result.chunks,
  });
}
