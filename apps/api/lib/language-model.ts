import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

type LanguageModelProvider = "anthropic" | "openai";

interface GenerateTextOptions {
  system: string;
  prompt: string;
  maxOutputTokens: number;
}

let anthropic: Anthropic | null = null;
let openai: OpenAI | null = null;

function getProvider(): LanguageModelProvider {
  const configured = (process.env.AI_PROVIDER ?? "anthropic").toLowerCase();
  if (configured === "anthropic" || configured === "claude") return "anthropic";
  if (configured === "openai") return "openai";
  throw new Error(
    `Unsupported AI_PROVIDER "${configured}". Use "anthropic" or "openai".`
  );
}

function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic");
  }
  if (!anthropic) anthropic = new Anthropic({ apiKey });
  return anthropic;
}

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required when AI_PROVIDER=openai");
  }
  if (!openai) openai = new OpenAI({ apiKey });
  return openai;
}

export async function generateText({
  system,
  prompt,
  maxOutputTokens,
}: GenerateTextOptions): Promise<string> {
  if (getProvider() === "openai") {
    const response = await getOpenAI().responses.create({
      model: process.env.OPENAI_MODEL ?? "gpt-5.6-terra",
      instructions: system,
      input: prompt,
      max_output_tokens: maxOutputTokens,
    });
    if (!response.output_text) throw new Error("OpenAI returned no text output");
    return response.output_text;
  }

  const message = await getAnthropic().messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
    max_tokens: maxOutputTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  const text = message.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n");
  if (!text) throw new Error("Anthropic returned no text output");
  return text;
}
