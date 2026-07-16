import { NextRequest, NextResponse } from "next/server";
import { getUserId, unauthorized } from "@/lib/auth";
import { getStripeCustomerId } from "@/lib/credits";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const customer = await getStripeCustomerId(userId);
  if (!customer) {
    return NextResponse.json({ error: "No Stripe billing account" }, { status: 404 });
  }
  const session = await getStripe().billingPortal.sessions.create({
    customer,
    return_url: `${req.nextUrl.origin}/credits`,
  });
  return NextResponse.json({ url: session.url });
}
