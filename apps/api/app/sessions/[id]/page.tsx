import { notFound } from "next/navigation";
import Link from "next/link";
import sql from "@/lib/db";
import { marked } from "marked";
import { auth } from "@clerk/nextjs/server";
import type { ExerciseRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

function fmt(date: string) {
  return new Date(date).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDuration(seconds: number | null) {
  if (!seconds) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId } = await auth();
  const rows = await sql`
    SELECT * FROM sessions WHERE id = ${id} AND user_id = ${userId}
  `;
  if (rows.length === 0) notFound();
  const session = rows[0];
  const date = new Date(session.started_at as string);
  const exercises: ExerciseRecord[] = Array.isArray(session.exercises)
    ? (session.exercises as ExerciseRecord[])
    : [];
  const markdownHtml = session.markdown_content
    ? await marked(session.markdown_content as string)
    : null;

  return (
    <div>
      <Link
        href="/sessions"
        className="mb-7 inline-flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-xs font-bold text-[#9CA7B8] transition hover:border-[#C7F36B]/25 hover:text-[#C7F36B]"
      >
        <span aria-hidden>←</span>
        All sessions
      </Link>

      <section className="relative mb-6 overflow-hidden rounded-[30px] border border-white/[0.08] bg-[#101520] p-6 sm:p-8">
        <div className="absolute -right-20 -top-28 size-64 rounded-full border-[44px] border-[#C7F36B]/[0.035]" />
        <div className="absolute bottom-0 right-24 size-32 rounded-full bg-[#9B8AFB]/[0.04] blur-2xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Session recap</p>
            <h1 className="page-title mt-3 text-4xl font-black text-[#F5F7FA] sm:text-5xl">
              {(session.workout_type as string) || "Training session"}
            </h1>
            <p className="mt-3 text-sm text-[#9CA7B8]">{fmt(session.started_at as string)}</p>
            {session.trainer_name && (
              <p className="mt-1 text-sm font-semibold text-[#667085]">with {session.trainer_name as string}</p>
            )}
          </div>
          <div className="flex size-20 shrink-0 flex-col items-center justify-center rounded-[24px] bg-[#C7F36B] text-[#101707] shadow-[0_18px_50px_rgba(199,243,107,0.12)]">
            <span className="text-[0.62rem] font-black tracking-[0.16em]">
              {date.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}
            </span>
            <span className="text-3xl font-black tracking-[-0.08em]">{date.getDate()}</span>
          </div>
        </div>
      </section>

      <section className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Duration" value={fmtDuration(session.duration_seconds as number | null)} />
        <StatCard label="Exercises" value={String(exercises.length)} />
        <StatCard label="Difficulty" value={session.overall_difficulty ? `${(session.overall_difficulty as number).toFixed(1)} / 10` : "—"} />
        <StatCard label="Status" value={session.remote_status === "finalized" ? "Finalized" : "Ready"} accent />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.75fr)] lg:items-start">
        <div className="space-y-5">
          {exercises.length > 0 && (
            <Section eyebrow="Movement breakdown" title="Exercises">
              <div className="grid gap-2.5">
                {exercises.map((exercise, index) => {
                  const completedSets = exercise.sets.filter((set) => set.completed);
                  const firstWeight = completedSets.find((set) => set.weight)?.weight;
                  return (
                    <div key={exercise.id || index} className="group flex gap-3 rounded-2xl border border-white/[0.07] bg-[#070A11]/45 p-3.5 transition hover:border-[#C7F36B]/20">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#202736] text-xs font-black text-[#C7F36B]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-extrabold text-[#F5F7FA]">{exercise.canonicalName}</h3>
                          <div className="flex items-center gap-2 text-[0.65rem] font-bold text-[#667085]">
                            {completedSets.length > 0 && <span>{completedSets.length} set{completedSets.length === 1 ? "" : "s"}</span>}
                            {firstWeight && <span className="rounded-full bg-white/[0.05] px-2 py-1 text-[#9CA7B8]">{firstWeight.value} {firstWeight.unit}</span>}
                          </div>
                        </div>
                        {exercise.techniqueNotes.length > 0 && (
                          <p className="mt-2 border-l-2 border-[#9B8AFB]/50 pl-3 text-xs leading-5 text-[#9CA7B8]">
                            {exercise.techniqueNotes[0].text}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {markdownHtml && (
            <Section eyebrow="Generated record" title="Session summary">
              <div
                className="prose-sm text-sm leading-7 text-[#9CA7B8]"
                dangerouslySetInnerHTML={{ __html: markdownHtml }}
              />
            </Section>
          )}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-24">
          {Array.isArray(session.accomplishments) && (session.accomplishments as string[]).length > 0 && (
            <InsightCard label="What went well" color="lime" items={session.accomplishments as string[]} />
          )}
          {Array.isArray(session.improvement_areas) && (session.improvement_areas as string[]).length > 0 && (
            <InsightCard label="Focus next" color="violet" items={session.improvement_areas as string[]} />
          )}
          <Link
            href={`/ask?session=${id}`}
            className="group block overflow-hidden rounded-[24px] bg-[#C7F36B] p-5 text-[#101707] shadow-[0_20px_55px_rgba(199,243,107,0.1)] transition hover:-translate-y-0.5"
          >
            <span className="text-[0.62rem] font-black tracking-[0.16em] text-[#506A28]">TRAINING INTELLIGENCE</span>
            <span className="mt-2 block text-xl font-black tracking-[-0.04em]">Ask about this session</span>
            <span className="mt-4 flex items-center justify-between text-sm font-extrabold">
              Explore your history
              <span className="flex size-8 items-center justify-center rounded-full bg-[#101707] text-[#C7F36B] transition group-hover:rotate-12">↗</span>
            </span>
          </Link>
        </aside>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? "border-[#C7F36B]/15 bg-[#17351D]/60" : "border-white/[0.07] bg-white/[0.035]"}`}>
      <div className="text-[0.62rem] font-black uppercase tracking-[0.14em] text-[#667085]">{label}</div>
      <div className={`mt-2 text-base font-black tracking-[-0.03em] ${accent ? "text-[#79D99B]" : "text-[#F5F7FA]"}`}>{value}</div>
    </div>
  );
}

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="portal-card rounded-[26px] p-5 sm:p-6">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-2 mb-5 text-xl font-black tracking-[-0.035em] text-[#F5F7FA]">{title}</h2>
      {children}
    </section>
  );
}

function InsightCard({ label, color, items }: { label: string; color: "lime" | "violet"; items: string[] }) {
  const style = color === "lime"
    ? { card: "border-[#79D99B]/15 bg-[#17351D]/45", dot: "bg-[#79D99B]", text: "text-[#79D99B]" }
    : { card: "border-[#9B8AFB]/15 bg-[#211C3A]/55", dot: "bg-[#9B8AFB]", text: "text-[#9B8AFB]" };
  return (
    <section className={`rounded-[24px] border p-5 ${style.card}`}>
      <p className={`text-[0.64rem] font-black uppercase tracking-[0.16em] ${style.text}`}>{label}</p>
      <ul className="mt-4 space-y-3">
        {items.map((item, index) => (
          <li key={index} className="flex gap-3 text-sm leading-5 text-[#C7CFDA]">
            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${style.dot}`} />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
