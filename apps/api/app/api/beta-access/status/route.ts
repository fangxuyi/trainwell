import { NextResponse } from "next/server";
import { getAuthenticatedUserId, unauthorized } from "@/lib/auth";
import { hasBetaAccess, isBetaInviteRequired } from "@/lib/beta-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getAuthenticatedUserId();
  if (!userId) return unauthorized();

  return NextResponse.json({
    required: isBetaInviteRequired(),
    allowed: await hasBetaAccess(userId),
  });
}
