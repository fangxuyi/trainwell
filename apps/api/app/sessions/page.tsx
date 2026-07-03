import sql from "@/lib/db";
import Link from "next/link";

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
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const STATUS_COLORS: Record<string, string> = {
  finalized: "bg-emerald-900/50 text-emerald-400",
  review_required: "bg-amber-900/50 text-amber-400",
  processing: "bg-blue-900/50 text-blue-400",
  failed: "bg-red-900/50 text-red-400",
};

export default async function SessionsPage() {
  const rows = await sql`
    SELECT id, started_at, ended_at, duration_seconds, workout_type,
           trainer_name, remote_status, overall_difficulty
    FROM sessions
    WHERE remote_status IN ('finalized', 'review_required', 'processing')
    ORDER BY started_at DESC
  `;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Sessions</h1>
        <span className="text-sm text-zinc-500">{rows.length} total</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-zinc-500 text-center py-16">No sessions yet. Record your first workout in the app.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <Link
              key={row.id as string}
              href={`/sessions/${row.id}`}
              className="block bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-600 transition-colors group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-zinc-100 group-hover:text-sky-400 transition-colors">
                      {(row.workout_type as string) || "Workout"}
                    </span>
                    {row.trainer_name && (
                      <span className="text-xs text-zinc-500">
                        with {row.trainer_name as string}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-zinc-400">
                    <span>{fmt(row.started_at as string)}</span>
                    {row.duration_seconds && (
                      <span>{fmtDuration(row.duration_seconds as number)}</span>
                    )}
                    {row.overall_difficulty && (
                      <span>Difficulty {(row.overall_difficulty as number).toFixed(1)}/10</span>
                    )}
                  </div>
                </div>
                <span
                  className={`shrink-0 text-xs px-2 py-1 rounded-full font-medium ${
                    STATUS_COLORS[row.remote_status as string] ?? "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {row.remote_status as string}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
