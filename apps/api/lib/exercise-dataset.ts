import type {
  ExerciseRecord,
  ExerciseReferenceMedia,
  ExtractionOutput,
} from "@/lib/types";
import type {
  DistilledExercise,
  DistilledWorkoutTranscript,
  ExerciseDatasetCandidate,
} from "@/lib/transcript-distillation";
import { unstable_cache } from "next/cache";

interface DatasetExercise {
  id?: string;
  name?: string;
  equipment?: string;
  target?: string;
  body_part?: string;
  category?: string;
  muscle_group?: string;
  secondary_muscles?: string[];
  image?: string;
  gif_url?: string;
  attribution?: string;
}

const DATASET_URL =
  process.env.EXERCISE_DATASET_URL ??
  "https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/118e4bd6b14da6df0e36605d7169b65db18389a4/data/exercises.json";
const MEDIA_BASE_URL = process.env.EXERCISE_MEDIA_BASE_URL?.trim();
const CACHE_TTL_MS = 60 * 60 * 1000;

let cachedDataset: DatasetExercise[] | null = null;
let cachedAt = 0;
let datasetRequest: Promise<DatasetExercise[]> | null = null;

const ZH_ALIASES: Record<string, string> = {
  哑铃: "dumbbell",
  杠铃: "barbell",
  壶铃: "kettlebell",
  弹力带: "band",
  绳索: "cable",
  深蹲: "squat",
  硬拉: "deadlift",
  卧推: "bench press",
  推举: "press",
  划船: "row",
  弓步: "lunge",
  俯卧撑: "push up",
  引体向上: "pull up",
  平板支撑: "plank",
  臀桥: "glute bridge",
  侧平举: "lateral raise",
  前平举: "front raise",
  弯举: "curl",
};

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\w\u3400-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expandAliases(value: string): string {
  const aliases = Object.entries(ZH_ALIASES)
    .filter(([chinese]) => value.includes(chinese))
    .map(([, english]) => english);
  return `${value} ${aliases.join(" ")}`.trim();
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(normalize(expandAliases(left)).split(" ").filter(Boolean));
  const rightTokens = new Set(normalize(right).split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let matches = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) matches++;
  }
  return matches / leftTokens.size;
}

function textSimilarity(left: string, right: string): number {
  const normalizedLeft = normalize(expandAliases(left));
  const normalizedRight = normalize(expandAliases(right));
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;

  const overlap = Math.max(tokenOverlap(left, right), tokenOverlap(right, left));
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return Math.max(0.9, overlap);
  }
  return overlap;
}

function bestFieldSimilarity(leftValues: string[], rightValues: Array<string | undefined>): number {
  const availableRight = rightValues.filter((value): value is string => !!value);
  if (leftValues.length === 0 || availableRight.length === 0) return 0;
  return Math.max(
    ...leftValues.flatMap((left) => availableRight.map((right) => textSimilarity(left, right)))
  );
}

function datasetSearchText(exercise: DatasetExercise): string {
  return [
    exercise.name,
    exercise.equipment,
    exercise.target,
    exercise.body_part,
    exercise.category,
    exercise.muscle_group,
    ...(exercise.secondary_muscles ?? []),
  ]
    .filter((value): value is string => !!value)
    .join(" ");
}

function scoreCanonicalCandidate(candidate: ExerciseRecord, datasetExercise: DatasetExercise): number {
  if (!datasetExercise.name) return 0;

  const names = [candidate.canonicalName, ...candidate.spokenNames].filter(Boolean);
  const candidateText = names.join(" ");
  const normalizedCandidate = normalize(expandAliases(candidateText));
  const normalizedName = normalize(datasetExercise.name);
  const nameOverlap = tokenOverlap(candidateText, datasetExercise.name);
  const metadataOverlap = tokenOverlap(candidateText, datasetSearchText(datasetExercise));

  let score = nameOverlap * 0.8 + metadataOverlap * 0.2;
  if (normalizedCandidate === normalizedName) score += 0.3;
  if (normalizedCandidate.includes(normalizedName) || normalizedName.includes(normalizedCandidate)) {
    score += 0.15;
  }

  const candidateEquipment = candidate.equipment.map(normalize);
  if (candidateEquipment.some((equipment) => normalizedName.includes(equipment))) {
    score += 0.1;
  }

  return Math.min(score, 1);
}

