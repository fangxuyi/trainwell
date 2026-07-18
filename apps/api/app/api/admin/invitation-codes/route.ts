import { createHash, randomBytes, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { isValidAdminSecret } from "@/lib/beta-access";
import sql from "@/lib/db";

export const dynamic = "force-dynamic";

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function codeHash(code: string): string {
  return createHash("sha256").update(normalizeCode(code)).digest("hex");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!isValidAdminSecret(body?.secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const code = normalizeCode(
    typeof body?.code === "string" && body.code.trim()
      ? body.code
      : `TW-${randomBytes(6).toString("hex")}`
  );
  const maxRedemptions = Number.isInteger(body?.maxRedemptions)
    ? Math.max(1, Math.min(body.maxRedemptions, 10_000))
    : 1;
  const expiresAt = typeof body?.expiresAt === "string" && !Number.isNaN(Date.parse(body.expiresAt))
    ? new Date(body.expiresAt).toISOString()
    : null;
  const existing = await sql`
    SELECT id FROM beta_invitation_codes
    WHERE code_hash = ${codeHash(code)}
    LIMIT 1
  `;
  if (existing.length > 0) {
    return NextResponse.json({ error: "Invitation code already exists" }, { status: 409 });
  }

  await sql`
    INSERT INTO beta_invitation_codes (
      id, code_hash, label, max_redemptions, expires_at
    ) VALUES (
      ${randomUUID()},
      ${codeHash(code)},
      ${typeof body?.label === "string" ? body.label.trim().slice(0, 120) : null},
      ${maxRedemptions},
      ${expiresAt}
    )
  `;

  return NextResponse.json({ code, maxRedemptions, expiresAt }, { status: 201 });
}
