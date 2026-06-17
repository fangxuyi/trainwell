-- Run once to initialize the Neon database

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'local',
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  duration_seconds INTEGER,
  workout_type TEXT,
  trainer_name TEXT,
  location TEXT,
  goals JSONB NOT NULL DEFAULT '[]',
  tags JSONB NOT NULL DEFAULT '[]',
  processing_mode TEXT NOT NULL DEFAULT 'automatic_hybrid',
  local_status TEXT NOT NULL DEFAULT 'draft',
  remote_status TEXT NOT NULL DEFAULT 'not_created',
  sync_status TEXT NOT NULL DEFAULT 'local_only',
  local_version INTEGER NOT NULL DEFAULT 1,
  remote_version INTEGER NOT NULL DEFAULT 1,
  exercises JSONB NOT NULL DEFAULT '[]',
  session_notes JSONB NOT NULL DEFAULT '[]',
  technique_themes JSONB NOT NULL DEFAULT '[]',
  accomplishments JSONB NOT NULL DEFAULT '[]',
  improvement_areas JSONB NOT NULL DEFAULT '[]',
  pain_observations JSONB NOT NULL DEFAULT '[]',
  next_session_plan JSONB,
  overall_difficulty REAL,
  energy_level REAL,
  markdown_content TEXT,
  audio_retention_policy TEXT NOT NULL DEFAULT 'delete_after_review',
  extraction_version TEXT,
  summary_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audio_segments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  blob_url TEXT,
  duration_seconds REAL NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  remote_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
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
  reviewed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS processing_jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_audio_segments_session ON audio_segments(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_transcript_session ON transcript_segments(session_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_session ON processing_jobs(session_id);