function rankDistilledCandidate(
  exercise: DistilledExercise,
  datasetExercise: DatasetExercise
): ExerciseDatasetCandidate | null {
  if (!datasetExercise.name) return null;

  const names = [exercise.name, ...exercise.spokenNames].filter(Boolean);
  const nameScore = bestFieldSimilarity(names, [datasetExercise.name]);
  const equipmentScore = bestFieldSimilarity(exercise.equipment, [datasetExercise.equipment]);
  const bodyScore = bestFieldSimilarity(exercise.bodyRegions, [
    datasetExercise.target,
    datasetExercise.body_part,
    datasetExercise.muscle_group,
    ...(datasetExercise.secondary_muscles ?? []),
  ]);
  const categoryScore = exercise.category
    ? bestFieldSimilarity([exercise.category], [datasetExercise.category])
    : 0;
  const movementScore = exercise.movementDescription
    ? textSimilarity(exercise.movementDescription, datasetSearchText(datasetExercise))
    : 0;

  const weightedSignals = [
    { present: names.length > 0, score: nameScore, weight: 0.6 },
    { present: exercise.equipment.length > 0, score: equipmentScore, weight: 0.15 },
    { present: exercise.bodyRegions.length > 0, score: bodyScore, weight: 0.15 },
    { present: !!exercise.category, score: categoryScore, weight: 0.05 },
    { present: !!exercise.movementDescription, score: movementScore, weight: 0.05 },
  ].filter((signal) => signal.present);
  const totalWeight = weightedSignals.reduce((total, signal) => total + signal.weight, 0);
  const score = totalWeight > 0
    ? weightedSignals.reduce((total, signal) => total + signal.score * signal.weight, 0) /
      totalWeight
    : 0;
  if (score < 0.15) return null;

  const reasons: string[] = [];
  if (nameScore >= 0.75) reasons.push("strong spoken-name match");
  else if (nameScore >= 0.4) reasons.push("partial spoken-name match");
  if (equipmentScore >= 0.75) reasons.push("equipment match");
  if (bodyScore >= 0.5) reasons.push("body-region or target match");
  if (categoryScore >= 0.75) reasons.push("category match");
  if (movementScore >= 0.35) reasons.push("movement description overlaps catalog metadata");

  return {
    datasetId: datasetExercise.id,
    name: datasetExercise.name,
    equipment: datasetExercise.equipment,
    target: datasetExercise.target,
    bodyPart: datasetExercise.body_part,
    category: datasetExercise.category,
    muscleGroup: datasetExercise.muscle_group,
    score,
    recommended: false,
    reasons,
  };
}

export async function attachExerciseDatasetCandidates(
  distilled: DistilledWorkoutTranscript
): Promise<DistilledWorkoutTranscript> {
  const dataset = await getDataset();
  return {
    ...distilled,
    exercises: distilled.exercises.map((exercise) => {
      const ranked = dataset
        .map((entry) => rankDistilledCandidate(exercise, entry))
        .filter((candidate): candidate is ExerciseDatasetCandidate => !!candidate)
        .sort((left, right) => right.score - left.score)
        .slice(0, 3);
      const top = ranked[0];
      const runnerUp = ranked[1];
      const hasUnambiguousRecommendation =
        !!top && top.score >= 0.8 && (!runnerUp || top.score - runnerUp.score >= 0.08);

      return {
        ...exercise,
        datasetCandidates: ranked.map((candidate, index) => ({
          ...candidate,
          recommended: index === 0 && hasUnambiguousRecommendation,
        })),
      };
    }),
  };
}

function compactDatasetEntry(entry: DatasetExercise): DatasetExercise {
  return {
    id: entry.id,
    name: entry.name,
    equipment: entry.equipment,
    target: entry.target,
    body_part: entry.body_part,
    category: entry.category,
    muscle_group: entry.muscle_group,
    secondary_muscles: entry.secondary_muscles,
    image: entry.image,
    gif_url: entry.gif_url,
    attribution: entry.attribution,
  };
}

