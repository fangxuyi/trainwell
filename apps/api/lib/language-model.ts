import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { randomUUID } from "crypto";
import sql from "./db";
import { ensureProcessingQueueSchema } from "./processing-queue";

type LanguageModelProvider = "anthropic" | "gemini" | "openai";

interface GenerateTextOptions {
  system: string;
  prompt: string;
  maxOutputTokens: number;
  jsonSchema?: Record<string, unknown>;
  schemaName?: string;
  maxQueueWaitMs?: number;
}

export class LanguageModelRateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs: number
  ) {
    super(message);
    this.name = "LanguageModelRateLimitError";
  }
}

export class LanguageModelQueueTimeoutError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super("The language model queue is busy. Please retry shortly.");
    this.name = "LanguageModelQueueTimeoutError";
  }
}

let anthropic: Anthropic | null = null;
let gemini: GoogleGenAI | null = null;
let openai: OpenAI | null = null;

function getProvider(): LanguageModelProvider {
  const configured = (process.env.AI_PROVIDER ?? "anthropic").toLowerCase();
  if (configured === "anthropic" || configured === "claude") return "anthropic";
  if (configured === "gemini" || configured === "google") return "gemini";
  if (configured === "openai") return "openai";
  throw new Error(
    `Unsupported AI_PROVIDER "${configured}". Use "anthropic", "gemini", or "openai".`
  );
}

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.status === "number") return record.status;
  if (typeof record.statusCode === "number") return record.statusCode;
  if (typeof record.code === "number") return record.code;
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRateLimitError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    errorStatus(error) === 429 ||
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("resource_exhausted") ||
    message.includes("too many requests")
  );
}

function retryAfterFromError(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const headers = (error as Record<string, unknown>).headers;
  let value: string | null | undefined;
  if (headers instanceof Headers) value = headers.get("retry-after");
  else if (headers && typeof headers === "object") {
    const raw = (headers as Record<string, unknown>)["retry-after"];
    if (typeof raw === "string") value = raw;
  }
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1_000, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(1_000, date - Date.now()) : undefined;
}

async function acquireProviderLease(
  provider: LanguageModelProvider,
  maxQueueWaitMs: number
): Promise<string> {
  await ensureProcessingQueueSchema();
  const leaseOwner = randomUUID();
  const deadline = Date.now() + maxQueueWaitMs;

  while (Date.now() < deadline) {
    const rows = await sql`
      INSERT INTO language_model_provider_state (
        provider, lease_owner, lease_expires_at, updated_at
      ) VALUES (
        ${provider}, ${leaseOwner}, now() + interval '5 minutes', now()
      )
      ON CONFLICT (provider) DO UPDATE SET
        lease_owner = EXCLUDED.lease_owner,
        lease_expires_at = EXCLUDED.lease_expires_at,
        updated_at = now()
      WHERE (
          language_model_provider_state.lease_owner IS NULL
          OR language_model_provider_state.lease_expires_at <= now()
        )
        AND (
          language_model_provider_state.blocked_until IS NULL
          OR language_model_provider_state.blocked_until <= now()
        )
      RETURNING provider
    `;
    if (rows.length > 0) return leaseOwner;

    const states = await sql`
      SELECT blocked_until, lease_expires_at
      FROM language_model_provider_state
      WHERE provider = ${provider}
    `;
    const blockedUntil = states[0]?.blocked_until
      ? new Date(String(states[0].blocked_until)).getTime()
      : 0;
    const remaining = deadline - Date.now();
    const waitFor = blockedUntil > Date.now()
      ? Math.min(blockedUntil - Date.now(), 5_000, remaining)
      : Math.min(750, remaining);
    if (waitFor > 0) await sleep(waitFor);
  }

  const states = await sql`
    SELECT blocked_until, lease_expires_at
    FROM language_model_provider_state
    WHERE provider = ${provider}
  `;
  const nextAvailable = [states[0]?.blocked_until, states[0]?.lease_expires_at]
    .filter(Boolean)
    .map((value) => new Date(String(value)).getTime())
    .filter((value) => value > Date.now())
    .sort((left, right) => left - right)[0];
  throw new LanguageModelQueueTimeoutError(
    nextAvailable ? Math.max(1_000, nextAvailable - Date.now()) : 5_000
  );
}

