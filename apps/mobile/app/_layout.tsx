import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { getDb } from "../src/db/client";
import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function RootLayout() {
  useEffect(() => {
    // Initialize database on first load
    getDb().catch(console.error);
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
        <Stack.Screen
          name="import"
          options={{ title: "Import Workout", presentation: "modal" }}
        />
      </Stack>
    </>
  );
}
