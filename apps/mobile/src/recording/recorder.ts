import {
  AudioModule,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  RecordingPresets,
} from "expo-audio";
import { File, Directory, Paths } from "expo-file-system";
import { createAudioSegment, finalizeAudioSegment } from "../db/audio";
import {
  setupNotificationChannel,
  requestNotificationPermission,
  showRecordingNotification,
  updateRecordingNotification,
  dismissRecordingNotification,
} from "./lockScreen";

// Lock-screen notification refresh cadence. Not chunking — the whole session is
// recorded as ONE continuous file so the audio session is activated once (in the
// foreground) and never re-activated. Re-activating from the background is what
// iOS rejects with CannotInterruptOthers, which is why we no longer rotate
// recorders mid-session.
const NOTIFICATION_REFRESH_MS = 15_000;

// Compressed AAC / .m4a, mono, 16 kHz, 24 kbps CBR. Groq accepts m4a natively.
// At ~3 KB/s a 90-min session is ~16 MB — under Groq's 25 MB per-file limit, so
// the whole recording transcribes in one call (no server-side splitting).
// CBR (not VBR) keeps the size predictable so the explicit Groq size check is
// meaningful. These options MUST be passed to prepareToRecordAsync(), not only
// the constructor: expo-audio only flattens the platform (`ios`) block inside
// its prepareToRecordAsync prototype shim, so passing them only to
// `new AudioRecorder(...)` leaves the native side recording an unpredictable
// default container — the bug that used to produce CAF instead of the requested
// format.
const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY, // .m4a / MPEG4AAC base
  directory: "document" as const,
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 24000,
  isMeteringEnabled: true,
};

class WorkoutRecorder {
  private recorder: InstanceType<typeof AudioModule.AudioRecorder> | null = null;
  private sessionId: string | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private startTime: number = 0;
  private elapsedAtPause: number = 0;
  private onChunkSaved?: (segmentId: string) => void;
  private onProgress?: (elapsedSeconds: number) => void;
  private onError?: (err: Error) => void;
  private segmentId: string | null = null;
  private savedSegmentCount = 0;
  private isPaused = false;

  async requestPermissions(): Promise<boolean> {
    const { granted } = await requestRecordingPermissionsAsync();
    await setupNotificationChannel();
    await requestNotificationPermission();
    return granted;
  }

  getCurrentDb(): number {
    if (!this.recorder || this.isPaused) return -160;
    try {
      return (this.recorder.getStatus() as any).metering ?? -160;
    } catch {
      return -160;
    }
  }

  async start(
    sessionId: string,
    callbacks: {
      onChunkSaved?: (segmentId: string) => void;
      onProgress?: (elapsedSeconds: number) => void;
      onError?: (err: Error) => void;
    } = {}
  ): Promise<void> {
    this.sessionId = sessionId;
    this.onChunkSaved = callbacks.onChunkSaved;
    this.onProgress = callbacks.onProgress;
    this.onError = callbacks.onError;
    this.elapsedAtPause = 0;
    this.startTime = 0;
    this.savedSegmentCount = 0;
    this.segmentId = null;
    this.isPaused = false;

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      interruptionMode: "mixWithOthers",
      shouldPlayInBackground: true,
      allowsBackgroundRecording: true,
    });

    const recorder = this.buildRecorder();
    // Pass options here (not only to the constructor) so the format is actually
    // applied — see RECORDING_OPTIONS above.
    await recorder.prepareToRecordAsync(RECORDING_OPTIONS as any);
    const recordingUri = recorder.uri;
    if (!recordingUri) {
      throw new Error("Recorder did not provide a persistent file URI.");
    }
    const segment = await createAudioSegment({
      sessionId,
      sequence: 0,
      localPath: recordingUri,
    });
    this.segmentId = segment.id;
    recorder.record();
    this.recorder = recorder;
    this.startTime = Date.now();

    await showRecordingNotification(0);
    this.startHeartbeat();
  }

  async pause(): Promise<void> {
    if (!this.recorder || this.isPaused) return;
    this.elapsedAtPause += (Date.now() - this.startTime) / 1000;
    this.isPaused = true;
    this.stopHeartbeat();
    this.recorder.pause();
    this.onProgress?.(this.elapsedAtPause);
  }

  async resume(): Promise<void> {
    if (!this.recorder || !this.isPaused) return;
    this.isPaused = false;
    this.startTime = Date.now();
    this.recorder.record();
    this.startHeartbeat();
  }

  async stop(): Promise<void> {
    this.stopHeartbeat();
    if (this.recorder) {
      const recorder = this.recorder;
      this.recorder = null;
      await recorder.stop();
      await this.persistRecording(recorder);
    }
    this.sessionId = null;
    this.segmentId = null;
    this.isPaused = false;
    await dismissRecordingNotification();
  }

  getElapsedSeconds(): number {
    if (!this.startTime || this.isPaused) return this.elapsedAtPause;
    return this.elapsedAtPause + (Date.now() - this.startTime) / 1000;
  }

  getChunkCount(): number {
    return this.savedSegmentCount;
  }

  isActive(): boolean {
    return this.recorder !== null || this.sessionId !== null;
  }

  private buildRecorder(): InstanceType<typeof AudioModule.AudioRecorder> {
    return new AudioModule.AudioRecorder(RECORDING_OPTIONS as any);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      const elapsedSeconds = this.getElapsedSeconds();
      updateRecordingNotification(elapsedSeconds).catch(() => {});
      this.onProgress?.(elapsedSeconds);
    }, NOTIFICATION_REFRESH_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  // Move the finished recording into the session's audio directory and register
  // it as the session's single audio segment (sequence 0). The server splits it
  // into transcription-sized windows after upload.
  private async persistRecording(
    recorder: InstanceType<typeof AudioModule.AudioRecorder>
  ): Promise<void> {
    if (!this.sessionId) return;

    const sessionId = this.sessionId;
    const uri = recorder.uri;
    if (!uri) return;

    const destDir = new Directory(Paths.document, "sessions", sessionId, "audio");
    if (!destDir.exists) destDir.create({ intermediates: true });

    const destFile = new File(destDir, "recording.m4a");
    const srcFile = new File(uri);
    if (destFile.exists) destFile.delete();
    srcFile.move(destFile);

    const sizeBytes = destFile.size ?? 0;
    let segmentId = this.segmentId;
    if (!segmentId) {
      const segment = await createAudioSegment({
        sessionId,
        sequence: 0,
        localPath: destFile.uri,
      });
      segmentId = segment.id;
    }

    await finalizeAudioSegment(segmentId, {
      localPath: destFile.uri,
      durationSeconds: this.getElapsedSeconds(),
      sizeBytes,
    });

    this.savedSegmentCount = 1;
    this.onChunkSaved?.(segmentId);
  }
}

export const recorder = new WorkoutRecorder();
