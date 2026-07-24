import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getCreditBalance, getStripeCustomerId } from "@/lib/credits";
import { BillingButtons } from "./BillingButtons";

export const dynamic = "force-dynamic";

function membershipName(tier: string | null): string {
  if (tier === "monthly_300") return "300-minute monthly";
  if (tier === "monthly_800") return "800-minute monthly";
  return "Pay as you go";
}

export default async function CreditsPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const [balance, stripeCustomer, query] = await Promise.all([
    getCreditBalance(userId),
    getStripeCustomerId(userId),
    searchParams,
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <p className="eyebrow">Your training balance</p>
        <h1 className="page-title mt-2 text-4xl font-black text-[#F5F7FA] sm:text-5xl">Credits & plans</h1>
        <p className="mt-3 text-sm leading-6 text-[#9CA7B8]">One credit covers one started minute of transcription.</p>
      </header>

      {query.checkout === "success" && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-[#79D99B]/20 bg-[#17351D]/55 p-4 text-sm text-[#A6E8BB]">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#79D99B] text-xs font-black text-[#17351D]">✓</span>
          <span>Payment received. Your balance updates as soon as Stripe confirms it.</span>
        </div>
      )}

      {balance.stripeBillingStatus && (
        <div className="mt-6 rounded-2xl border border-[#FF7D7D]/25 bg-[#3A1E24]/55 p-4 text-sm text-[#FFB0B0]">
          <p className="font-black text-[#FFD0D0]">Payment needs attention</p>
          <p className="mt-1 leading-6">{balance.stripeBillingMessage ?? "Open billing to update your payment method."}</p>
        </div>
      )}

      <section className="relative my-7 overflow-hidden rounded-[30px] bg-[#C7F36B] p-6 text-[#101707] shadow-[0_24px_70px_rgba(199,243,107,0.1)] sm:p-8">
        <div className="absolute -right-16 -top-24 size-72 rounded-full border-[48px] border-[#101707]/[0.055]" />
        <div className="relative grid gap-7 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <p className="text-[0.65rem] font-black uppercase tracking-[0.17em] text-[#506A28]">Available now</p>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="text-7xl font-black tracking-[-0.09em] sm:text-8xl">{balance.totalCredits}</span>
              <span className="text-sm font-black text-[#3E5220]">credits</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-64">
            <BalancePart label="Permanent" value={balance.permanentCredits} />
            <BalancePart label="Monthly" value={balance.subscriptionCredits} />
          </div>
        </div>
      </section>

      <section className="portal-card mb-9 flex items-center gap-4 rounded-[22px] p-4 sm:p-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#211C3A] text-[#9B8AFB]">◆</span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.62rem] font-black uppercase tracking-[0.15em] text-[#667085]">Current membership</p>
          <p className="mt-1 font-extrabold text-[#F5F7FA]">{membershipName(balance.subscriptionTier)}</p>
          <p className="mt-1 text-xs text-[#667085]">
            {balance.subscriptionPeriodEnd
              ? `Monthly allowance resets ${new Date(balance.subscriptionPeriodEnd).toLocaleDateString()}`
              : "Permanent credits stay available until you use them."}
          </p>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Choose your pace</p>
            <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">Available options</h2>
          </div>
          <span className="hidden text-xs font-bold text-[#667085] sm:block">Secure Stripe checkout</span>
        </div>
        <BillingButtons hasStripeCustomer={Boolean(stripeCustomer)} />
      </section>
    </div>
  );
}

function BalancePart({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[#101707]/10 bg-[#101707]/[0.055] p-3.5">
      <p className="text-xl font-black tracking-[-0.05em]">{value}</p>
      <p className="mt-1 text-[0.62rem] font-black uppercase tracking-[0.11em] text-[#506A28]">{label}</p>
    </div>
  );
}
