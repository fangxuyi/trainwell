import OpenAI from "openai";
import type { TranscriptSegment } from "../../../packages/schemas/src/index";
import { randomUUID } from "crypto";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface WhisperSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export async function transcribeAudioUrl(
  audioUrl: string,
  audioSegmentId: string,
  sequenceOffsetSeconds = 0
): Promise<TranscriptSegment[]> {
  // Download the audio from Vercel Blob
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`Failed to fetch audio: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const file = new File([buffer], "audio.m4a", { type: "audio/mp4" });

  const response = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const segments: WhisperSegment[] =
    (response as unknown as { segments?: WhisperSegment[] }).segments ?? [];

  return segments.map((seg) => ({
    id: randomUUID(),
    audioSegmentId,
    startSeconds: seg.start + sequenceOffsetSeconds,
    endSeconds: seg.end + sequenceOffsetSeconds,
    speaker: "unknown" as const,
    text: seg.text.trim(),
    confidence: undefined,
    reviewed: false,
  }));
}
