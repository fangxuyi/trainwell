import * as SQLite from "expo-sqlite";

export async function initDatabase(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      started_at TEXT NOT NULL,
      ended_at TEXT,
      timezone TEXT NOT NULL,
      duration_seconds INTEGER,
      workout_type TEXT,
      trainer_name TEXT,
      location TEXT,
      goals TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      processing_mode TEXT NOT NULL DEFAULT 'automatic_hybrid',
      local_status TEXT NOT NULL DEFAULT 'draft',
      remote_status TEXT NOT NULL DEFAULT 'not_created',
      sync_status TEXT NOT NULL DEFAULT 'local_only',
      local_version INTEGER NOT NULL DEFAULT 1,
      remote_version INTEGER,
      last_synced_version INTEGER,
      session_notes TEXT NOT NULL DEFAULT '[]',
      technique_themes TEXT NOT NULL DEFAULT '[]',
      accomplishments TEXT NOT NULL DEFAULT '[]',
      improvement_areas TEXT NOT NULL DEFAULT '[]',
      pain_observations TEXT NOT NULL DEFAULT '[]',
      next_session_plan TEXT,
      overall_difficulty REAL,
      energy_level REAL,
      markdown_content TEXT,
      local_markdown_path TEXT,
      remote_markdown_path TEXT,
      audio_retention_policy TEXT NOT NULL DEFAULT 'delete_after_review',
      extraction_version TEXT,
      summary_version TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audio_segments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      local_path TEXT NOT NULL,
      duration_seconds REAL NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT,
      local_status TEXT NOT NULL DEFAULT 'recording',
      remote_status TEXT NOT NULL DEFAULT 'pending',
      remote_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(session_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS transcript_segments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      audio_segment_id TEXT NOT NULL,
      start_seconds REAL NOT NULL,
      end_seconds REAL NOT NULL,
      speaker TEXT NOT NULL DEFAULT 'unknown',
      text TEXT NOT NULL,
      confidence REAL,
      reviewed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quick_notes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      offset_seconds REAL,
      created_at TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payload_reference TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      next_attempt_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_local_status ON sessions(local_status);
    CREATE INDEX IF NOT EXISTS idx_sessions_sync_status ON sessions(sync_status);
    CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audio_segments_session ON audio_segments(session_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_quick_notes_session ON quick_notes(session_id);
  `);
}
