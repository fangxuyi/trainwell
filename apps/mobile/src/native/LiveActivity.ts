import { NativeModules, Platform } from "react-native";

interface LiveActivityModuleType {
  startActivity(
    trainerName: string,
    workoutType: string
  ): Promise<string | null>;
  updateActivity(elapsedSeconds: number, isRecording: boolean): Promise<void>;
  endActivity(elapsedSeconds: number): Promise<void>;
}

const mod: LiveActivityModuleType | null =
  Platform.OS === "ios" ? NativeModules.LiveActivityModule ?? null : null;

export async function startLiveActivity(
  trainerName: string,
  workoutType: string
): Promise<void> {
  try {
    await mod?.startActivity(trainerName, workoutType);
  } catch {
    // Live Activities not supported (iOS < 16.2, simulator, or disabled)
  }
}

export async function updateLiveActivity(
  elapsedSeconds: number,
  isRecording: boolean
): Promise<void> {
  try {
    await mod?.updateActivity(elapsedSeconds, isRecording);
  } catch {
    // Silently ignore — notification fallback is still active
  }
}

export async function endLiveActivity(elapsedSeconds: number): Promise<void> {
  try {
    await mod?.endActivity(elapsedSeconds);
  } catch {
    // Ignore
  }
}
