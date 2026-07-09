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
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId } = await auth();
  const rows = await sql`
    SELECT * FROM sessions WHERE id = ${id} AND user_id = ${userId}
  `;
  if (rows.length === 0) notFound();
  const s = rows[0];

  const exercises: ExerciseRecord[] = Array.isArray(s.exercises)
    ? (s.exercises as ExerciseRecord[])
    : [];

  const markdownHtml = s.markdown_content
    ? (await marked(s.markdown_content as string))
    : null;

  return (
    <div>
      {/* Back link */}
      <Link
        href="/sessions"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-6"
      >
        ← All Sessions
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">
          {(s.workout_type as string) || "Workout"}
        </h1>
        <p className="text-zinc-400">{fmt(s.started_at as string)}</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <StatCard label="Duration" value={fmtDuration(s.duration_seconds as number | null)} />
        {s.trainer_name && (
          <StatCard label="Trainer" value={s.trainer_name as string} />
        )}
        {s.overall_difficulty && (
          <StatCard label="Difficulty" value={`${(s.overall_difficulty as number).toFixed(1)} / 10`} />
        )}
        {exercises.length > 0 && (
          <StatCard label="Exercises" value={String(exercises.length)} />
        )}
      </div>

      {/* Accomplishments */}
      {Array.isArray(s.accomplishments) && (s.accomplishments as string[]).length > 0 && (
        <Section title="Accomplishments">
          <ul className="space-y-1">
            {(s.accomplishments as string[]).map((a, i) => (
              <li key={i} className="flex gap-2 text-sm text-zinc-300">
                <span className="text-emerald-400 mt-0.5">✓</span>
                {a}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Improvement areas */}
      {Array.isArray(s.improvement_areas) && (s.improvement_areas as string[]).length > 0 && (
        <Section title="Focus Areas">
          <ul className="space-y-1">
            {(s.improvement_areas as string[]).map((a, i) => (
              <li key={i} className="flex gap-2 text-sm text-zinc-300">
                <span className="text-amber-400 mt-0.5">→</span>
                {a}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Exercises */}
      {exercises.length > 0 && (
        <Section title="Exercises">
          <div className="space-y-2">
            {exercises.map((ex, i) => (
              <div key={i} className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-zinc-100">{ex.canonicalName}</span>
                  {ex.sets.length > 0 && (
                    <span className="text-xs text-zinc-500">{ex.sets.length} set{ex.sets.length !== 1 ? "s" : ""}</span>
                  )}
                </div>
                {ex.techniqueNotes.length > 0 && (
                  <p className="text-xs text-zinc-400 mt-1">{ex.techniqueNotes[0].text}</p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Full session summary */}
      {markdownHtml && (
        <Section title="Session Summary">
          <div
            className="prose-sm text-zinc-300 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: markdownHtml }}
          />
        </Section>
      )}

      {/* Ask AI link */}
      <div className="mt-10 pt-6 border-t border-zinc-800">
        <Link
          href={`/ask?session=${id}`}
          className="inline-flex items-center gap-2 text-sm text-sky-400 hover:text-sky-300 transition-colors"
        >
          Ask AI about this session →
        </Link>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
      <div className="text-xs text-zinc-500 mb-0.5">{label}</div>
      <div className="font-semibold text-zinc-100 text-sm">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">{title}</h2>
      {children}
    </div>
  );
}
