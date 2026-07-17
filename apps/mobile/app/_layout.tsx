import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AppState, View, ActivityIndicator } from "react-native";
import * as Network from "expo-network";
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import { getDb } from "../src/db/client";
import * as Notifications from "expo-notifications";
import { prepareLocalRecovery, runSyncRecovery } from "../src/sync/recovery";
import { tokenCache } from "../src/auth/tokenCache";
import { setTokenGetter } from "../src/auth/token";
import { configureRevenueCat } from "../src/billing/revenueCat";
import { colors } from "../src/ui/theme";
import { claimLegacySessions } from "../src/db/sessions";
import { setCurrentUserId } from "../src/auth/currentUser";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const FOREGROUND_RECOVERY_INTERVAL_MS = 30_000;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const screenOptions = {
  headerStyle: { backgroundColor: colors.background },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: "800" as const },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.background },
};

function RootNavigator() {
  const { isLoaded, isSignedIn, getToken, userId } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [preparedUserId, setPreparedUserId] = useState<string | null>(null);
  const [localRecoveryReady, setLocalRecoveryReady] = useState(false);

  // Expose Clerk's token to the non-React api layer.
  useEffect(() => {
    setTokenGetter(isSignedIn ? getToken : null);
  }, [isSignedIn, getToken]);

  useEffect(() => {
    setCurrentUserId(userId ?? null);
    if (!userId) {
      setPreparedUserId(null);
      return;
    }
    claimLegacySessions(userId)
      .then(() => setPreparedUserId(userId))
      .catch((error) => {
        console.error("Failed to prepare local account data", error);
        setPreparedUserId(userId);
      });
  }, [userId]);

  useEffect(() => {
    if (isSignedIn && userId) configureRevenueCat(userId).catch(console.error);
  }, [isSignedIn, userId]);

  useEffect(() => {
    getDb()
      .then(prepareLocalRecovery)
      .catch(console.error)
      .finally(() => setLocalRecoveryReady(true));
  }, []);

  useEffect(() => {
    if (!isSignedIn || !userId || preparedUserId !== userId) return;

    const recoverIfOnline = async () => {
      if (AppState.currentState !== "active") return;
      const state = await Network.getNetworkStateAsync();
      if (state.isConnected === false || state.isInternetReachable === false) return;
      await runSyncRecovery();
    };

    recoverIfOnline().catch(console.error);

    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") recoverIfOnline().catch(console.error);
    });
    const networkSubscription = Network.addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        recoverIfOnline().catch(console.error);
      }
    });
    const recoveryInterval = setInterval(() => {
      recoverIfOnline().catch(console.error);
    }, FOREGROUND_RECOVERY_INTERVAL_MS);

    return () => {
      appStateSubscription.remove();
      networkSubscription.remove();
      clearInterval(recoveryInterval);
    };
  }, [isSignedIn, preparedUserId, userId]);

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

  if (!isLoaded || !localRecoveryReady || (isSignedIn && preparedUserId !== userId)) {
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
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="session/new"
        options={{ title: "New Workout", presentation: "modal" }}
      />
      <Stack.Screen
        name="session/active"
        options={{ title: "Recording", headerBackVisible: false, gestureEnabled: false }}
      />
      <Stack.Screen name="session/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="history/index" options={{ headerShown: false }} />
      <Stack.Screen name="review/[id]" options={{ title: "Review Session" }} />
      <Stack.Screen name="ask" options={{ headerShown: false }} />
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
