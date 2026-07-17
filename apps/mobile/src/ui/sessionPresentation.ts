import type { WorkoutSession } from "@trainwell/schemas";
import { colors } from "./theme";

export function sessionStatusPresentation(
  session: WorkoutSession
): { label: string; color: string } {
  if (session.localStatus === "interrupted") {
    return { label: "Recording interrupted", color: colors.warning };
  }
  if (session.localStatus === "local_error" || session.remoteStatus === "failed") {
    return { label: "Needs attention", color: colors.danger };
  }
  if (session.localStatus === "syncing" || session.remoteStatus === "processing") {
    return { label: "Processing", color: colors.warning };
  }
  if (session.localStatus === "cached" || session.syncStatus === "synchronized") {
    return { label: "Ready", color: colors.success };
  }
  return { label: "Saved locally", color: colors.blue };
}
