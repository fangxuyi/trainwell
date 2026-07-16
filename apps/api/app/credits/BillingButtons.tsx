"use client";

import { useState } from "react";

interface Product {
  key: "credits100" | "monthly300" | "monthly800";
  title: string;
  price: string;
  description: string;
}

const PRODUCTS: Product[] = [
  { key: "credits100", title: "100 credits", price: "$5", description: "One-time purchase. Credits never expire." },
  { key: "monthly300", title: "300 credits monthly", price: "$6.99/mo", description: "Resets to 300 credits each paid month." },
  { key: "monthly800", title: "800 credits monthly", price: "$15.99/mo", description: "Resets to 800 credits each paid month." },
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
    <div className="space-y-3">
      {PRODUCTS.map((product) => (
        <div key={product.key} className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-zinc-100">{product.title}</h2>
            <p className="mt-1 text-sm text-zinc-400">{product.description}</p>
          </div>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => startCheckout(product.key)}
            className="rounded-lg bg-sky-500 px-4 py-2 font-semibold text-zinc-950 disabled:opacity-50"
          >
            {pending === product.key ? "Opening…" : product.price}
          </button>
        </div>
      ))}
      {hasStripeCustomer && (
        <button
          type="button"
          disabled={pending !== null}
          onClick={manageBilling}
          className="text-sm font-medium text-sky-400 hover:text-sky-300 disabled:opacity-50"
        >
          {pending === "portal" ? "Opening…" : "Manage Stripe subscription and payment methods"}
        </button>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
