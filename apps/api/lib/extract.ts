import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionOutput } from "@/lib/types";

let anthropic: Anthropic;
function getAnthropic() {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

const EXTRACTION_VERSION = "1.0";

const SYSTEM_PROMPT = `You are a workout data extraction assistant. Your job is to analyze a workout session transcript and extract structured exercise data.

Rules:
- Extract only information explicitly stated or strongly implied in the transcript
- Distinguish between COMPLETED exercises and PLANNED/FUTURE exercises
- "Next time try X" or "try X next session" means a next-session recommendation, NOT a completed set
- If a value is uncertain, use a low confidence score (0.0-0.5) and status "weakly_inferred"
- If a value is explicitly stated, use confidence 0.9+ and status "explicit"
- Never invent data that isn't in the transcript
- Body weight exercises have no weight value
- Record pain/discomfort observations without diagnosis

Return ONLY valid JSON matching the ExtractionOutput schema.`;

const OUTPUT_SCHEMA = `{
  "sessionId": "string",
  "extractionVersion": "string",
  "exercises": [
    {
      "id": "string (uuid)",
      "canonicalName": "string",
      "spokenNames": ["string"],
      "category": "string | null",
      "bodyRegions": ["string"],
      "equipment": ["string"],
      "sequenceNumber": 0,
      "planned": false,
      "completed": true,
      "sets": [
        {
          "setNumber": 1,
          "setType": "working",
          "plannedReps": null,
          "completedReps": 10,
          "weight": { "value": 25, "unit": "lb", "confidence": 0.97, "status": "explicit", "sourceSegmentIds": [] },
          "duration": null,
          "restAfterSeconds": 60,
          "rpe": null,
          "completed": true,
          "formQuality": null,
          "userNotes": [],
          "trainerNotes": [],
          "confidence": 0.9,
          "sourceSegmentIds": []
        }
      ],
      "techniqueNotes": [],
      "userNotes": [],
      "trainerNotes": [],
      "painObservations": [],
      "progressionSuggestion": null,
      "confidence": 0.9
    }
  ],
  "sessionNotes": ["string"],
  "techniqueThemes": ["string"],
  "accomplishments": ["string"],
  "improvementAreas": ["string"],
  "painObservations": [
    { "bodyPart": "string", "description": "string", "severity": "mild", "sourceSegmentIds": [] }
  ],
  "nextSessionPlan": {
    "exercises": [
      { "exerciseName": "string", "targetSets": 3, "targetReps": "8-10", "targetWeight": "30 lb", "notes": [], "sourceSegmentIds": [] }
    ],
    "generalNotes": ["string"],
    "sourceSegmentIds": []
  },
  "overallDifficulty": { "value": 7, "unit": "/10", "confidence": 0.8, "status": "strongly_inferred", "sourceSegmentIds": [] },
  "energyLevel": null,
  "openQuestions": ["string"]
}`;

export async function extractWorkoutData(
  sessionId: string,
  transcript: string
): Promise<ExtractionOutput> {
  const message = await getAnthropic().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Extract workout data from this session transcript. Session ID: ${sessionId}

TRANSCRIPT:
${transcript}

Return JSON matching this schema:
${OUTPUT_SCHEMA}`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = content.text.match(/```(?:json)?\s*([\s\S]+?)\s*```/) ??
    content.text.match(/(\{[\s\S]+\})/);

  if (!jsonMatch) throw new Error("No JSON found in extraction response");

  const parsed = JSON.parse(jsonMatch[1]) as ExtractionOutput;
  parsed.extractionVersion = EXTRACTION_VERSION;
  parsed.sessionId = sessionId;

  return parsed;
}

export async function answerWorkoutQuestion(
  question: string,
  context: string
): Promise<{ answer: string; citations: Array<{ sessionId: string; date: string; excerpt: string }> }> {
  const message = await getAnthropic().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `You are a personal training assistant. Answer questions about the user's workout history concisely and accurately. Only state facts that are present in the provided context. Cite the specific session when referencing workout data.`,
    messages: [
      {
        role: "user",
        content: `WORKOUT HISTORY CONTEXT:
${context}

QUESTION: ${question}

Answer the question based on the context above. Keep it concise and cite specific sessions.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  return {
    answer: content.text,
    citations: [],
  };
}
