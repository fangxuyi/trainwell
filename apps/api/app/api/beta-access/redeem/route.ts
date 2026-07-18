import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUserId, unauthorized } from "@/lib/auth";
import { hasBetaAccess, isBetaInviteRequired } from "@/lib/beta-access";
import sql from "@/lib/db";

export const dynamic = "force-dynamic";

function codeHash(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export async function POST(req: NextRequest) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return unauthorized();
  if (!isBetaInviteRequired() || await hasBetaAccess(userId)) {
    return NextResponse.json({ allowed: true });
  }

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code) {
    return NextResponse.json({ error: "Invitation code is required" }, { status: 400 });
  }

  const rows = await sql`
    WITH claimed AS (
      UPDATE beta_invitation_codes
      SET redemption_count = redemption_count + 1,
          updated_at = now()
      WHERE code_hash = ${codeHash(code)}
        AND active = true
        AND redemption_count < max_redemptions
        AND (expires_at IS NULL OR expires_at > now())
        AND NOT EXISTS (
          SELECT 1 FROM beta_access_users WHERE user_id = ${userId}
        )
      RETURNING id
    ), granted AS (
      INSERT INTO beta_access_users (user_id, invitation_code_id, source)
      SELECT ${userId}, id, 'invitation_code' FROM claimed
      ON CONFLICT (user_id) DO NOTHING
      RETURNING user_id
    )
    SELECT EXISTS(SELECT 1 FROM granted) AS allowed
  `;

  if (rows[0]?.allowed !== true) {
    return NextResponse.json(
      { error: "This invitation code is invalid, expired, or fully used" },
      { status: 400 }
    );
  }

  return NextResponse.json({ allowed: true });
}
