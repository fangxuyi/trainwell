import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getCreditBalance, getStripeCustomerId } from "@/lib/credits";
import { BillingButtons } from "./BillingButtons";

export const dynamic = "force-dynamic";

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const [balance, stripeCustomer, query] = await Promise.all([
    getCreditBalance(userId),
    getStripeCustomerId(userId),
    searchParams,
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Credits</h1>
      <p className="mt-2 text-zinc-400">One credit transcribes one started minute.</p>

      {query.checkout === "success" && (
        <p className="mt-5 rounded-lg border border-emerald-800 bg-emerald-950/50 p-3 text-sm text-emerald-300">
          Payment received. Your balance updates as soon as Stripe confirms it.
        </p>
      )}

      <div className="my-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div className="text-5xl font-bold text-zinc-100">{balance.totalCredits}</div>
        <div className="mt-1 font-medium text-sky-400">credits available</div>
        <div className="mt-4 space-y-1 text-sm text-zinc-400">
          <p>{balance.permanentCredits} free or purchased credits</p>
          <p>{balance.subscriptionCredits} monthly credits</p>
          {balance.subscriptionPeriodEnd && (
            <p>Monthly allowance resets {new Date(balance.subscriptionPeriodEnd).toLocaleDateString()}</p>
          )}
        </div>
      </div>

      <BillingButtons hasStripeCustomer={Boolean(stripeCustomer)} />
    </div>
  );
}
