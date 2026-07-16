import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState, View, ActivityIndicator } from "react-native";
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import { getDb } from "../src/db/client";
import * as Notifications from "expo-notifications";
import { retryStalledSessions, reconcileUnsyncedSessions } from "../src/sync/worker";
import { tokenCache } from "../src/auth/tokenCache";
import { setTokenGetter } from "../src/auth/token";
import { configureRevenueCat } from "../src/billing/revenueCat";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const screenOptions = {
  headerStyle: { backgroundColor: "#0F172A" },
  headerTintColor: "#F8FAFC",
  headerTitleStyle: { fontWeight: "700" as const },
  contentStyle: { backgroundColor: "#0F172A" },
};

function RootNavigator() {
  const { isLoaded, isSignedIn, getToken, userId } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Expose Clerk's token to the non-React api layer.
  useEffect(() => {
    setTokenGetter(isSignedIn ? getToken : null);
  }, [isSignedIn, getToken]);

  useEffect(() => {
    if (isSignedIn && userId) configureRevenueCat(userId).catch(console.error);
  }, [isSignedIn, userId]);

  useEffect(() => {
    getDb().catch(console.error);

    // When the app comes to the foreground, resume any interrupted sync and
    // reconcile sessions the server finished while the app was backgrounded.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        retryStalledSessions().catch(console.error);
        reconcileUnsyncedSessions().catch(console.error);
      }
    });
    return () => sub.remove();
  }, []);

  // Route users to/from the auth screens based on sign-in state.
  useEffect(() => {
    if (!isLoaded) return;
    const inAuth = segments[0] === "sign-in" || segments[0] === "sign-up";
    if (!isSignedIn && !inAuth) {
      router.replace("/sign-in");
    } else if (isSignedIn && inAuth) {
      router.replace("/");
    }
  }, [isLoaded, isSignedIn, segments]);

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0F172A", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="sign-up" options={{ headerShown: false }} />
      <Stack.Screen name="index" options={{ title: "Trainwell" }} />
      <Stack.Screen
        name="session/new"
        options={{ title: "New Workout", presentation: "modal" }}
      />
      <Stack.Screen
        name="session/active"
        options={{ title: "Recording", headerBackVisible: false, gestureEnabled: false }}
      />
      <Stack.Screen name="session/[id]" options={{ title: "Session" }} />
      <Stack.Screen name="history/index" options={{ title: "History" }} />
      <Stack.Screen name="review/[id]" options={{ title: "Review Session" }} />
      <Stack.Screen name="ask" options={{ title: "Ask AI" }} />
      <Stack.Screen name="credits" options={{ title: "Credits" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <StatusBar style="light" />
      <RootNavigator />
    </ClerkProvider>
  );
}
