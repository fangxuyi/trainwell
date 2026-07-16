"use client";

import { useState } from "react";

interface Product {
  key: "credits100" | "monthly300" | "monthly800";
  eyebrow: string;
  title: string;
  price: string;
  cadence?: string;
  description: string;
  featured?: boolean;
}

const PRODUCTS: Product[] = [
  { key: "credits100", eyebrow: "Flexible", title: "100 credits", price: "$5", description: "A one-time top-up. These credits never expire." },
  { key: "monthly300", eyebrow: "Consistent", title: "300 credits", price: "$6.99", cadence: "/ month", description: "For a regular training schedule. Resets each paid month.", featured: true },
  { key: "monthly800", eyebrow: "Committed", title: "800 credits", price: "$15.99", cadence: "/ month", description: "Built for frequent sessions and longer workouts." },
];

async function redirectFromPost(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = (await response.json()) as { url?: string; error?: string };
  if (!response.ok || !result.url) throw new Error(result.error ?? "Billing request failed");
  window.location.assign(result.url);
}

export function BillingButtons({ hasStripeCustomer }: { hasStripeCustomer: boolean }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(productKey: Product["key"]) {
    setPending(productKey);
    setError(null);
    try {
      await redirectFromPost("/api/billing/stripe/checkout", { productKey });
    } catch (caught) {
      setError((caught as Error).message);
      setPending(null);
    }
  }

  async function manageBilling() {
    setPending("portal");
    setError(null);
    try {
      await redirectFromPost("/api/billing/stripe/portal");
    } catch (caught) {
      setError((caught as Error).message);
      setPending(null);
    }
  }

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-3">
        {PRODUCTS.map((product) => (
          <article
            key={product.key}
            className={`relative flex min-h-64 flex-col overflow-hidden rounded-[24px] border p-5 ${
              product.featured
                ? "border-[#C7F36B]/30 bg-[#17351D]/55"
                : "border-white/[0.08] bg-[#101520]"
            }`}
          >
            {product.featured && (
              <span className="absolute right-3 top-3 rounded-full bg-[#C7F36B] px-2.5 py-1 text-[0.56rem] font-black tracking-wide text-[#101707]">POPULAR</span>
            )}
            <p className={`text-[0.62rem] font-black uppercase tracking-[0.16em] ${product.featured ? "text-[#79D99B]" : "text-[#667085]"}`}>{product.eyebrow}</p>
            <h3 className="mt-4 text-xl font-black tracking-[-0.04em] text-[#F5F7FA]">{product.title}</h3>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-black tracking-[-0.06em] text-[#F5F7FA]">{product.price}</span>
              {product.cadence && <span className="text-xs font-bold text-[#667085]">{product.cadence}</span>}
            </div>
            <p className="mt-4 flex-1 text-xs leading-5 text-[#9CA7B8]">{product.description}</p>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => startCheckout(product.key)}
              className={`mt-5 flex w-full items-center justify-between rounded-xl px-4 py-3 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-40 ${
                product.featured
                  ? "bg-[#C7F36B] text-[#101707] hover:bg-[#D3FA80]"
                  : "bg-[#202736] text-[#F5F7FA] hover:bg-[#293244]"
              }`}
            >
              <span>{pending === product.key ? "Opening checkout…" : "Choose option"}</span>
              <span aria-hidden>→</span>
            </button>
          </article>
        ))}
      </div>

      <div className="mt-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-xs leading-5 text-[#667085]">Payments are fulfilled by verified Stripe webhooks before credits are added.</p>
        {hasStripeCustomer && (
          <button
            type="button"
            disabled={pending !== null}
            onClick={manageBilling}
            className="shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-2.5 text-xs font-bold text-[#9CA7B8] transition hover:border-[#C7F36B]/20 hover:text-[#C7F36B] disabled:opacity-40"
          >
            {pending === "portal" ? "Opening…" : "Manage billing"}
          </button>
        )}
      </div>
      {error && <p className="mt-4 rounded-xl border border-[#FF7D7D]/20 bg-[#3A1E24]/50 p-3 text-sm text-[#FF9A9A]">{error}</p>}
    </div>
  );
}
