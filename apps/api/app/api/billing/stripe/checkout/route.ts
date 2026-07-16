import { NextRequest, NextResponse } from "next/server";
import {
  isCreditProductKey,
  isSubscriptionProduct,
  stripePriceId,
} from "@/lib/billing";
import { getUserId, unauthorized } from "@/lib/auth";
import { getCreditBalance, getStripeCustomerId } from "@/lib/credits";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const body = (await req.json().catch(() => ({}))) as { productKey?: string };
  if (!body.productKey || !isCreditProductKey(body.productKey)) {
    return NextResponse.json({ error: "Invalid product" }, { status: 400 });
  }

  const price = stripePriceId(body.productKey);
  if (!price) {
    return NextResponse.json({ error: "Stripe product is not configured" }, { status: 503 });
  }

  const subscription = isSubscriptionProduct(body.productKey);
  if (subscription && (await getCreditBalance(userId)).subscriptionTier) {
    return NextResponse.json(
      { error: "Cancel the active subscription before starting another plan" },
      { status: 409 }
    );
  }
  const customer = await getStripeCustomerId(userId);
  const metadata = { userId, productKey: body.productKey };
  const checkout = await getStripe().checkout.sessions.create({
    mode: subscription ? "subscription" : "payment",
    line_items: [{ price, quantity: 1 }],
    client_reference_id: userId,
    metadata,
    ...(customer ? { customer } : subscription ? {} : { customer_creation: "always" as const }),
    ...(subscription ? { subscription_data: { metadata } } : {}),
    success_url: `${req.nextUrl.origin}/credits?checkout=success`,
    cancel_url: `${req.nextUrl.origin}/credits?checkout=cancelled`,
  });

  if (!checkout.url) {
    return NextResponse.json({ error: "Stripe did not return a checkout URL" }, { status: 502 });
  }
  return NextResponse.json({ url: checkout.url });
}
