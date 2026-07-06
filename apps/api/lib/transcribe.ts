import { get } from "@vercel/blob";
import type { TranscriptSegment } from "@/lib/types";
import { randomUUID } from "crypto";

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
  const result = await get(audioUrl, { access: "private" });
  if (!result?.stream) throw new Error(`Blob not found or empty: ${audioUrl}`);
  const buffer = await new Response(result.stream).arrayBuffer();
  return transcribeBuffer(buffer, audioSegmentId, sequenceOffsetSeconds);
}

// Reads a 4-char string from a DataView
function readStr(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1),
    view.getUint8(offset + 2), view.getUint8(offset + 3)
  );
}

// Writes a 4-char string into a Uint8Array
function writeStr(buf: Uint8Array, offset: number, s: string) {
  for (let i = 0; i < 4; i++) buf[offset + i] = s.charCodeAt(i);
}

// Converts a CAF/LPCM buffer to WAV. Returns null if CAF contains non-LPCM audio.
function cafToWav(caf: ArrayBuffer): ArrayBuffer | null {
  const view = new DataView(caf);
  if (readStr(view, 0) !== "caff") return null;

  let offset = 8; // skip "caff" + 2-byte version + 2-byte flags
  let sampleRate = 0;
  let formatId = "";
  let channels = 0;
  let bitsPerSample = 0;
  let pcmData: ArrayBuffer | null = null;

  while (offset + 12 <= caf.byteLength) {
    const type = readStr(view, offset);
    const sizeHi = view.getUint32(offset + 4);
    const sizeLo = view.getUint32(offset + 8);
    // -1 (0xFFFFFFFFFFFFFFFF) means "rest of file"
    const size =
      sizeHi === 0xffffffff && sizeLo === 0xffffffff
        ? caf.byteLength - offset - 12
        : sizeHi * 4294967296 + sizeLo;
    const dataStart = offset + 12;

    if (type === "desc" && size >= 32) {
      sampleRate = view.getFloat64(dataStart, false); // big-endian float64
      formatId = readStr(view, dataStart + 8);
      channels = view.getUint32(dataStart + 24);
      bitsPerSample = view.getUint32(dataStart + 28);
    } else if (type === "data") {
      // first 4 bytes of data chunk = edit count, skip them
      pcmData = caf.slice(dataStart + 4, dataStart + size);
    }

    if (size === 0) break;
    offset = dataStart + size;
  }

  console.log(
    `[caf] format="${formatId}" rate=${sampleRate} ch=${channels} bits=${bitsPerSample} dataBytes=${pcmData?.byteLength ?? 0}`
  );

  if (formatId.trim() !== "lpcm" || !pcmData) return null;

  // Build WAV header (44 bytes) + PCM data
  const dataSize = pcmData.byteLength;
  const out = new Uint8Array(44 + dataSize);
  const w = new DataView(out.buffer);

  const sr = Math.round(sampleRate);
  const byteRate = sr * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  writeStr(out, 0, "RIFF");
  w.setUint32(4, 36 + dataSize, true);
  writeStr(out, 8, "WAVE");
  writeStr(out, 12, "fmt ");
  w.setUint32(16, 16, true);       // fmt chunk size
  w.setUint16(20, 1, true);        // PCM = 1
  w.setUint16(22, channels, true);
  w.setUint32(24, sr, true);
  w.setUint32(28, byteRate, true);
  w.setUint16(32, blockAlign, true);
  w.setUint16(34, bitsPerSample, true);
  writeStr(out, 36, "data");
  w.setUint32(40, dataSize, true);
  out.set(new Uint8Array(pcmData), 44);

  return out.buffer;
}

// Groq's audio transcription endpoint rejects files above this size (25 MB on
// the free tier; 100 MB on the dev tier). We check it explicitly and up front so
// an oversized session fails with a clear, actionable message instead of an
// opaque Groq error. Override via GROQ_MAX_AUDIO_BYTES if on a higher tier.
const GROQ_MAX_AUDIO_BYTES = Number(process.env.GROQ_MAX_AUDIO_BYTES) || 25 * 1024 * 1024;

// Detects the container from the leading bytes and returns the filename +
// content type Groq should see (it infers the codec from these).
function audioDescriptor(raw: ArrayBuffer): { name: string; type: string } {
  const view = new DataView(raw);
  const magic = readStr(view, 0);
  // MP4/M4A files start with a 4-byte box size followed by "ftyp".
  if (raw.byteLength >= 8 && readStr(view, 4) === "ftyp") {
    return { name: "audio.m4a", type: "audio/mp4" };
  }
  if (magic === "RIFF") return { name: "audio.wav", type: "audio/wav" };
  return { name: "audio.wav", type: "audio/wav" };
}

async function transcribeBuffer(
  raw: ArrayBuffer,
  audioSegmentId: string,
  sequenceOffsetSeconds = 0
): Promise<TranscriptSegment[]> {
  const magic = readStr(new DataView(raw), 0);
  console.log(`[transcribe] chunk=${audioSegmentId} magic="${magic}" size=${raw.byteLength}`);

  let audioBuffer = raw;
  let descriptor = audioDescriptor(raw);

  if (magic === "caff") {
    const wav = cafToWav(raw);
    if (!wav) {
      throw new Error(
        "CAF file contains non-LPCM audio — cannot convert. Check [caf] log line for format."
      );
    }
    audioBuffer = wav;
    descriptor = { name: "audio.wav", type: "audio/wav" };
    console.log(`[transcribe] CAF→WAV conversion: ${raw.byteLength}B → ${wav.byteLength}B`);
  }

  if (audioBuffer.byteLength > GROQ_MAX_AUDIO_BYTES) {
    const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
    throw new Error(
      `Audio segment ${audioSegmentId} is ${mb(audioBuffer.byteLength)} MB, ` +
        `over Groq's ${mb(GROQ_MAX_AUDIO_BYTES)} MB per-file limit. ` +
        `The session is too long to transcribe in one request — split it into ` +
        `smaller pieces or lower the recording bitrate.`
    );
  }

  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: descriptor.type }), descriptor.name);
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { segments?: WhisperSegment[] };
  const segments = data.segments ?? [];

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
