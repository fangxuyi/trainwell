import { NextRequest, NextResponse } from "next/server";
import {
  CREDIT_PRODUCTS,
  isSubscriptionProduct,
  revenueCatProductKey,
  subscriptionTier,
} from "@/lib/billing";
import {
  expireSubscriptionCredits,
  grantPermanentCredits,
  resetSubscriptionCredits,
} from "@/lib/credits";

export const dynamic = "force-dynamic";

interface RevenueCatEvent {
  id: string;
  type: string;
  app_user_id: string;
  aliases?: string[];
  product_id: string;
  purchased_at_ms?: number;
  expiration_at_ms?: number;
  original_transaction_id?: string;
}

function clerkUserId(event: RevenueCatEvent): string | null {
  return [event.app_user_id, ...(event.aliases ?? [])].find((id) => id.startsWith("user_")) ?? null;
}

export async function POST(req: NextRequest) {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTHORIZATION;
  if (!expected || req.headers.get("authorization") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await req.json()) as { event?: RevenueCatEvent };
  const event = payload.event;
  if (!event?.id || !event.product_id) {
    return NextResponse.json({ error: "Invalid RevenueCat event" }, { status: 400 });
  }
  const userId = clerkUserId(event);
  const productKey = revenueCatProductKey(event.product_id);
  if (!userId || !productKey) return NextResponse.json({ received: true, ignored: true });

  const billingEvent = {
    id: `revenuecat:${event.id}`,
    userId,
    type: event.type,
    productId: event.product_id,
    payload,
  };

  if (event.type === "NON_RENEWING_PURCHASE" && productKey === "credits100") {
    await grantPermanentCredits(billingEvent, CREDIT_PRODUCTS[productKey].credits);
  } else if (
    (event.type === "INITIAL_PURCHASE" || event.type === "RENEWAL") &&
    isSubscriptionProduct(productKey) &&
    event.purchased_at_ms &&
    event.expiration_at_ms &&
    event.original_transaction_id
  ) {
    await resetSubscriptionCredits(
      billingEvent,
      CREDIT_PRODUCTS[productKey].credits,
      subscriptionTier(productKey),
      `revenuecat:${event.original_transaction_id}`,
      new Date(event.purchased_at_ms).toISOString(),
      new Date(event.expiration_at_ms).toISOString()
    );
  } else if (event.type === "EXPIRATION" && isSubscriptionProduct(productKey)) {
    if (event.original_transaction_id) {
      await expireSubscriptionCredits(
        billingEvent,
        `revenuecat:${event.original_transaction_id}`
      );
    }
  }

  return NextResponse.json({ received: true });
}
