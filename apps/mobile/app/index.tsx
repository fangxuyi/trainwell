import type { CreditBalance, WorkoutSession } from "@trainwell/schemas";
import { useUser } from "@clerk/clerk-expo";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  getIncompleteSession,
  listSessions,
  upsertSessionsFromServer,
} from "../src/db/sessions";
import { recorder } from "../src/recording/recorder";
import { AccountDrawer } from "../src/ui/AccountDrawer";
import { SessionListItem } from "../src/ui/SessionListItem";
import { colors, radii } from "../src/ui/theme";
import { apiGet } from "../src/utils/api";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useUser();
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [incompleteSession, setIncompleteSession] = useState<WorkoutSession | null>(null);
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const firstName = user?.firstName || user?.username || "there";

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const load = async () => {
        setLoading(true);
        const [localSessions, incomplete] = await Promise.all([
          listSessions(20),
          recorder.isActive() ? getIncompleteSession() : Promise.resolve(null),
        ]);
        if (!active) return;

        setSessions(
          localSessions.filter(
            (session) => session.localStatus !== "recording" && session.localStatus !== "paused"
          )
        );
        setIncompleteSession(incomplete);
        setLoading(false);

        apiGet<Record<string, unknown>[]>("/api/workouts")
          .then((rows) => upsertSessionsFromServer(rows))
          .then(() => listSessions(20))
          .then((refreshed) => {
            if (!active) return;
            setSessions(
              refreshed.filter(
                (session) =>
                  session.localStatus !== "recording" && session.localStatus !== "paused"
              )
            );
          })
          .catch(() => {});

        apiGet<CreditBalance>("/api/credits")
          .then((current) => {
            if (active) setBalance(current);
          })
          .catch(() => {});
      };

      load();
      return () => {
        active = false;
      };
    }, [])
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <AccountDrawer
        visible={drawerOpen}
        balance={balance}
        onClose={() => setDrawerOpen(false)}
      />

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SessionListItem
            session={item}
            onPress={() => router.push(`/session/${item.id}`)}
          />
        )}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <View style={styles.topBar}>
              <View>
                <Text style={styles.brand}>TRAINWELL</Text>
                <Text style={styles.greeting}>{greeting()}, {firstName}</Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Open account menu"
                style={styles.menuButton}
                onPress={() => setDrawerOpen(true)}
              >
                <View style={styles.menuLine} />
                <View style={[styles.menuLine, styles.menuLineShort]} />
                <View style={styles.menuLine} />
              </TouchableOpacity>
            </View>

            {incompleteSession ? (
              <TouchableOpacity style={styles.resumeCard} onPress={() => router.push("/session/active")}>
                <View style={styles.pulseOuter}><View style={styles.pulseInner} /></View>
                <View style={styles.resumeContent}>
                  <Text style={styles.resumeEyebrow}>SESSION IN PROGRESS</Text>
                  <Text style={styles.resumeTitle}>Keep your momentum</Text>
                </View>
                <Text style={styles.resumeArrow}>→</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity style={styles.heroCard} onPress={() => router.push("/session/new")}>
              <View style={styles.heroOrbLarge} />
              <View style={styles.heroOrbSmall} />
              <Text style={styles.heroEyebrow}>READY WHEN YOU ARE</Text>
              <Text style={styles.heroTitle}>Start a new{`\n`}workout</Text>
              <Text style={styles.heroBody}>
                Capture every set, cue, and breakthrough—hands free.
              </Text>
              <View style={styles.heroActionRow}>
                <Text style={styles.heroActionText}>Begin recording</Text>
                <View style={styles.heroActionButton}>
                  <Text style={styles.heroActionArrow}>↗</Text>
                </View>
              </View>
            </TouchableOpacity>

            <View style={styles.utilityRow}>
              <TouchableOpacity style={styles.aiCard} onPress={() => router.push("/ask")}>
                <Text style={styles.aiSpark}>✦</Text>
                <Text style={styles.utilityEyebrow}>TRAINING INTELLIGENCE</Text>
                <Text style={styles.utilityTitle}>Ask AI</Text>
                <Text style={styles.utilityBody}>Find patterns across your sessions.</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.balanceCard} onPress={() => router.push("/credits")}>
                <Text style={styles.balanceEyebrow}>CREDITS</Text>
                <Text style={styles.balanceValue}>{balance?.totalCredits ?? "—"}</Text>
                <Text style={styles.balanceUnit}>minutes available</Text>
                <View style={styles.balanceFooter}>
                  <Text style={styles.balancePlan}>
                    {balance?.subscriptionTier ? "Monthly plan" : "Pay as you go"}
                  </Text>
                  <Text style={styles.balanceArrow}>→</Text>
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionEyebrow}>YOUR PROGRESS</Text>
                <Text style={styles.sectionTitle}>Recent sessions</Text>
              </View>
              <TouchableOpacity onPress={() => router.push("/history")}>
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            </View>
          </>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.accent} style={styles.loader} />
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyNumber}>01</Text>
              <Text style={styles.emptyTitle}>Your first session starts here.</Text>
              <Text style={styles.emptyBody}>Record a workout and Trainwell will build your history automatically.</Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  listContent: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 44 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  brand: { color: colors.accent, fontSize: 11, fontWeight: "900", letterSpacing: 2.4 },
  greeting: { color: colors.textMuted, fontSize: 13, marginTop: 5 },
  menuButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  menuLine: { width: 18, height: 2, borderRadius: 1, backgroundColor: colors.text },
  menuLineShort: { width: 12, alignSelf: "center", marginLeft: 6 },
  resumeCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.violetDark,
    borderRadius: radii.medium,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(155, 138, 251, 0.24)",
  },
  pulseOuter: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(155, 138, 251, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  pulseInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.violet },
  resumeContent: { flex: 1 },
  resumeEyebrow: { color: colors.violet, fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  resumeTitle: { color: colors.text, fontSize: 15, fontWeight: "800", marginTop: 3 },
  resumeArrow: { color: colors.violet, fontSize: 20 },
  heroCard: {
    minHeight: 286,
    borderRadius: 30,
    backgroundColor: colors.accent,
    padding: 24,
    overflow: "hidden",
    marginBottom: 12,
  },
  heroOrbLarge: {
    position: "absolute",
    width: 210,
    height: 210,
    borderRadius: 105,
    right: -68,
    top: -62,
    borderWidth: 38,
    borderColor: "rgba(16, 23, 7, 0.07)",
  },
  heroOrbSmall: {
    position: "absolute",
    width: 78,
    height: 78,
    borderRadius: 39,
    right: 38,
    bottom: 46,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
  },
  heroEyebrow: { color: "#4E6726", fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  heroTitle: {
    color: colors.accentText,
    fontSize: 42,
    lineHeight: 43,
    fontWeight: "900",
    letterSpacing: -1.6,
    marginTop: 16,
  },
  heroBody: { color: "#3F5221", fontSize: 14, lineHeight: 20, width: "72%", marginTop: 14, fontWeight: "600" },
  heroActionRow: {
    marginTop: "auto",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroActionText: { color: colors.accentText, fontSize: 14, fontWeight: "900" },
  heroActionButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accentText,
    alignItems: "center",
    justifyContent: "center",
  },
  heroActionArrow: { color: colors.accent, fontSize: 22, fontWeight: "700" },
  utilityRow: { flexDirection: "row", gap: 12, marginBottom: 34 },
  aiCard: {
    flex: 1.18,
    minHeight: 174,
    borderRadius: radii.large,
    backgroundColor: colors.violetDark,
    borderWidth: 1,
    borderColor: "rgba(155, 138, 251, 0.2)",
    padding: 17,
  },
  aiSpark: { color: colors.violet, fontSize: 25, marginBottom: 18 },
  utilityEyebrow: { color: colors.violet, fontSize: 8, fontWeight: "900", letterSpacing: 1.15 },
  utilityTitle: { color: colors.text, fontSize: 24, fontWeight: "900", marginTop: 5, letterSpacing: -0.5 },
  utilityBody: { color: "#ACA4D7", fontSize: 11, lineHeight: 16, marginTop: 7 },
  balanceCard: {
    flex: 1,
    minHeight: 174,
    borderRadius: radii.large,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 17,
  },
  balanceEyebrow: { color: colors.textFaint, fontSize: 9, fontWeight: "900", letterSpacing: 1.3 },
  balanceValue: { color: colors.text, fontSize: 40, fontWeight: "900", letterSpacing: -1.5, marginTop: 12 },
  balanceUnit: { color: colors.textMuted, fontSize: 10, fontWeight: "600" },
  balanceFooter: { marginTop: "auto", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  balancePlan: { color: colors.accent, fontSize: 10, fontWeight: "800" },
  balanceArrow: { color: colors.accent, fontSize: 17 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 13,
  },
  sectionEyebrow: { color: colors.textFaint, fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  sectionTitle: { color: colors.text, fontSize: 24, fontWeight: "900", letterSpacing: -0.6, marginTop: 4 },
  seeAll: { color: colors.accent, fontSize: 12, fontWeight: "800", paddingBottom: 3 },
  loader: { marginTop: 28 },
  emptyCard: {
    minHeight: 150,
    borderRadius: radii.large,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    padding: 20,
    backgroundColor: "rgba(16, 21, 32, 0.6)",
  },
  emptyNumber: { color: colors.accent, fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "800", marginTop: 12 },
  emptyBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 6, maxWidth: 280 },
});
