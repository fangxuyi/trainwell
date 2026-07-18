import { useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth, useClerk } from "@clerk/clerk-expo";
import { useRouter } from "expo-router";
import { notifyBetaAccessGranted } from "../src/auth/betaAccess";
import { colors, radii } from "../src/ui/theme";
import { ApiError, apiPost } from "../src/utils/api";

export default function InviteScreen() {
  const { userId } = useAuth();
  const { signOut } = useClerk();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function redeem() {
    if (!userId || !code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost<{ allowed: boolean }>("/api/beta-access/redeem", { code });
      await notifyBetaAccessGranted(userId);
      router.replace("/");
    } catch (redeemError) {
      const apiMessage = redeemError instanceof ApiError && redeemError.body && typeof redeemError.body === "object"
        ? (redeemError.body as { error?: string }).error
        : undefined;
      setError(
        apiMessage ?? (redeemError instanceof Error
          ? redeemError.message
          : "Invitation could not be redeemed"
        )
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.spark}>✦</Text>
          <Text style={styles.eyebrow}>PRIVATE BETA</Text>
          <Text style={styles.title}>You’re invited to train.</Text>
          <Text style={styles.subtitle}>
            Trainwell is currently available to invited beta testers. Enter your code to unlock the app.
          </Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={(value) => setCode(value.toUpperCase())}
            placeholder="TW-XXXXXXXXXXXX"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={redeem}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[styles.button, (!code.trim() || busy) && styles.buttonDisabled]}
            onPress={redeem}
            disabled={!code.trim() || busy}
          >
            {busy
              ? <ActivityIndicator color={colors.accentText} />
              : <Text style={styles.buttonText}>Unlock Trainwell</Text>}
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={async () => {
            await signOut();
            router.replace("/sign-in");
          }}
        >
          <Text style={styles.switchAccount}>Use a different account</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, justifyContent: "center", padding: 20 },
  card: {
    borderRadius: 30,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 24,
  },
  spark: { color: colors.violet, fontSize: 30 },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: "900", letterSpacing: 1.7, marginTop: 24 },
  title: { color: colors.text, fontSize: 31, lineHeight: 35, fontWeight: "900", letterSpacing: -1, marginTop: 9 },
  subtitle: { color: colors.textMuted, fontSize: 13, lineHeight: 20, marginTop: 12 },
  input: {
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 15,
    marginTop: 26,
  },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18, marginTop: 10 },
  button: { borderRadius: radii.medium, backgroundColor: colors.accent, alignItems: "center", padding: 16, marginTop: 14 },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: colors.accentText, fontSize: 15, fontWeight: "900" },
  switchAccount: { color: colors.textMuted, fontSize: 12, fontWeight: "700", textAlign: "center", marginTop: 22 },
});
