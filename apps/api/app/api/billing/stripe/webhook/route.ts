import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  CREDIT_PRODUCTS,
  isCreditProductKey,
  isSubscriptionProduct,
  subscriptionTier,
} from "@/lib/billing";
import {
  expireSubscriptionCredits,
  grantPermanentCredits,
  resetSubscriptionCredits,
  setStripeCustomerId,
} from "@/lib/credits";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

function customerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null) {
  return typeof customer === "string" ? customer : customer?.id ?? null;
}

function resourceId<T extends { id: string }>(resource: string | T | null): string | null {
  return typeof resource === "string" ? resource : resource?.id ?? null;
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) {
    return NextResponse.json({ error: "Stripe webhook is not configured" }, { status: 503 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(await req.text(), signature, secret);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object;
    const userId = session.metadata?.userId ?? session.client_reference_id;
    const productKey = session.metadata?.productKey;
    if (userId && productKey && isCreditProductKey(productKey)) {
      const customer = customerId(session.customer);
      if (customer) await setStripeCustomerId(userId, customer);
      if (!isSubscriptionProduct(productKey) && session.payment_status === "paid") {
        await grantPermanentCredits(
          {
            id: `stripe:${event.id}`,
            userId,
            type: event.type,
            productId: productKey,
            payload: event,
          },
          CREDIT_PRODUCTS[productKey].credits
        );
      }
    }
  }

  if (event.type === "invoice.paid") {
    const invoice = event.data.object;
    const metadata = invoice.parent?.subscription_details?.metadata;
    const subscriptionId = resourceId(
      invoice.parent?.subscription_details?.subscription ?? null
    );
    const userId = metadata?.userId;
    const productKey = metadata?.productKey;
    const line =
      invoice.lines.data.find(
        (item) => item.parent?.subscription_item_details?.proration === false
      ) ?? invoice.lines.data[0];
    if (
      userId &&
      productKey &&
      isCreditProductKey(productKey) &&
      isSubscriptionProduct(productKey) &&
      subscriptionId &&
      line
    ) {
      const customer = customerId(invoice.customer);
      if (customer) await setStripeCustomerId(userId, customer);
      await resetSubscriptionCredits(
        {
          id: `stripe:${event.id}`,
          userId,
          type: event.type,
          productId: productKey,
          payload: event,
        },
        CREDIT_PRODUCTS[productKey].credits,
        subscriptionTier(productKey),
        `stripe:${subscriptionId}`,
        new Date(line.period.start * 1000).toISOString(),
        new Date(line.period.end * 1000).toISOString()
      );
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    const { userId, productKey } = subscription.metadata;
    if (userId && productKey && isCreditProductKey(productKey)) {
      await expireSubscriptionCredits(
        {
          id: `stripe:${event.id}`,
          userId,
          type: event.type,
          productId: productKey,
          payload: event,
        },
        `stripe:${subscription.id}`
      );
    }
  }

  return NextResponse.json({ received: true });
}
