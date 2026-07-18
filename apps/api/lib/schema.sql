-- Run once to initialize the Neon database

CREATE EXTENSION IF NOT EXISTS vector;

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

CREATE TABLE IF NOT EXISTS session_chunks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  chunk_type TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

CREATE TABLE IF NOT EXISTS credit_accounts (
  user_id TEXT PRIMARY KEY,
  permanent_credits INTEGER NOT NULL DEFAULT 100 CHECK (permanent_credits >= 0),
  subscription_credits INTEGER NOT NULL DEFAULT 0 CHECK (subscription_credits >= 0),
  subscription_tier TEXT,
  subscription_period_start TIMESTAMPTZ,
  subscription_period_end TIMESTAMPTZ,
  subscription_source TEXT,
  stripe_customer_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_reservations (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  required_credits INTEGER NOT NULL CHECK (required_credits > 0),
  subscription_credits INTEGER NOT NULL DEFAULT 0 CHECK (subscription_credits >= 0),
  permanent_credits INTEGER NOT NULL DEFAULT 0 CHECK (permanent_credits >= 0),
  subscription_period_end TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'consumed', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT,
  type TEXT NOT NULL,
  permanent_delta INTEGER NOT NULL DEFAULT 0,
  subscription_delta INTEGER NOT NULL DEFAULT 0,
  external_event_id TEXT UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  product_id TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS beta_invitation_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  max_redemptions INTEGER NOT NULL DEFAULT 1 CHECK (max_redemptions > 0),
  redemption_count INTEGER NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS beta_access_users (
  user_id TEXT PRIMARY KEY,
  invitation_code_id TEXT REFERENCES beta_invitation_codes(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'invitation_code',
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS body_measurements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  body_part TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL CHECK (value > 0),
  unit TEXT NOT NULL CHECK (unit IN ('cm', 'in')),
  measured_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS session_chunks_session_id_idx ON session_chunks(session_id);
CREATE INDEX IF NOT EXISTS session_chunks_embedding_idx
  ON session_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
CREATE INDEX IF NOT EXISTS session_chunks_content_search_idx
  ON session_chunks USING gin (to_tsvector('english', content));
CREATE INDEX IF NOT EXISTS idx_audio_segments_session ON audio_segments(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_transcript_session ON transcript_segments(session_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_session ON processing_jobs(session_id);
CREATE INDEX IF NOT EXISTS credit_transactions_user_idx ON credit_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS beta_invitation_codes_active_idx
  ON beta_invitation_codes(active, expires_at);
CREATE INDEX IF NOT EXISTS body_measurements_user_date_idx
  ON body_measurements(user_id, measured_at DESC);
