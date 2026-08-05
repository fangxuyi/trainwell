import type { ExerciseRecord } from "./types";
import sql from "./db";
import { generateText } from "./language-model";

export type ReviewChangeKind =
  | "exercise_added"
  | "exercise_removed"
  | "exercise_renamed"
  | "set_added"
  | "set_removed"
  | "reps_changed"
  | "weight_changed"
  | "cue_added"
  | "cue_removed"
  | "cue_changed";

export interface ReviewChange {
  kind: ReviewChangeKind;
  exerciseId: string;
  setNumber?: number;
  before?: unknown;
  after?: unknown;
}

export interface ReviewDiff {
  version: 1;
  changes: ReviewChange[];
  changeCounts: Partial<Record<ReviewChangeKind, number>>;
}

export interface SanitizedEvaluationProposal {
  version: 1;
  source: "finalized_review_diff";
  workflowVersion: string;
  changeCount: number;
  changeCounts: Partial<Record<ReviewChangeKind, number>>;
  categories: string[];
  likelyCause: EvaluationCause;
  causeConfidence: number;
  suggestedIntervention: EvaluationIntervention;
  recommendation: string;
  acceptanceCriteria: string[];
}

export type EvaluationCause =
  | "transcription_or_source_ambiguity"
  | "extraction_omission"
  | "window_boundary_reconciliation"
  | "exercise_canonicalization"
  | "planned_completed_confusion"
  | "rep_or_weight_extraction"
  | "coaching_cue_extraction"
  | "user_preference_or_unspoken_information"
  | "insufficient_evidence";

export type EvaluationIntervention =
  | "prompt_rule"
  | "boundary_logic"
  | "canonicalization_rule"
  | "transcription_quality"
  | "review_experience"
  | "evaluation_case_only"
  | "no_change";

export interface EvaluationAnalysis {
  version: 1;
  likelyCause: EvaluationCause;
  confidence: number;
  affectedCategories: string[];
  suggestedIntervention: EvaluationIntervention;
}

const EVALUATION_CAUSES: EvaluationCause[] = [
  "transcription_or_source_ambiguity",
  "extraction_omission",
  "window_boundary_reconciliation",
  "exercise_canonicalization",
  "planned_completed_confusion",
  "rep_or_weight_extraction",
  "coaching_cue_extraction",
  "user_preference_or_unspoken_information",
  "insufficient_evidence",
];

const EVALUATION_INTERVENTIONS: EvaluationIntervention[] = [
  "prompt_rule",
  "boundary_logic",
  "canonicalization_rule",
  "transcription_quality",
  "review_experience",
  "evaluation_case_only",
  "no_change",
];

const EVALUATION_ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "number", enum: [1] },
    likelyCause: { type: "string", enum: EVALUATION_CAUSES },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    affectedCategories: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "exercise_completeness",
          "exercise_identification",
          "set_counting",
          "rep_extraction",
          "weight_extraction",
          "coaching_cues",
        ],
      },
    },
    suggestedIntervention: { type: "string", enum: EVALUATION_INTERVENTIONS },
  },
  required: [
    "version",
    "likelyCause",
    "confidence",
    "affectedCategories",
    "suggestedIntervention",
  ],
};

function cueTexts(exercise: ExerciseRecord): string[] {
  return (exercise.techniqueNotes ?? []).map((note) => note.text.trim());
}

