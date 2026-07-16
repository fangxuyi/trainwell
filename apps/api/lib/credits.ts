import sql from "./db";

export interface CreditBalance {
  totalCredits: number;
  permanentCredits: number;
  subscriptionCredits: number;
  subscriptionTier: string | null;
  subscriptionPeriodEnd: string | null;
}

export class InsufficientCreditsError extends Error {
  constructor(
    readonly requiredCredits: number,
    readonly balance: CreditBalance
  ) {
    super("Insufficient credits");
  }
}

export function creditsForDuration(durationSeconds: number): number {
  return Math.max(1, Math.ceil(Math.max(0, durationSeconds) / 60));
}

export async function getCreditBalance(userId: string): Promise<CreditBalance> {
  await sql`SELECT ensure_credit_account(${userId})`;
  await sql`
    UPDATE credit_accounts
    SET subscription_credits = 0,
        subscription_tier = NULL,
        subscription_source = NULL,
        subscription_period_start = NULL,
        subscription_period_end = NULL,
        updated_at = now()
    WHERE user_id = ${userId}
      AND subscription_period_end IS NOT NULL
      AND subscription_period_end <= now()
  `;

  const rows = await sql`
    SELECT permanent_credits, subscription_credits, subscription_tier,
           subscription_period_end
    FROM credit_accounts
    WHERE user_id = ${userId}
  `;
  const row = rows[0];
  const permanentCredits = Number(row.permanent_credits);
  const subscriptionCredits = Number(row.subscription_credits);
  return {
    totalCredits: permanentCredits + subscriptionCredits,
    permanentCredits,
    subscriptionCredits,
    subscriptionTier: (row.subscription_tier as string | null) ?? null,
    subscriptionPeriodEnd: row.subscription_period_end
      ? new Date(row.subscription_period_end as string).toISOString()
      : null,
  };
}

export async function reserveCreditsForSession(
  userId: string,
  sessionId: string,
  durationSeconds: number
): Promise<void> {
  const requiredCredits = creditsForDuration(durationSeconds);
  try {
    await sql`
      SELECT * FROM reserve_session_credits(
        ${userId}, ${sessionId}, ${requiredCredits}
      )
    `;
  } catch (error) {
    if ((error as Error).message.includes("INSUFFICIENT_CREDITS")) {
      throw new InsufficientCreditsError(requiredCredits, await getCreditBalance(userId));
    }
    throw error;
  }
}

export async function consumeSessionCredits(sessionId: string): Promise<void> {
  await sql`SELECT consume_session_credits(${sessionId})`;
}

export async function refundSessionCredits(sessionId: string): Promise<void> {
  await sql`SELECT refund_session_credits(${sessionId})`;
}

interface BillingEventInput {
  id: string;
  userId: string;
  type: string;
  productId: string;
  payload: unknown;
}

export async function grantPermanentCredits(
  event: BillingEventInput,
  amount: number
): Promise<void> {
  await sql`
    SELECT apply_permanent_credit_grant(
      ${event.id}, ${event.userId}, ${amount}, ${event.type},
      ${event.productId}, ${JSON.stringify(event.payload)}::jsonb
    )
  `;
}

export async function resetSubscriptionCredits(
  event: BillingEventInput,
  amount: number,
  tier: string,
  source: string,
  periodStart: string,
  periodEnd: string
): Promise<void> {
  await sql`
    SELECT apply_subscription_allowance(
      ${event.id}, ${event.userId}, ${amount}, ${tier},
      ${source}, ${periodStart}, ${periodEnd}, ${event.type}, ${event.productId},
      ${JSON.stringify(event.payload)}::jsonb
    )
  `;
}

export async function expireSubscriptionCredits(
  event: BillingEventInput,
  source: string
): Promise<void> {
  await sql`
    SELECT expire_subscription_allowance(
      ${event.id}, ${event.userId}, ${source}, ${event.type}, ${event.productId},
      ${JSON.stringify(event.payload)}::jsonb
    )
  `;
}

export async function getStripeCustomerId(userId: string): Promise<string | null> {
  await sql`SELECT ensure_credit_account(${userId})`;
  const rows = await sql`
    SELECT stripe_customer_id FROM credit_accounts WHERE user_id = ${userId}
  `;
  return (rows[0]?.stripe_customer_id as string | null) ?? null;
}

export async function setStripeCustomerId(
  userId: string,
  customerId: string
): Promise<void> {
  await sql`SELECT ensure_credit_account(${userId})`;
  await sql`
    UPDATE credit_accounts
    SET stripe_customer_id = ${customerId}, updated_at = now()
    WHERE user_id = ${userId}
      AND (stripe_customer_id IS NULL OR stripe_customer_id = ${customerId})
  `;
}
