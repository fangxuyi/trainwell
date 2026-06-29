import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";

export const dynamic = "force-dynamic";

// One-time migration endpoint — call once after deploying RAG changes.
// Protected by a shared secret to prevent accidental re-runs.
export async function POST(req: NextRequest) {
  const { secret } = await req.json().catch(() => ({}));
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await sql`CREATE EXTENSION IF NOT EXISTS vector`;

  await sql`
    CREATE TABLE IF NOT EXISTS session_chunks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      chunk_type TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding vector(512),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS session_chunks_session_id_idx
      ON session_chunks(session_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS session_chunks_embedding_idx
      ON session_chunks USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 10)
  `;

  return NextResponse.json({ ok: true, message: "pgvector migration complete" });
}
