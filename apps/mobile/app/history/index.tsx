import type { WorkoutSession } from "@trainwell/schemas";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { listSessions, upsertSessionsFromServer } from "../../src/db/sessions";
import { ScreenHeader } from "../../src/ui/ScreenHeader";
import { SessionListItem } from "../../src/ui/SessionListItem";
import { colors, radii } from "../../src/ui/theme";
import { apiGet } from "../../src/utils/api";

export default function HistoryScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const load = async () => {
        const localSessions = await listSessions(100);
        if (!active) return;
        setSessions(localSessions);
        setLoading(false);

        apiGet<Record<string, unknown>[]>("/api/workouts")
          .then((rows) => upsertSessionsFromServer(rows))
          .then(() => listSessions(100))
          .then((refreshed) => {
            if (active) setSessions(refreshed);
          })
          .catch(() => {});
      };

      load();
      return () => {
        active = false;
      };
    }, [])
  );

  const totalMinutes = Math.round(
    sessions.reduce((total, session) => total + (session.durationSeconds ?? 0), 0) / 60
  );
  const thisMonth = sessions.filter((session) => {
    const date = new Date(session.startedAt);
    const now = new Date();
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }).length;

  return (
    <SafeAreaView style={styles.safeArea}>
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
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <ScreenHeader
              eyebrow="YOUR TRAINING ARCHIVE"
              title="Every session, in one place."
              subtitle="Revisit the work, the coaching, and the progress behind each workout."
              onBack={() => router.back()}
            />

            <View style={styles.overviewCard}>
              <View style={styles.overviewOrb} />
              <View style={styles.overviewItem}>
                <Text style={styles.overviewValue}>{sessions.length}</Text>
                <Text style={styles.overviewLabel}>Sessions logged</Text>
              </View>
              <View style={styles.overviewDivider} />
              <View style={styles.overviewItem}>
                <Text style={styles.overviewValue}>{totalMinutes}</Text>
                <Text style={styles.overviewLabel}>Minutes captured</Text>
              </View>
              <View style={styles.overviewDivider} />
              <View style={styles.overviewItem}>
                <Text style={styles.overviewValue}>{thisMonth}</Text>
                <Text style={styles.overviewLabel}>This month</Text>
              </View>
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionEyebrow}>SESSION HISTORY</Text>
              <Text style={styles.sectionTitle}>Your workouts</Text>
            </View>
          </>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.accent} style={styles.loader} />
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyMark}>01</Text>
              <Text style={styles.emptyTitle}>Your archive is ready.</Text>
              <Text style={styles.emptyText}>
                Complete your first recorded workout and it will appear here automatically.
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 44 },
  overviewCard: {
    minHeight: 122,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.large,
    backgroundColor: colors.accent,
    paddingHorizontal: 18,
    overflow: "hidden",
    marginBottom: 31,
  },
  overviewOrb: {
    position: "absolute",
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 28,
    borderColor: "rgba(16, 23, 7, 0.07)",
    right: -48,
    top: -52,
  },
  overviewItem: { flex: 1, alignItems: "center" },
  overviewValue: { color: colors.accentText, fontSize: 28, fontWeight: "900", letterSpacing: -1 },
  overviewLabel: { color: "#506A28", fontSize: 9, lineHeight: 13, fontWeight: "800", textAlign: "center", marginTop: 3 },
  overviewDivider: { width: 1, height: 48, backgroundColor: "rgba(16, 23, 7, 0.17)" },
  sectionHeader: { marginBottom: 13 },
  sectionEyebrow: { color: colors.textFaint, fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  sectionTitle: { color: colors.text, fontSize: 23, fontWeight: "900", letterSpacing: -0.55, marginTop: 4 },
  loader: { marginTop: 30 },
  emptyCard: {
    borderRadius: radii.large,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 22,
  },
  emptyMark: { color: colors.accent, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "800", marginTop: 12 },
  emptyText: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 6 },
});