function comparableWeight(set: ExerciseRecord["sets"][number]): { value: number; unit: string } | null {
  return set.weight ? { value: set.weight.value, unit: set.weight.unit } : null;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addChange(changes: ReviewChange[], change: ReviewChange): void {
  changes.push(change);
}

export function buildReviewDiff(
  generatedExercises: ExerciseRecord[],
  reviewedExercises: ExerciseRecord[]
): ReviewDiff {
  const changes: ReviewChange[] = [];
  const generatedById = new Map(generatedExercises.map((exercise) => [exercise.id, exercise]));
  const reviewedById = new Map(reviewedExercises.map((exercise) => [exercise.id, exercise]));

  for (const generated of generatedExercises) {
    const reviewed = reviewedById.get(generated.id);
    if (!reviewed) {
      addChange(changes, {
        kind: "exercise_removed",
        exerciseId: generated.id,
        before: generated.canonicalName,
      });
      continue;
    }

    if (generated.canonicalName.trim() !== reviewed.canonicalName.trim()) {
      addChange(changes, {
        kind: "exercise_renamed",
        exerciseId: generated.id,
        before: generated.canonicalName,
        after: reviewed.canonicalName,
      });
    }

    const sharedSetCount = Math.min(generated.sets.length, reviewed.sets.length);
    for (let index = 0; index < sharedSetCount; index += 1) {
      const generatedSet = generated.sets[index];
      const reviewedSet = reviewed.sets[index];
      const setNumber = index + 1;
      if (generatedSet.completedReps !== reviewedSet.completedReps) {
        addChange(changes, {
          kind: "reps_changed",
          exerciseId: generated.id,
          setNumber,
          before: generatedSet.completedReps ?? null,
          after: reviewedSet.completedReps ?? null,
        });
      }

      const generatedWeight = comparableWeight(generatedSet);
      const reviewedWeight = comparableWeight(reviewedSet);
      if (!jsonEqual(generatedWeight, reviewedWeight)) {
        addChange(changes, {
          kind: "weight_changed",
          exerciseId: generated.id,
          setNumber,
          before: generatedWeight,
          after: reviewedWeight,
        });
      }
    }

    for (let index = sharedSetCount; index < generated.sets.length; index += 1) {
      addChange(changes, {
        kind: "set_removed",
        exerciseId: generated.id,
        setNumber: index + 1,
        before: generated.sets[index],
      });
    }
    for (let index = sharedSetCount; index < reviewed.sets.length; index += 1) {
      addChange(changes, {
        kind: "set_added",
        exerciseId: generated.id,
        setNumber: index + 1,
        after: reviewed.sets[index],
      });
    }

    const generatedCues = cueTexts(generated);
    const reviewedCues = cueTexts(reviewed);
    const sharedCueCount = Math.min(generatedCues.length, reviewedCues.length);
    for (let index = 0; index < sharedCueCount; index += 1) {
      if (generatedCues[index] !== reviewedCues[index]) {
        addChange(changes, {
          kind: "cue_changed",
          exerciseId: generated.id,
          before: generatedCues[index],
          after: reviewedCues[index],
        });
      }
    }
    for (let index = sharedCueCount; index < generatedCues.length; index += 1) {
      addChange(changes, {
        kind: "cue_removed",
        exerciseId: generated.id,
        before: generatedCues[index],
      });
    }
    for (let index = sharedCueCount; index < reviewedCues.length; index += 1) {
      addChange(changes, {
        kind: "cue_added",
        exerciseId: generated.id,
        after: reviewedCues[index],
      });
    }
  }

  for (const reviewed of reviewedExercises) {
    if (!generatedById.has(reviewed.id)) {
      addChange(changes, {
        kind: "exercise_added",
        exerciseId: reviewed.id,
        after: reviewed.canonicalName,
      });
    }
  }

  const changeCounts: Partial<Record<ReviewChangeKind, number>> = {};
  for (const change of changes) {
    changeCounts[change.kind] = (changeCounts[change.kind] ?? 0) + 1;
  }

  return { version: 1, changes, changeCounts };
}

export function buildSanitizedEvaluationProposal(
  diff: ReviewDiff,
  workflowVersion: string,
  analysis: EvaluationAnalysis = {
    version: 1,
    likelyCause: "insufficient_evidence",
    confidence: 0,
    affectedCategories: [],
    suggestedIntervention: "evaluation_case_only",
  }
): SanitizedEvaluationProposal {
  const kinds = new Set(diff.changes.map((change) => change.kind));
  const categories = new Set<string>();
  if (kinds.has("exercise_added") || kinds.has("exercise_removed")) {
    categories.add("exercise_completeness");
  }
  if (kinds.has("exercise_renamed")) categories.add("exercise_identification");
  if (kinds.has("set_added") || kinds.has("set_removed")) categories.add("set_counting");
  if (kinds.has("reps_changed")) categories.add("rep_extraction");
  if (kinds.has("weight_changed")) categories.add("weight_extraction");
  if (kinds.has("cue_added") || kinds.has("cue_removed") || kinds.has("cue_changed")) {
    categories.add("coaching_cues");
  }

  return {
    version: 1,
    source: "finalized_review_diff",
    workflowVersion,
    changeCount: diff.changes.length,
    changeCounts: diff.changeCounts,
    categories: [...new Set([...categories, ...analysis.affectedCategories])],
    likelyCause: analysis.likelyCause,
    causeConfidence: analysis.confidence,
    suggestedIntervention: analysis.suggestedIntervention,
    recommendation: interventionRecommendation(analysis.suggestedIntervention),
    acceptanceCriteria: [
      "The targeted correction category improves on reviewed evaluation cases.",
      "Exercise recall does not decrease.",
      "Unsupported exercises, sets, values, or cues do not increase.",
      "Schema validity, typecheck, lint, and API build continue to pass.",
      "The change remains safe to retry and does not alter finalized user corrections.",
    ],
  };
}

function interventionRecommendation(intervention: EvaluationIntervention): string {
  const recommendations: Record<EvaluationIntervention, string> = {
    prompt_rule:
      "Evaluate a narrowly scoped extraction-prompt rule against reviewed cases before changing production behavior.",
    boundary_logic:
      "Evaluate a targeted boundary reconciliation change without regenerating unrelated exercises.",
    canonicalization_rule:
      "Evaluate a deterministic canonicalization adjustment with conservative confidence and ambiguity gates.",
    transcription_quality:
      "Treat this as a transcription-quality investigation; do not compensate by inventing unsupported extraction data.",
    review_experience:
      "Evaluate whether a review interaction or explicit user reason can capture information that was not recoverable from the transcript.",
    evaluation_case_only:
      "Retain this review as evaluation evidence. Do not change production until the pattern repeats or stronger evidence is available.",
    no_change:
      "No production change is recommended from this review. Retain it for aggregate monitoring.",
  };
  return recommendations[intervention];
}

function parseJsonObject(text: string): Record<string, unknown> {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const object = text.match(/(\{[\s\S]+\})/);
  return JSON.parse(codeBlock?.[1] ?? object?.[1] ?? text) as Record<string, unknown>;
}

function validateAnalysis(value: Record<string, unknown>): EvaluationAnalysis {
  const likelyCause = value.likelyCause;
  const suggestedIntervention = value.suggestedIntervention;
  const confidence = Number(value.confidence);
  const affectedCategories = Array.isArray(value.affectedCategories)
    ? value.affectedCategories.filter((category): category is string => typeof category === "string")
    : [];
  if (
    value.version !== 1 ||
    typeof likelyCause !== "string" ||
    !EVALUATION_CAUSES.includes(likelyCause as EvaluationCause) ||
    typeof suggestedIntervention !== "string" ||
    !EVALUATION_INTERVENTIONS.includes(suggestedIntervention as EvaluationIntervention) ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw new Error("Evaluation model returned an invalid analysis");
  }
  const allowedCategories = new Set([
    "exercise_completeness",
    "exercise_identification",
    "set_counting",
    "rep_extraction",
    "weight_extraction",
    "coaching_cues",
  ]);
  if (affectedCategories.some((category) => !allowedCategories.has(category))) {
    throw new Error("Evaluation model returned an invalid category");
  }
  return {
    version: 1,
    likelyCause: likelyCause as EvaluationCause,
    confidence,
    affectedCategories: [...new Set(affectedCategories)],
    suggestedIntervention: suggestedIntervention as EvaluationIntervention,
  };
}

function formatTranscript(rows: Record<string, unknown>[]): string {
  const text = rows
    .map((row) => {
      const start = Number(row.start_seconds ?? 0);
      const minutes = Math.floor(start / 60);
      const seconds = Math.floor(start % 60);
      return `[${minutes}:${seconds.toString().padStart(2, "0")}] ${String(row.text ?? "")}`;
    })
    .join("\n");
  return text.length <= 60_000 ? text : `${text.slice(0, 60_000)}\n[TRANSCRIPT TRUNCATED]`;
}

async function analyzeEvaluationProposal(proposalId: string): Promise<EvaluationAnalysis> {
  const rows = await sql`
    SELECT
      ep.analysis,
      sr.session_id,
      sr.workflow_version,
      sr.generated_exercises,
      sr.reviewed_exercises,
      sr.review_diff
    FROM evaluation_proposals ep
    JOIN session_reviews sr ON sr.id = ep.review_id
    WHERE ep.id = ${proposalId}
    LIMIT 1
  `;
  if (rows.length === 0) throw new Error(`Evaluation proposal ${proposalId} not found`);
  if (rows[0].analysis) return validateAnalysis(rows[0].analysis as Record<string, unknown>);

  const transcriptRows = await sql`
    SELECT start_seconds, text
    FROM transcript_segments
    WHERE session_id = ${String(rows[0].session_id)}
    ORDER BY start_seconds ASC
  `;
  const text = await generateText({
    system: `You are a bounded quality evaluator for structured workout extraction.

Compare the private transcript, generated exercise record, user-reviewed exercise record, and deterministic review diff. Classify the most likely reason for the correction. Do not propose free-form text. Do not assume that every user edit proves a model error: corrected information may be absent from or ambiguous in the transcript. Distinguish transcription/source ambiguity from extraction errors, boundary reconciliation, canonicalization, planned/completed confusion, values, coaching cues, and user preference or unspoken information.

Return JSON only, matching the supplied enum schema.`,
    prompt: `WORKFLOW VERSION:
${String(rows[0].workflow_version)}

PRIVATE TRANSCRIPT:
${formatTranscript(transcriptRows)}

GENERATED EXERCISES:
${JSON.stringify(rows[0].generated_exercises)}

USER-REVIEWED EXERCISES:
${JSON.stringify(rows[0].reviewed_exercises)}

DETERMINISTIC REVIEW DIFF:
${JSON.stringify(rows[0].review_diff)}

Return a classification using only the allowed schema values.`,
    maxOutputTokens: 800,
    jsonSchema: EVALUATION_ANALYSIS_SCHEMA,
    schemaName: "review_evaluation",
    maxQueueWaitMs: 180_000,
  });
  const analysis = validateAnalysis(parseJsonObject(text));
  const diff = rows[0].review_diff as ReviewDiff;
  const proposal = buildSanitizedEvaluationProposal(
    diff,
    String(rows[0].workflow_version),
    analysis
  );
  await sql`
    UPDATE evaluation_proposals
    SET analysis = ${JSON.stringify(analysis)}::jsonb,
        proposal = ${JSON.stringify(proposal)}::jsonb,
        evaluated_at = now(),
        updated_at = now()
    WHERE id = ${proposalId} AND analysis IS NULL
  `;
  return analysis;
}

function proposalTitle(proposal: SanitizedEvaluationProposal): string {
  const label = proposal.categories.length > 0
    ? proposal.categories.join(", ").replaceAll("_", " ")
    : "review correction";
  return `[Evaluation] Investigate ${label}`.slice(0, 120);
}

function proposalBody(
  proposalId: string,
  proposal: SanitizedEvaluationProposal
): string {
  const counts = Object.entries(proposal.changeCounts)
    .map(([kind, count]) => `- ${kind}: ${count}`)
    .join("\n");
  const criteria = proposal.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n");

  return `<!-- motion-memo-evaluation-proposal:${proposalId} -->
## Sanitized evaluation proposal

This proposal was generated from a user-reviewed before/after diff. It intentionally excludes user identity, session identifiers, transcript text, exercise names, cue text, and corrected values.

**Workflow version:** ${proposal.workflowVersion}
**Correction count:** ${proposal.changeCount}
**Categories:** ${proposal.categories.join(", ") || "uncategorized"}
**Likely cause:** ${proposal.likelyCause}
**Cause confidence:** ${proposal.causeConfidence.toFixed(2)}
**Suggested intervention:** ${proposal.suggestedIntervention}

### Change counts

${counts || "- none"}

### Recommendation

${proposal.recommendation}

### Acceptance criteria

${criteria}

### Approval

Review the sanitized classification above and any separately authorized private evidence. If implementation is warranted, apply the \`approved-for-codex\` label. That label starts an isolated coding workflow which may create a draft pull request; it never deploys or merges directly.
`;
}

function parseRepository(value: string): { owner: string; repository: string } | null {
  const match = value.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  return match ? { owner: match[1], repository: match[2] } : null;
}

interface GitHubIssue {
  number: number;
  html_url: string;
  body?: string | null;
  pull_request?: unknown;
}

async function findExistingProposalIssue(
  token: string,
  target: { owner: string; repository: string },
  proposalId: string
): Promise<GitHubIssue | null> {
  const response = await fetch(
    `https://api.github.com/repos/${target.owner}/${target.repository}/issues?state=all&per_page=100&sort=created&direction=desc`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (!response.ok) {
    throw new Error(`GitHub issue lookup failed (${response.status})`);
  }
  const marker = `<!-- motion-memo-evaluation-proposal:${proposalId} -->`;
  const issues = (await response.json()) as GitHubIssue[];
  return issues.find((issue) => !issue.pull_request && issue.body?.includes(marker)) ?? null;
}

async function saveDeliveredIssue(proposalId: string, issue: GitHubIssue): Promise<void> {
  await sql`
    UPDATE evaluation_proposals
    SET delivery_status = 'delivered',
        delivery_error = NULL,
        github_issue_number = ${issue.number},
        github_issue_url = ${issue.html_url},
        delivered_at = COALESCE(delivered_at, now()),
        updated_at = now()
    WHERE id = ${proposalId}
  `;
}

export async function deliverEvaluationProposal(proposalId: string): Promise<{
  delivered: boolean;
  issueUrl?: string;
  reason?: string;
}> {
  const rows = await sql`
    SELECT id, proposal, github_issue_url
    FROM evaluation_proposals
    WHERE id = ${proposalId}
    LIMIT 1
  `;
  if (rows.length === 0) throw new Error(`Evaluation proposal ${proposalId} not found`);
  if (rows[0].github_issue_url) {
    return { delivered: true, issueUrl: String(rows[0].github_issue_url) };
  }

  const token = process.env.EVALUATION_GITHUB_TOKEN?.trim();
  const target = parseRepository(process.env.EVALUATION_GITHUB_REPOSITORY ?? "");
  if (!token || !target) {
    await sql`
      UPDATE evaluation_proposals
      SET delivery_status = 'awaiting_configuration',
          delivery_error = 'EVALUATION_GITHUB_TOKEN and EVALUATION_GITHUB_REPOSITORY are required',
          updated_at = now()
      WHERE id = ${proposalId}
    `;
    return { delivered: false, reason: "github_delivery_not_configured" };
  }

  const existingIssue = await findExistingProposalIssue(token, target, proposalId);
  if (existingIssue) {
    await saveDeliveredIssue(proposalId, existingIssue);
    return { delivered: true, issueUrl: existingIssue.html_url };
  }

  const proposal = rows[0].proposal as SanitizedEvaluationProposal;
  const response = await fetch(
    `https://api.github.com/repos/${target.owner}/${target.repository}/issues`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        title: proposalTitle(proposal),
        body: proposalBody(proposalId, proposal),
      }),
    }
  );

  if (!response.ok) {
    const error = (await response.text()).slice(0, 1_000);
    await sql`
      UPDATE evaluation_proposals
      SET delivery_status = 'failed', delivery_error = ${error}, updated_at = now()
      WHERE id = ${proposalId}
    `;
    throw new Error(`GitHub issue delivery failed (${response.status}): ${error}`);
  }

  const issue = (await response.json()) as GitHubIssue;
  await saveDeliveredIssue(proposalId, issue);
  return { delivered: true, issueUrl: issue.html_url };
}

export async function evaluateAndDeliverEvaluationProposal(proposalId: string): Promise<{
  delivered: boolean;
  issueUrl?: string;
  reason?: string;
}> {
  try {
    await analyzeEvaluationProposal(proposalId);
    return await deliverEvaluationProposal(proposalId);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
    await sql`
      UPDATE evaluation_proposals
      SET delivery_status = 'failed', delivery_error = ${message}, updated_at = now()
      WHERE id = ${proposalId} AND github_issue_url IS NULL
    `;
    throw error;
  }
}
