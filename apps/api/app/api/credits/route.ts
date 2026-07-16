import { NextResponse } from "next/server";
import { getUserId, unauthorized } from "@/lib/auth";
import { getCreditBalance } from "@/lib/credits";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  return NextResponse.json(await getCreditBalance(userId));
}
