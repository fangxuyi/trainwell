// One-time seeding script to import existing markdown workout summaries into the API.
// Usage: node seed-workouts.mjs

import { readFileSync } from "fs";
import { randomUUID } from "crypto";

const API_URL = "https://api-ebon-mu-79.vercel.app";

const WORKOUTS = [
  {
    file: "./summary-markdown/Workout 6-20-summary.md",
    startedAt: new Date(2026, 5, 20, 10, 0, 0).toISOString(), // June 20, 2026
    durationSeconds: 82 * 60, // ~82 min from the summary
  },
  {
    file: "./summary-markdown/Workout 6-28-summary.md",
    startedAt: new Date(2026, 5, 28, 10, 0, 0).toISOString(), // June 28, 2026
    durationSeconds: 62 * 60, // ~62 min estimated from the summary
  },
];

async function importWorkout(workout) {
  const content = readFileSync(workout.file, "utf8");
  const id = randomUUID();

  console.log(`Importing ${workout.file}...`);

  const res = await fetch(`${API_URL}/api/workouts/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      startedAt: workout.startedAt,
      durationSeconds: workout.durationSeconds,
      markdownContent: content,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  console.log(`  Created session ${data.id}`);
  return data;
}

for (const workout of WORKOUTS) {
  try {
    await importWorkout(workout);
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
  }
}

console.log("\nDone. Restart the app to see imported sessions in history.");
