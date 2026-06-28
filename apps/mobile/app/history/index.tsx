import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useEffect, useState, useCallback } from "react";
import type { WorkoutSession } from "@trainwell/schemas";
import { listSessions } from "../../src/db/sessions";
import { formatDuration } from "../../src/utils/time";

export default function HistoryScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    listSessions(100)
      .then(setSessions)
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  // Refresh when returning from import modal
  useFocusEffect(load);

  const renderSession = ({ item }: { item: WorkoutSession }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => router.push(`/session/${item.id}`)}
    >
      <View style={styles.rowLeft}>
        <Text style={styles.rowDate}>
          {new Date(item.startedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </Text>
        <Text style={styles.rowType}>{item.workoutType ?? "Workout"}</Text>
        {item.trainerName ? (
          <Text style={styles.rowTrainer}>with {item.trainerName}</Text>
        ) : null}
      </View>
      <View style={styles.rowRight}>
        {item.durationSeconds ? (
          <Text style={styles.rowDuration}>
            {formatDuration(item.durationSeconds)}
          </Text>
        ) : null}
        <Text style={styles.rowChevron}>›</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.importRow}
        onPress={() => router.push("/import")}
      >
        <Text style={styles.importText}>+ Import from Markdown</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator color="#38BDF8" style={{ marginTop: 40 }} />
      ) : sessions.length === 0 ? (
        <Text style={styles.empty}>No sessions yet.</Text>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderSession}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  row: {
    flexDirection: "row",
    backgroundColor: "#1E293B",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    alignItems: "center",
  },
  rowLeft: { flex: 1 },
  rowDate: { color: "#94A3B8", fontSize: 13 },
  rowType: { color: "#F1F5F9", fontSize: 16, fontWeight: "600", marginTop: 2 },
  rowTrainer: { color: "#64748B", fontSize: 13, marginTop: 2 },
  rowRight: { alignItems: "flex-end", gap: 4 },
  rowDuration: { color: "#64748B", fontSize: 14 },
  rowChevron: { color: "#475569", fontSize: 20 },
  empty: { color: "#475569", textAlign: "center", marginTop: 48, fontSize: 15 },
  importRow: {
    margin: 16,
    marginBottom: 4,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1E3A6E",
    borderStyle: "dashed",
    alignItems: "center",
  },
  importText: { color: "#38BDF8", fontSize: 14, fontWeight: "600" },
});