const loadCachedDataset = unstable_cache(
  async (): Promise<DatasetExercise[]> => {
    const response = await fetch(DATASET_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Exercise dataset request failed (${response.status})`);
    }

    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) throw new Error("Exercise dataset must be an array");

    return data
      .filter((entry): entry is DatasetExercise =>
        !!entry && typeof entry === "object" && typeof (entry as DatasetExercise).name === "string"
      )
      .map(compactDatasetEntry);
  },
  ["exercise-dataset", DATASET_URL],
  { revalidate: 3600 }
);

async function getDataset(): Promise<DatasetExercise[]> {
  if (cachedDataset && Date.now() - cachedAt < CACHE_TTL_MS) return cachedDataset;
  if (datasetRequest) return datasetRequest;

  datasetRequest = (async () => {
    cachedDataset = await loadCachedDataset();
    cachedAt = Date.now();
    return cachedDataset;
  })();

  try {
    return await datasetRequest;
  } finally {
    datasetRequest = null;
  }
}

export function preloadExerciseDataset(): void {
  void getDataset().catch((error) => {
    console.warn("Exercise dataset preload failed:", error);
  });
}

function resolveMediaUrl(path: string | undefined): string | undefined {
  if (!MEDIA_BASE_URL || !path) return undefined;

  try {
    const base = new URL(MEDIA_BASE_URL.endsWith("/") ? MEDIA_BASE_URL : `${MEDIA_BASE_URL}/`);
    const url = new URL(path.replace(/^\/+/, ""), base);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function referenceMediaFor(
  datasetExercise: DatasetExercise
): ExerciseReferenceMedia | undefined {
  const gifUrl = resolveMediaUrl(datasetExercise.gif_url);
  const attribution = datasetExercise.attribution?.trim();
  if (!datasetExercise.id || !gifUrl || !attribution) return undefined;

  return {
    datasetId: datasetExercise.id,
    imageUrl: resolveMediaUrl(datasetExercise.image),
    gifUrl,
    attribution,
  };
}

function matchExercise(
  exercise: ExerciseRecord,
  dataset: DatasetExercise[],
  allowFuzzyMatch = true
): DatasetExercise | undefined {
  const candidateNames = [exercise.canonicalName, ...exercise.spokenNames]
    .map(normalize)
    .filter(Boolean);
  const exactMatches = dataset.filter(
    (datasetExercise) =>
      !!datasetExercise.name && candidateNames.includes(normalize(datasetExercise.name))
  );
  if (exactMatches.length === 1) return exactMatches[0];
  if (!allowFuzzyMatch) return undefined;

  const matches = dataset
    .map((datasetExercise) => ({
      datasetExercise,
      score: scoreCanonicalCandidate(exercise, datasetExercise),
    }))
    .sort((left, right) => right.score - left.score);
  const best = matches[0];
  const nextBest = matches[1];

  if (
    !best?.datasetExercise.name ||
    best.score < 0.8 ||
    (nextBest && best.score - nextBest.score < 0.08)
  ) {
    return undefined;
  }

  return best.datasetExercise;
}

function canonicalizeExercise(
  exercise: ExerciseRecord,
  dataset: DatasetExercise[],
  allowFuzzyMatch = true
): ExerciseRecord {
  const datasetExercise = matchExercise(exercise, dataset, allowFuzzyMatch);
  if (!datasetExercise?.name) return exercise;

  const sameName = normalize(exercise.canonicalName) === normalize(datasetExercise.name);

  return {
    ...exercise,
    canonicalName: sameName ? exercise.canonicalName : datasetExercise.name,
    spokenNames: sameName
      ? exercise.spokenNames
      : [...new Set([exercise.canonicalName, ...exercise.spokenNames])],
    referenceMedia: referenceMediaFor(datasetExercise) ?? exercise.referenceMedia,
  };
}

export async function enrichExercisesWithMedia(
  exercises: ExerciseRecord[]
): Promise<ExerciseRecord[]> {
  if (!MEDIA_BASE_URL || exercises.length === 0) return exercises;
  const dataset = await getDataset();
  return exercises.map((exercise) => canonicalizeExercise(exercise, dataset));
}

export async function canonicalizeExtraction(
  extraction: ExtractionOutput,
  options: { allowFuzzyMatch?: boolean } = {}
): Promise<ExtractionOutput> {
  const dataset = await getDataset();
  return {
    ...extraction,
    exercises: extraction.exercises.map((exercise) =>
      canonicalizeExercise(exercise, dataset, options.allowFuzzyMatch ?? true)
    ),
  };
}
