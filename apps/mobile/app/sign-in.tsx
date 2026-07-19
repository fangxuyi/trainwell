import { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useSignIn, useSSO } from "@clerk/clerk-expo";
import { useRouter, Link } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";

// Required for the OAuth redirect to close the in-app browser.
WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const { startSSOFlow } = useSSO();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSignInPress = useCallback(async () => {
    if (!isLoaded || busy) return;
    setBusy(true);
    setError(null);
    try {
      const attempt = await signIn.create({ identifier: email.trim(), password });
      if (attempt.status === "complete") {
        await setActive({ session: attempt.createdSessionId });
        router.replace("/");
      } else {
        setError("Additional verification required.");
      }
    } catch (err: any) {
      setError(err?.errors?.[0]?.message ?? "Sign in failed.");
    } finally {
      setBusy(false);
    }
  }, [isLoaded, busy, email, password]);

  const onGooglePress = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { createdSessionId, setActive: setActiveSSO } = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl: Linking.createURL("/"),
      });
      if (createdSessionId && setActiveSSO) {
        await setActiveSSO({ session: createdSessionId });
        router.replace("/");
      }
    } catch (err: any) {
      setError(err?.errors?.[0]?.message ?? "Google sign in failed.");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Motion Memo</Text>
      <Text style={styles.subtitle}>Sign in to your account</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#475569"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#475569"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity style={styles.primaryButton} onPress={onSignInPress} disabled={busy}>
        {busy ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.primaryButtonText}>Sign In</Text>}
      </TouchableOpacity>

      <View style={styles.dividerRow}>
        <View style={styles.divider} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.divider} />
      </View>

      <TouchableOpacity style={styles.googleButton} onPress={onGooglePress} disabled={busy}>
        <Text style={styles.googleButtonText}>Continue with Google</Text>
      </TouchableOpacity>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Don't have an account? </Text>
        <Link href="/sign-up" replace>
          <Text style={styles.link}>Sign up</Text>
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A", padding: 24, justifyContent: "center" },
  title: { color: "#F8FAFC", fontSize: 34, fontWeight: "800", textAlign: "center" },
  subtitle: { color: "#94A3B8", fontSize: 16, textAlign: "center", marginTop: 6, marginBottom: 32 },
  input: {
    backgroundColor: "#1E293B",
    borderRadius: 12,
    color: "#F1F5F9",
    padding: 16,
    fontSize: 16,
    marginBottom: 12,
  },
  error: { color: "#F87171", fontSize: 14, marginBottom: 12, textAlign: "center" },
  primaryButton: {
    backgroundColor: "#38BDF8",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 4,
  },
  primaryButtonText: { color: "#0F172A", fontSize: 16, fontWeight: "700" },
  dividerRow: { flexDirection: "row", alignItems: "center", marginVertical: 20 },
  divider: { flex: 1, height: 1, backgroundColor: "#1E293B" },
  dividerText: { color: "#64748B", marginHorizontal: 12, fontSize: 13 },
  googleButton: {
    backgroundColor: "#1E293B",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  googleButtonText: { color: "#F1F5F9", fontSize: 16, fontWeight: "600" },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 28 },
  footerText: { color: "#94A3B8", fontSize: 15 },
  link: { color: "#38BDF8", fontSize: 15, fontWeight: "600" },
});
