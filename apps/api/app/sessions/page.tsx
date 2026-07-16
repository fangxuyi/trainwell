import sql from "@/lib/db";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

function fmt(date: string) {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDuration(seconds: number | null) {
  if (!seconds) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const STATUS_STYLES: Record<string, { label: string; className: string; dot: string }> = {
  finalized: { label: "Finalized", className: "bg-[#17351D] text-[#79D99B]", dot: "bg-[#79D99B]" },
  review_required: { label: "Ready to review", className: "bg-[#352C17] text-[#F4C76B]", dot: "bg-[#F4C76B]" },
  processing: { label: "Processing", className: "bg-[#172C45] text-[#76B7FF]", dot: "bg-[#76B7FF]" },
  failed: { label: "Needs attention", className: "bg-[#3A1E24] text-[#FF7D7D]", dot: "bg-[#FF7D7D]" },
};

export default async function SessionsPage() {
  const { userId } = await auth();
  const rows = await sql`
    SELECT id, started_at, ended_at, duration_seconds, workout_type,
           trainer_name, remote_status, overall_difficulty
    FROM sessions
    WHERE user_id = ${userId}
      AND remote_status IN ('finalized', 'review_required', 'processing')
    ORDER BY started_at DESC
  `;
  const totalMinutes = Math.round(
    rows.reduce((total, row) => total + Number(row.duration_seconds ?? 0), 0) / 60
  );
  const readyCount = rows.filter((row) => row.remote_status !== "processing").length;

  return (
    <div>
      <section className="mb-8 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="eyebrow">Your progress</p>
          <h1 className="page-title mt-3 max-w-2xl text-4xl font-black leading-[1.02] text-[#F5F7FA] sm:text-5xl">
            Your training, remembered.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-[#9CA7B8] sm:text-base">
            Every set, coaching cue, and breakthrough—organized into a history you can build on.
          </p>
        </div>
        <Link
          href="/ask"
          className="inline-flex w-fit items-center gap-3 rounded-2xl bg-[#C7F36B] px-5 py-3.5 text-sm font-black text-[#101707] shadow-[0_18px_45px_rgba(199,243,107,0.12)] transition hover:-translate-y-0.5 hover:bg-[#D3FA80]"
        >
          <span>Ask about your training</span>
          <span aria-hidden>↗</span>
        </Link>
      </section>

      <section className="mb-9 grid grid-cols-2 gap-3 sm:max-w-xl sm:grid-cols-3">
        <Metric label="Sessions" value={String(rows.length)} />
        <Metric label="Minutes captured" value={totalMinutes.toLocaleString()} />
        <Metric label="Ready to revisit" value={String(readyCount)} className="col-span-2 sm:col-span-1" />
      </section>

      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="eyebrow">Workout archive</p>
          <h2 className="mt-2 text-xl font-extrabold tracking-[-0.03em]">Recent sessions</h2>
        </div>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 text-xs font-bold text-[#667085]">
          {rows.length} total
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="portal-card rounded-[28px] px-6 py-16 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#C7F36B]/10 text-2xl text-[#C7F36B]">01</div>
          <h2 className="mt-5 text-xl font-black">Your first session starts on mobile.</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#667085]">
            Record a workout in the Trainwell app and your structured history will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {rows.map((row, index) => {
            const date = new Date(row.started_at as string);
            const status = STATUS_STYLES[row.remote_status as string] ?? STATUS_STYLES.processing;
            return (
              <Link
                key={row.id as string}
                href={`/sessions/${row.id}`}
                className="portal-card portal-card-hover group grid grid-cols-[3.6rem_1fr_auto] items-center gap-4 rounded-[22px] p-3.5 sm:grid-cols-[4.2rem_1fr_auto] sm:gap-5 sm:p-4"
              >
                <div className="flex aspect-square flex-col items-center justify-center rounded-2xl border border-white/[0.08] bg-[#070A11]/60">
                  <span className="text-[0.58rem] font-black tracking-[0.14em] text-[#C7F36B]">
                    {date.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}
                  </span>
                  <span className="mt-0.5 text-xl font-black tracking-[-0.08em] text-[#F5F7FA] sm:text-2xl">{date.getDate()}</span>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-extrabold text-[#F5F7FA] transition group-hover:text-[#C7F36B] sm:text-base">
                      {(row.workout_type as string) || "Training session"}
                    </h3>
                    {index === 0 && <span className="hidden rounded-full bg-[#9B8AFB]/10 px-2 py-0.5 text-[0.58rem] font-black tracking-wide text-[#9B8AFB] sm:inline">LATEST</span>}
                  </div>
                  <p className="mt-1 truncate text-xs text-[#667085] sm:text-sm">
                    {fmt(row.started_at as string)}
                    {row.trainer_name ? ` · with ${row.trainer_name as string}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.68rem] font-semibold text-[#9CA7B8]">
                    {row.duration_seconds ? <span>{fmtDuration(row.duration_seconds as number)}</span> : null}
                    {row.overall_difficulty ? <><span className="text-[#394255]">•</span><span>Difficulty {(row.overall_difficulty as number).toFixed(1)}/10</span></> : null}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[0.65rem] font-extrabold sm:flex ${status.className}`}>
                    <span className={`size-1.5 rounded-full ${status.dot}`} />
                    {status.label}
                  </span>
                  <span className="flex size-9 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.035] text-lg text-[#667085] transition group-hover:border-[#C7F36B]/30 group-hover:text-[#C7F36B]">›</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/[0.07] bg-white/[0.035] px-4 py-3.5 ${className}`}>
      <div className="text-xl font-black tracking-[-0.05em] text-[#F5F7FA]">{value}</div>
      <div className="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-[#667085]">{label}</div>
    </div>
  );
}
