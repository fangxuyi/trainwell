export const CREDIT_PRODUCTS = {
  credits100: { credits: 100, label: "100 credits", price: "$5" },
  monthly300: { credits: 300, label: "300 credits / month", price: "$6.99" },
  monthly800: { credits: 800, label: "800 credits / month", price: "$15.99" },
} as const;

export type CreditProductKey = keyof typeof CREDIT_PRODUCTS;

export function isCreditProductKey(value: string): value is CreditProductKey {
  return value in CREDIT_PRODUCTS;
}

export function isSubscriptionProduct(
  productKey: CreditProductKey
): productKey is "monthly300" | "monthly800" {
  return productKey !== "credits100";
}

export function subscriptionTier(productKey: "monthly300" | "monthly800"): string {
  return productKey === "monthly300" ? "monthly_300" : "monthly_800";
}

export function revenueCatProductKey(productId: string): CreditProductKey | null {
  const products: Record<string, CreditProductKey> = {
    [process.env.REVENUECAT_CREDITS_100_PRODUCT_ID ?? "trainwell_credits_100"]:
      "credits100",
    [process.env.REVENUECAT_MONTHLY_300_PRODUCT_ID ?? "trainwell_monthly_300"]:
      "monthly300",
    [process.env.REVENUECAT_MONTHLY_800_PRODUCT_ID ?? "trainwell_monthly_800"]:
      "monthly800",
  };
  return products[productId] ?? null;
}

export function stripePriceId(productKey: CreditProductKey): string | null {
  const prices: Record<CreditProductKey, string | undefined> = {
    credits100: process.env.STRIPE_CREDITS_100_PRICE_ID,
    monthly300: process.env.STRIPE_MONTHLY_300_PRICE_ID,
    monthly800: process.env.STRIPE_MONTHLY_800_PRICE_ID,
  };
  return prices[productKey] ?? null;
}
