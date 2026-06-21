import {
  AudioModule,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  RecordingPresets,
} from "expo-audio";
import { File, Directory, Paths } from "expo-file-system";
import { createAudioSegment, finalizeAudioSegment, getNextSequenceNumber } from "../db/audio";

const CHUNK_DURATION_MS = 60_000; // 60-second chunks

class WorkoutRecorder {
  private recorder: InstanceType<typeof AudioModule.AudioRecorder> | null = null;
  private sessionId: string | null = null;
  private chunkTimer: ReturnType<typeof setTimeout> | null = null;
  private startTime: number = 0;
  private elapsedAtPause: number = 0;
  private onChunkSaved?: (segmentId: string) => void;
  private onError?: (err: Error) => void;
  private chunkCount = 0;
  private isPaused = false;

  async requestPermissions(): Promise<boolean> {
    const { granted } = await requestRecordingPermissionsAsync();
    return granted;
  }

  async start(
    sessionId: string,
    callbacks: {
      onChunkSaved?: (segmentId: string) => void;
      onError?: (err: Error) => void;
    } = {}
  ): Promise<void> {
    this.sessionId = sessionId;
    this.onChunkSaved = callbacks.onChunkSaved;
    this.onError = callbacks.onError;
    this.elapsedAtPause = 0;
    this.chunkCount = 0;
    this.isPaused = false;

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
    });

    await this.startChunk();
    this.scheduleNextChunk();
  }

  async pause(): Promise<void> {
    if (!this.recorder || this.isPaused) return;
    this.elapsedAtPause += (Date.now() - this.startTime) / 1000;
    this.isPaused = true;
    clearTimeout(this.chunkTimer!);
    this.chunkTimer = null;
    this.recorder.pause();
  }

  async resume(): Promise<void> {
    if (!this.recorder || !this.isPaused) return;
    this.isPaused = false;
    this.startTime = Date.now();
    this.recorder.record();
    this.scheduleNextChunk();
  }

  async stop(): Promise<void> {
    clearTimeout(this.chunkTimer!);
    this.chunkTimer = null;
    if (this.recorder) {
      await this.finalizeCurrentChunk();
      this.recorder = null;
    }
    this.sessionId = null;
    this.isPaused = false;
  }

  getElapsedSeconds(): number {
    if (!this.startTime || this.isPaused) return this.elapsedAtPause;
    return this.elapsedAtPause + (Date.now() - this.startTime) / 1000;
  }

  getChunkCount(): number {
    return this.chunkCount;
  }

  isActive(): boolean {
    return this.recorder !== null || this.sessionId !== null;
  }

  private async startChunk(): Promise<void> {
    if (!this.sessionId) return;

    const recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
    await recorder.prepareToRecordAsync();
    recorder.record();
    this.recorder = recorder;
    this.startTime = Date.now();
    this.chunkCount++;
  }

  private scheduleNextChunk(): void {
    this.chunkTimer = setTimeout(async () => {
      try {
        await this.finalizeCurrentChunk();
        await this.startChunk();
        this.scheduleNextChunk();
      } catch (err) {
        this.onError?.(err as Error);
      }
    }, CHUNK_DURATION_MS);
  }

  private async finalizeCurrentChunk(): Promise<void> {
    if (!this.recorder || !this.sessionId) return;

    const sessionId = this.sessionId;
    const recorder = this.recorder;
    this.recorder = null;

    await recorder.stop();

    const uri = recorder.uri;
    if (!uri) return;

    const sequence = await getNextSequenceNumber(sessionId);

    const destDir = new Directory(
      Paths.document,
      "sessions",
      sessionId,
      "audio"
    );
    destDir.create({ intermediates: true });

    const chunkName = `chunk_${String(sequence).padStart(4, "0")}.m4a`;
    const srcFile = new File(uri);
    const destFile = new File(destDir, chunkName);
    srcFile.move(destFile);

    const sizeBytes = destFile.size ?? 0;

    const segment = await createAudioSegment({
      sessionId,
      sequence,
      localPath: destFile.uri,
    });

    await finalizeAudioSegment(segment.id, {
      durationSeconds: CHUNK_DURATION_MS / 1000,
      sizeBytes,
    });

    this.onChunkSaved?.(segment.id);
  }
}

export const recorder = new WorkoutRecorder();
