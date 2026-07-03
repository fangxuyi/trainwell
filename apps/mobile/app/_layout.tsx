import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState } from "react-native";
import { getDb } from "../src/db/client";
import * as Notifications from "expo-notifications";
import { retryStalledSessions } from "../src/sync/worker";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function RootLayout() {
  useEffect(() => {
    getDb().catch(console.error);

    // When the app comes to the foreground, retry any sessions that were
    // waiting for internet. The 5-second apiGet timeout means stalled
    // workers fail quickly, so this covers both "no internet at stop time"
    // and "app reopened after connectivity restored" cases.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        retryStalledSessions().catch(console.error);
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#0F172A" },
          headerTintColor: "#F8FAFC",
          headerTitleStyle: { fontWeight: "700" },
          contentStyle: { backgroundColor: "#0F172A" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Trainwell" }} />
        <Stack.Screen
          name="session/new"
          options={{ title: "New Workout", presentation: "modal" }}
        />
        <Stack.Screen
          name="session/active"
          options={{
            title: "Recording",
            headerBackVisible: false,
            gestureEnabled: false,
          }}
        />
        <Stack.Screen
          name="session/[id]"
          options={{ title: "Session" }}
        />
        <Stack.Screen name="history/index" options={{ title: "History" }} />
        <Stack.Screen name="review/[id]" options={{ title: "Review Session" }} />
        <Stack.Screen name="ask" options={{ title: "Ask AI" }} />
      </Stack>
    </>
  );
}
