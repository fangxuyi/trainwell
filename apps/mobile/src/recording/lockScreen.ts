import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { formatDuration } from "../utils/time";

const CHANNEL_ID = "recording";
const NOTIFICATION_ID = "trainwell-recording";

export async function setupNotificationChannel() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Recording",
      importance: Notifications.AndroidImportance.LOW,
      showBadge: false,
      sound: null,
    });
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

export async function showRecordingNotification(elapsedSeconds: number) {
  // Dismiss any existing one first so iOS replaces it
  await Notifications.dismissNotificationAsync(NOTIFICATION_ID).catch(() => {});

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_ID,
    content: {
      title: "Workout in progress",
      body: `Motion Memo  ·  ${formatDuration(Math.round(elapsedSeconds))}`,
      sound: false,
      ...(Platform.OS === "android" && {
        channelId: CHANNEL_ID,
        ongoing: true,
        color: "#C7F36B",
      }),
    },
    trigger: null,
  });
}

export async function updateRecordingNotification(elapsedSeconds: number) {
  await showRecordingNotification(elapsedSeconds);
}

export async function dismissRecordingNotification() {
  await Notifications.dismissNotificationAsync(NOTIFICATION_ID).catch(() => {});
  await Notifications.dismissAllNotificationsAsync();
}