async function releaseProviderLease(
  provider: LanguageModelProvider,
  leaseOwner: string
): Promise<void> {
  await sql`
    UPDATE language_model_provider_state
    SET lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE provider = ${provider} AND lease_owner = ${leaseOwner}
  `;
}

async function blockProvider(
  provider: LanguageModelProvider,
  leaseOwner: string,
  retryAfterMs: number,
  error: unknown
): Promise<void> {
  const retrySeconds = Math.max(1, Math.ceil(retryAfterMs / 1_000));
  await sql`
    UPDATE language_model_provider_state
    SET blocked_until = now() + (${retrySeconds} * interval '1 second'),
        last_rate_limit_error = ${errorMessage(error).slice(0, 1_000)},
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = now()
    WHERE provider = ${provider} AND lease_owner = ${leaseOwner}
  `;
}

export async function getLanguageModelQueueDelay(): Promise<{
  provider: LanguageModelProvider;
  blockedUntil: string | null;
}> {
  const provider = getProvider();
  await ensureProcessingQueueSchema();
  const rows = await sql`
    SELECT blocked_until
    FROM language_model_provider_state
    WHERE provider = ${provider}
  `;
  return {
    provider,
    blockedUntil: rows[0]?.blocked_until
      ? new Date(String(rows[0].blocked_until)).toISOString()
      : null,
  };
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

function getGemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required when AI_PROVIDER=gemini");
  }
  if (!gemini) gemini = new GoogleGenAI({ apiKey });
  return gemini;
}

export async function generateText({
  system,
  prompt,
  maxOutputTokens,
  jsonSchema,
  schemaName = "structured_response",
  maxQueueWaitMs = 45_000,
}: GenerateTextOptions): Promise<string> {
  const provider = getProvider();
  const maxRateLimitRetries = 4;
  const queueDeadline = Date.now() + maxQueueWaitMs;

  for (let attempt = 0; attempt <= maxRateLimitRetries; attempt++) {
    const remainingQueueWait = queueDeadline - Date.now();
    if (remainingQueueWait <= 0) {
      throw new LanguageModelQueueTimeoutError(5_000);
    }
    const leaseOwner = await acquireProviderLease(provider, remainingQueueWait);
    try {
      if (provider === "openai") {
        const response = await getOpenAI().responses.create({
          model: process.env.OPENAI_MODEL ?? "gpt-5.6-terra",
          instructions: system,
          input: prompt,
          max_output_tokens: maxOutputTokens,
        });
        if (!response.output_text) throw new Error("OpenAI returned no text output");
        await releaseProviderLease(provider, leaseOwner);
        return response.output_text;
      }

      if (provider === "gemini") {
        const response = await getGemini().models.generateContent({
          model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
          contents: prompt,
          config: {
            systemInstruction: system,
            maxOutputTokens,
            ...(jsonSchema
              ? {
                  responseMimeType: "application/json",
                  responseJsonSchema: jsonSchema,
                }
              : {}),
          },
        });
        const text = response.text?.trim();
        if (!text) {
          const blockReason = response.promptFeedback?.blockReason;
          throw new Error(
            blockReason
              ? `Gemini returned no text output (block reason: ${blockReason})`
              : "Gemini returned no text output"
          );
        }
        await releaseProviderLease(provider, leaseOwner);
        return text;
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
      await releaseProviderLease(provider, leaseOwner);
      return text;
    } catch (error) {
      if (!isRateLimitError(error)) {
        await releaseProviderLease(provider, leaseOwner);
        throw error;
      }

      const retryAfterMs = retryAfterFromError(error) ?? Math.min(60_000, 2_000 * 2 ** attempt);
      await blockProvider(provider, leaseOwner, retryAfterMs, error);
      if (
        attempt === maxRateLimitRetries ||
        Date.now() + retryAfterMs >= queueDeadline
      ) {
        throw new LanguageModelRateLimitError(
          `${provider} rate limited the request after ${attempt + 1} attempts`,
          retryAfterMs
        );
      }
      await sleep(retryAfterMs);
    }
  }

  throw new Error(`Unable to generate ${schemaName}`);
}
