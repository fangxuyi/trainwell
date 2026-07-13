import { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useSignUp, useSSO } from "@clerk/clerk-expo";
import { useRouter, Link } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";

WebBrowser.maybeCompleteAuthSession();

export default function SignUpScreen() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const { startSSOFlow } = useSSO();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSignUpPress = useCallback(async () => {
    if (!isLoaded || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signUp.create({ emailAddress: email.trim(), password });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setPendingVerification(true);
    } catch (err: any) {
      setError(err?.errors?.[0]?.message ?? "Sign up failed.");
    } finally {
      setBusy(false);
    }
  }, [isLoaded, busy, email, password]);

  const onVerifyPress = useCallback(async () => {
    if (!isLoaded || busy) return;
    setBusy(true);
    setError(null);
    try {
      const attempt = await signUp.attemptEmailAddressVerification({ code: code.trim() });
      if (attempt.status === "complete") {
        await setActive({ session: attempt.createdSessionId });
        router.replace("/");
      } else {
        setError("Verification incomplete. Check the code and try again.");
      }
    } catch (err: any) {
      setError(err?.errors?.[0]?.message ?? "Verification failed.");
    } finally {
      setBusy(false);
    }
  }, [isLoaded, busy, code]);

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

  if (pendingVerification) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.subtitle}>Enter the code we sent to {email}</Text>
        <TextInput
          style={styles.input}
          placeholder="Verification code"
          placeholderTextColor="#475569"
          keyboardType="number-pad"
          value={code}
          onChangeText={setCode}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity style={styles.primaryButton} onPress={onVerifyPress} disabled={busy}>
          {busy ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.primaryButtonText}>Verify</Text>}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create account</Text>
      <Text style={styles.subtitle}>Start recording your sessions</Text>

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

      <TouchableOpacity style={styles.primaryButton} onPress={onSignUpPress} disabled={busy}>
        {busy ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.primaryButtonText}>Sign Up</Text>}
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
        <Text style={styles.footerText}>Already have an account? </Text>
        <Link href="/sign-in" replace>
          <Text style={styles.link}>Sign in</Text>
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
