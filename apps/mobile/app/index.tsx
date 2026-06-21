import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import type { WorkoutSession } from "@trainwell/schemas";
import { listSessions, getIncompleteSession, updateSessionStatus } from "../src/db/sessions";
import { recorder } from "../src/recording/recorder";
import { formatDuration } from "../src/utils/time";

export default function HomeScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [incompleteSession, setIncompleteSession] =
    useState<WorkoutSession | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      const load = async () => {
        setLoading(true);
        // If recorder is not actively running, any session stuck in
        // recording/paused was interrupted — mark it complete so it
        // shows up in history instead of the resume banner.
        if (!recorder.isActive()) {
          const stale = await getIncompleteSession();
          if (stale) {
            await updateSessionStatus(stale.id, { localStatus: "locally_complete" });
          }
        }
        const [all, incomplete] = await Promise.all([
          listSessions(20),
          recorder.isActive() ? getIncompleteSession() : Promise.resolve(null),
        ]);
        setSessions(all.filter((s) => s.localStatus !== "recording" && s.localStatus !== "paused"));
        setIncompleteSession(incomplete);
        setLoading(false);
      };
      load();
    }, [])
  );

  const renderSession = ({ item }: { item: WorkoutSession }) => (
    <TouchableOpacity
      style={styles.sessionCard}
      onPress={() => router.push(`/session/${item.id}`)}
    >
      <View style={styles.sessionHeader}>
        <Text style={styles.sessionType}>
          {item.workoutType ?? "Workout"}
        </Text>
        <Text style={styles.sessionStatus}>{item.localStatus}</Text>
      </View>
      <Text style={styles.sessionDate}>
        {new Date(item.startedAt).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })}
      </Text>
      {item.durationSeconds ? (
        <Text style={styles.sessionDuration}>
          {formatDuration(item.durationSeconds)}
        </Text>
      ) : null}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {incompleteSession && (
        <TouchableOpacity
          style={styles.resumeBanner}
          onPress={() => router.push("/session/active")}
        >
          <Text style={styles.resumeText}>
            Resume active session →
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.startButton}
        onPress={() => router.push("/session/new")}
      >
        <Text style={styles.startButtonText}>Start New Workout</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Recent Sessions</Text>

      {loading ? (
        <ActivityIndicator color="#38BDF8" style={{ marginTop: 32 }} />
      ) : sessions.length === 0 ? (
        <Text style={styles.empty}>No sessions yet. Start your first workout!</Text>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderSession}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F172A",
    padding: 16,
  },
  resumeBanner: {
    backgroundColor: "#1E3A5F",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#38BDF8",
  },
  resumeText: {
    color: "#38BDF8",
    fontSize: 16,
    fontWeight: "600",
  },
  startButton: {
    backgroundColor: "#2563EB",
    borderRadius: 14,
    padding: 18,
    alignItems: "center",
    marginBottom: 28,
  },
  startButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  sectionTitle: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  sessionCard: {
    backgroundColor: "#1E293B",
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  sessionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  sessionType: {
    color: "#F1F5F9",
    fontSize: 16,
    fontWeight: "600",
  },
  sessionStatus: {
    color: "#64748B",
    fontSize: 12,
    textTransform: "capitalize",
  },
  sessionDate: {
    color: "#94A3B8",
    fontSize: 14,
    marginBottom: 2,
  },
  sessionDuration: {
    color: "#64748B",
    fontSize: 13,
  },
  empty: {
    color: "#475569",
    textAlign: "center",
    marginTop: 48,
    fontSize: 15,
    lineHeight: 22,
  },
});
