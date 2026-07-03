import { NativeModules, Platform } from "react-native";

interface LiveActivityModuleType {
  startActivity(
    trainerName: string,
    workoutType: string
  ): Promise<string | null>;
  updateActivity(elapsedSeconds: number): Promise<void>;
  endActivity(): Promise<void>;
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

export async function updateLiveActivity(elapsedSeconds: number): Promise<void> {
  try {
    await mod?.updateActivity(elapsedSeconds);
  } catch {
    // Silently ignore — notification fallback is still active
  }
}

export async function endLiveActivity(): Promise<void> {
  try {
    await mod?.endActivity();
  } catch {
    // Ignore
  }
}
