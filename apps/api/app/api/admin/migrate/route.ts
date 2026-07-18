import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
import { isValidAdminSecret } from "@/lib/beta-access";

export const dynamic = "force-dynamic";

// Idempotent migration endpoint for server-side feature additions.
// Protected by a shared secret to prevent unauthorized schema changes.
export async function POST(req: NextRequest) {
  const { secret } = await req.json().catch(() => ({}));
  if (!isValidAdminSecret(secret)) {
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

  await sql`
    CREATE INDEX IF NOT EXISTS session_chunks_content_search_idx
      ON session_chunks USING gin (to_tsvector('english', content))
  `;

  await sql`
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
    )
  `;

  await sql`
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
    )
  `;

  await sql`
    ALTER TABLE credit_accounts
      ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE
  `;

  await sql`
    ALTER TABLE credit_accounts
      ADD COLUMN IF NOT EXISTS subscription_source TEXT
  `;

  await sql`
    ALTER TABLE credit_reservations
      ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ
  `;

  await sql`
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
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS billing_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      product_id TEXT,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS credit_transactions_user_idx
      ON credit_transactions(user_id, created_at DESC)
  `;

  await sql`
    CREATE OR REPLACE FUNCTION ensure_credit_account(p_user_id TEXT)
    RETURNS VOID AS $function$
    DECLARE
      v_inserted INTEGER;
    BEGIN
      INSERT INTO credit_accounts (user_id)
      VALUES (p_user_id)
      ON CONFLICT (user_id) DO NOTHING;

      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      IF v_inserted > 0 THEN
        INSERT INTO credit_transactions (
          user_id, type, permanent_delta, external_event_id
        ) VALUES (
          p_user_id, 'initial_grant', 100, 'initial:' || p_user_id
        ) ON CONFLICT (external_event_id) DO NOTHING;
      END IF;
    END;
    $function$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE OR REPLACE FUNCTION reserve_session_credits(
      p_user_id TEXT,
      p_session_id TEXT,
      p_required INTEGER
    ) RETURNS TABLE (
      required_credits INTEGER,
      subscription_used INTEGER,
      permanent_used INTEGER,
      subscription_remaining INTEGER,
      permanent_remaining INTEGER
    ) AS $function$
    DECLARE
      v_status TEXT;
      v_subscription INTEGER;
      v_permanent INTEGER;
      v_subscription_used INTEGER;
      v_permanent_used INTEGER;
    BEGIN
      PERFORM ensure_credit_account(p_user_id);

      PERFORM 1 FROM credit_accounts
      WHERE user_id = p_user_id
      FOR UPDATE;

      UPDATE credit_accounts
      SET subscription_credits = 0,
          subscription_tier = NULL,
          subscription_source = NULL,
          subscription_period_start = NULL,
          subscription_period_end = NULL,
          updated_at = now()
      WHERE user_id = p_user_id
        AND subscription_period_end IS NOT NULL
        AND subscription_period_end <= now();

      SELECT status INTO v_status
      FROM credit_reservations
      WHERE session_id = p_session_id AND user_id = p_user_id
      FOR UPDATE;

      IF v_status IN ('reserved', 'consumed') THEN
        RETURN QUERY
        SELECT r.required_credits, r.subscription_credits, r.permanent_credits,
               a.subscription_credits, a.permanent_credits
        FROM credit_reservations r
        JOIN credit_accounts a ON a.user_id = r.user_id
        WHERE r.session_id = p_session_id;
        RETURN;
      END IF;

      SELECT a.subscription_credits, a.permanent_credits
      INTO v_subscription, v_permanent
      FROM credit_accounts a
      WHERE a.user_id = p_user_id;

      IF v_subscription + v_permanent < p_required THEN
        RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
      END IF;

      v_subscription_used := LEAST(v_subscription, p_required);
      v_permanent_used := p_required - v_subscription_used;

      UPDATE credit_accounts
      SET subscription_credits = subscription_credits - v_subscription_used,
          permanent_credits = permanent_credits - v_permanent_used,
          updated_at = now()
      WHERE user_id = p_user_id;

      INSERT INTO credit_reservations (
        session_id, user_id, required_credits, subscription_credits,
        permanent_credits, subscription_period_end, status
      ) VALUES (
        p_session_id, p_user_id, p_required, v_subscription_used,
        v_permanent_used,
        (SELECT subscription_period_end FROM credit_accounts WHERE user_id = p_user_id),
        'reserved'
      ) ON CONFLICT (session_id) DO UPDATE SET
        required_credits = EXCLUDED.required_credits,
        subscription_credits = EXCLUDED.subscription_credits,
        permanent_credits = EXCLUDED.permanent_credits,
        subscription_period_end = EXCLUDED.subscription_period_end,
        status = 'reserved',
        updated_at = now()
      WHERE credit_reservations.user_id = p_user_id
        AND credit_reservations.status = 'refunded';

      INSERT INTO credit_transactions (
        user_id, session_id, type, permanent_delta, subscription_delta
      ) VALUES (
        p_user_id, p_session_id, 'reservation',
        -v_permanent_used, -v_subscription_used
      );

      RETURN QUERY
      SELECT p_required, v_subscription_used, v_permanent_used,
             v_subscription - v_subscription_used,
             v_permanent - v_permanent_used;
    END;
    $function$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE OR REPLACE FUNCTION consume_session_credits(p_session_id TEXT)
    RETURNS BOOLEAN AS $function$
    DECLARE
      v_updated INTEGER;
    BEGIN
      UPDATE credit_reservations
      SET status = 'consumed', updated_at = now()
      WHERE session_id = p_session_id AND status = 'reserved';
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      RETURN v_updated > 0;
    END;
    $function$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE OR REPLACE FUNCTION refund_session_credits(p_session_id TEXT)
    RETURNS BOOLEAN AS $function$
    DECLARE
      v_reservation credit_reservations%ROWTYPE;
      v_user_id TEXT;
      v_subscription_refund INTEGER;
    BEGIN
      SELECT user_id INTO v_user_id
      FROM credit_reservations
      WHERE session_id = p_session_id;

      IF NOT FOUND THEN RETURN FALSE; END IF;

      PERFORM 1 FROM credit_accounts
      WHERE user_id = v_user_id
      FOR UPDATE;

      SELECT * INTO v_reservation
      FROM credit_reservations
      WHERE session_id = p_session_id
      FOR UPDATE;

      IF NOT FOUND OR v_reservation.status <> 'reserved' THEN
        RETURN FALSE;
      END IF;

      v_subscription_refund := CASE
        WHEN EXISTS (
          SELECT 1 FROM credit_accounts
          WHERE user_id = v_reservation.user_id
            AND subscription_period_end = v_reservation.subscription_period_end
            AND subscription_period_end > now()
        ) THEN v_reservation.subscription_credits
        ELSE 0
      END;

      UPDATE credit_accounts
      SET subscription_credits = subscription_credits + v_subscription_refund,
          permanent_credits = permanent_credits + v_reservation.permanent_credits,
          updated_at = now()
      WHERE user_id = v_reservation.user_id;

      UPDATE credit_reservations
      SET status = 'refunded', updated_at = now()
      WHERE session_id = p_session_id;

      INSERT INTO credit_transactions (
        user_id, session_id, type, permanent_delta, subscription_delta
      ) VALUES (
        v_reservation.user_id, p_session_id, 'refund',
        v_reservation.permanent_credits, v_subscription_refund
      );

      RETURN TRUE;
    END;
    $function$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE OR REPLACE FUNCTION apply_permanent_credit_grant(
      p_event_id TEXT,
      p_user_id TEXT,
      p_amount INTEGER,
      p_event_type TEXT,
      p_product_id TEXT,
      p_payload JSONB
    ) RETURNS BOOLEAN AS $function$
    DECLARE
      v_inserted INTEGER;
    BEGIN
      INSERT INTO billing_events (id, user_id, type, product_id, payload)
      VALUES (p_event_id, p_user_id, p_event_type, p_product_id, p_payload)
      ON CONFLICT (id) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      IF v_inserted = 0 THEN RETURN FALSE; END IF;

      PERFORM ensure_credit_account(p_user_id);
      UPDATE credit_accounts
      SET permanent_credits = permanent_credits + p_amount, updated_at = now()
      WHERE user_id = p_user_id;

      INSERT INTO credit_transactions (
        user_id, type, permanent_delta, external_event_id,
        metadata
      ) VALUES (
        p_user_id, 'purchase', p_amount, p_event_id,
        jsonb_build_object('product_id', p_product_id)
      );
      RETURN TRUE;
    END;
    $function$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE OR REPLACE FUNCTION apply_subscription_allowance(
      p_event_id TEXT,
      p_user_id TEXT,
      p_amount INTEGER,
      p_tier TEXT,
      p_source TEXT,
      p_period_start TIMESTAMPTZ,
      p_period_end TIMESTAMPTZ,
      p_event_type TEXT,
      p_product_id TEXT,
      p_payload JSONB
    ) RETURNS BOOLEAN AS $function$
    DECLARE
      v_inserted INTEGER;
      v_previous INTEGER;
    BEGIN
      INSERT INTO billing_events (id, user_id, type, product_id, payload)
      VALUES (p_event_id, p_user_id, p_event_type, p_product_id, p_payload)
      ON CONFLICT (id) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      IF v_inserted = 0 THEN RETURN FALSE; END IF;

      PERFORM ensure_credit_account(p_user_id);
      SELECT subscription_credits INTO v_previous
      FROM credit_accounts WHERE user_id = p_user_id FOR UPDATE;

      UPDATE credit_accounts
      SET subscription_credits = p_amount,
          subscription_tier = p_tier,
          subscription_source = p_source,
          subscription_period_start = p_period_start,
          subscription_period_end = p_period_end,
          updated_at = now()
      WHERE user_id = p_user_id;

      INSERT INTO credit_transactions (
        user_id, type, subscription_delta, external_event_id, metadata
      ) VALUES (
        p_user_id, 'subscription_reset', p_amount - v_previous, p_event_id,
        jsonb_build_object('product_id', p_product_id, 'tier', p_tier)
      );
      RETURN TRUE;
    END;
    $function$ LANGUAGE plpgsql
  `;

  await sql`
    CREATE OR REPLACE FUNCTION expire_subscription_allowance(
      p_event_id TEXT,
      p_user_id TEXT,
      p_source TEXT,
      p_event_type TEXT,
      p_product_id TEXT,
      p_payload JSONB
    ) RETURNS BOOLEAN AS $function$
    DECLARE
      v_inserted INTEGER;
      v_previous INTEGER;
      v_updated INTEGER;
    BEGIN
      INSERT INTO billing_events (id, user_id, type, product_id, payload)
      VALUES (p_event_id, p_user_id, p_event_type, p_product_id, p_payload)
      ON CONFLICT (id) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      IF v_inserted = 0 THEN RETURN FALSE; END IF;

      PERFORM ensure_credit_account(p_user_id);
      SELECT subscription_credits INTO v_previous
      FROM credit_accounts WHERE user_id = p_user_id FOR UPDATE;

      UPDATE credit_accounts
      SET subscription_credits = 0,
          subscription_tier = NULL,
          subscription_source = NULL,
          subscription_period_start = NULL,
          subscription_period_end = NULL,
          updated_at = now()
      WHERE user_id = p_user_id AND subscription_source = p_source;
      GET DIAGNOSTICS v_updated = ROW_COUNT;

      IF v_updated = 0 THEN RETURN FALSE; END IF;

      INSERT INTO credit_transactions (
        user_id, type, subscription_delta, external_event_id,
        metadata
      ) VALUES (
        p_user_id, 'subscription_expired', -v_previous, p_event_id,
        jsonb_build_object('product_id', p_product_id)
      );
      RETURN TRUE;
    END;
    $function$ LANGUAGE plpgsql
  `;

  await sql`
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
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS beta_access_users (
      user_id TEXT PRIMARY KEY,
      invitation_code_id TEXT REFERENCES beta_invitation_codes(id) ON DELETE SET NULL,
      source TEXT NOT NULL DEFAULT 'invitation_code',
      granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS beta_invitation_codes_active_idx
      ON beta_invitation_codes(active, expires_at)
  `;

  await sql`
    INSERT INTO beta_access_users (user_id, source)
    SELECT user_id, 'existing_user'
    FROM (
      SELECT DISTINCT user_id FROM sessions WHERE user_id <> 'local'
      UNION
      SELECT DISTINCT user_id FROM credit_accounts
    ) existing_users
    ON CONFLICT (user_id) DO NOTHING
  `;

  return NextResponse.json({ ok: true, message: "database migrations complete" });
}
