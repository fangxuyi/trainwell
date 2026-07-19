"use client";

import Image from "next/image";
import { useState } from "react";
import type { ExerciseRecord } from "@/lib/types";

export default function ExerciseList({ exercises }: { exercises: ExerciseRecord[] }) {
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);

  return (
    <div className="grid gap-2.5">
      {exercises.map((exercise, index) => {
        const completedSets = exercise.sets.filter((set) => set.completed);
        const firstWeight = completedSets.find((set) => set.weight)?.weight;
        const cue = exercise.techniqueNotes
          ?.map((note) => (typeof note?.text === "string" ? note.text.trim() : ""))
          .find(Boolean);
        const exerciseKey = exercise.id || String(index);
        const isPreviewing = activeExerciseId === exerciseKey;

        return (
          <article
            key={exerciseKey}
            className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#070A11]/45 transition hover:border-[#C7F36B]/20"
          >
            <div className="flex gap-3 p-3.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#202736] text-xs font-black text-[#C7F36B]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-extrabold text-[#F5F7FA]">{exercise.canonicalName}</h3>
                  <div className="flex items-center gap-2 text-[0.65rem] font-bold text-[#667085]">
                    {completedSets.length > 0 && (
                      <span>{completedSets.length} set{completedSets.length === 1 ? "" : "s"}</span>
                    )}
                    {firstWeight && (
                      <span className="rounded-full bg-white/[0.05] px-2 py-1 text-[#9CA7B8]">
                        {firstWeight.value} {firstWeight.unit}
                      </span>
                    )}
                  </div>
                </div>
                {cue && (
                  <p className="mt-2 border-l-2 border-[#9B8AFB]/50 pl-3 text-xs leading-5 text-[#9CA7B8]">
                    {cue}
                  </p>
                )}
                {exercise.referenceMedia && (
                  <button
                    type="button"
                    aria-expanded={isPreviewing}
                    onClick={() => setActiveExerciseId(isPreviewing ? null : exerciseKey)}
                    className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#C7F36B]/20 bg-[#C7F36B]/[0.06] px-3 py-1.5 text-[0.68rem] font-black uppercase tracking-[0.08em] text-[#C7F36B] transition hover:bg-[#C7F36B]/10"
                  >
                    <span aria-hidden>{isPreviewing ? "×" : "▶"}</span>
                    {isPreviewing ? "Close movement" : "View movement"}
                  </button>
                )}
              </div>
              {exercise.referenceMedia?.imageUrl && !isPreviewing && (
                <Image
                  src={exercise.referenceMedia.imageUrl}
                  alt=""
                  width={64}
                  height={64}
                  unoptimized
                  className="size-16 shrink-0 rounded-xl bg-white object-cover opacity-85"
                />
              )}
            </div>

            {exercise.referenceMedia && isPreviewing && (
              <div className="border-t border-white/[0.07] bg-white/[0.025] p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <Image
                    src={exercise.referenceMedia.gifUrl}
                    alt={`${exercise.canonicalName} movement demonstration`}
                    width={180}
                    height={180}
                    unoptimized
                    className="size-[180px] rounded-2xl bg-white object-contain"
                  />
                  <div>
                    <p className="text-sm font-extrabold text-[#F5F7FA]">Movement reference</p>
                    <p className="mt-1 max-w-sm text-xs leading-5 text-[#9CA7B8]">
                      Use this as a visual reminder, not a substitute for your trainer&apos;s cues or
                      individualized guidance.
                    </p>
                    <a
                      href="https://gymvisual.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-block text-[0.65rem] font-bold text-[#667085] underline decoration-white/15 underline-offset-4 hover:text-[#9CA7B8]"
                    >
                      {exercise.referenceMedia.attribution}
                    </a>
                  </div>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
