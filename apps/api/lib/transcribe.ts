import Groq from "groq-sdk";
import type { TranscriptSegment } from "@/lib/types";
import { randomUUID } from "crypto";

let groq: Groq;
function getGroq() {
  if (!groq) groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groq;
}

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

export async function transcribeAudioUrl(
  audioUrl: string,
  audioSegmentId: string,
  sequenceOffsetSeconds = 0
): Promise<TranscriptSegment[]> {
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`Failed to fetch audio: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const file = new File([buffer], "audio.m4a", { type: "audio/mp4" });

  const response = await getGroq().audio.transcriptions.create({
    model: "whisper-large-v3-turbo",
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
