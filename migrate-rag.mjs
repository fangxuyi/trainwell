// One-time migration: enable pgvector and create session_chunks table.
// Usage: DATABASE_URL=<neon-url> node migrate-rag.mjs

import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL env var required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

console.log("Enabling pgvector extension...");
await sql`CREATE EXTENSION IF NOT EXISTS vector`;

console.log("Creating session_chunks table...");
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

// IVFFlat index for fast cosine similarity search
// lists=10 is appropriate for small datasets (< 10k chunks)
await sql`
  CREATE INDEX IF NOT EXISTS session_chunks_embedding_idx
    ON session_chunks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 10)
`;

console.log("Done.");
