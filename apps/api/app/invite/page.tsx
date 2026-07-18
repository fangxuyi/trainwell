"use client";

import { useState } from "react";

export default function InvitePage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function redeem() {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/beta-access/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Invitation could not be redeemed");
      window.location.assign("/sessions");
    } catch (redeemError) {
      setError((redeemError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[65vh] max-w-lg items-center">
      <section className="portal-card w-full rounded-[30px] p-7 sm:p-9">
        <p className="eyebrow">Private beta</p>
        <h1 className="page-title mt-3 text-4xl font-black text-[#F5F7FA]">You’re invited to train.</h1>
        <p className="mt-4 text-sm leading-6 text-[#9CA7B8]">
          Trainwell is currently available to invited beta testers. Enter your code to unlock the app.
        </p>
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === "Enter") redeem();
          }}
          autoCapitalize="characters"
          autoComplete="one-time-code"
          placeholder="TW-XXXXXXXXXXXX"
          className="mt-7 w-full rounded-2xl border border-white/[0.09] bg-[#101520] px-4 py-4 font-mono text-base tracking-[0.12em] text-[#F5F7FA] outline-none placeholder:text-[#4D5667] focus:border-[#C7F36B]/40"
        />
        {error && <p className="mt-3 text-sm font-semibold text-[#FF7D7D]">{error}</p>}
        <button
          onClick={redeem}
          disabled={!code.trim() || busy}
          className="mt-4 w-full rounded-2xl bg-[#C7F36B] px-5 py-4 text-sm font-black text-[#101707] transition hover:bg-[#D3FA80] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Checking code…" : "Unlock Trainwell"}
        </button>
      </section>
    </div>
  );
}
