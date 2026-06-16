import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import type { WorkoutSession } from "@trainwell/schemas";
import { getSessionById, deleteSession } from "../../src/db/sessions";
import { getAudioSegmentsBySession } from "../../src/db/audio";
import { getNotesBySession } from "../../src/db/quickNotes";
import { formatDuration } from "../../src/utils/time";

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [audioCount, setAudioCount] = useState(0);
  const [noteCount, setNoteCount] = useState(0);

  useEffect(() => {
    const load = async () => {
      const [s, segs, notes] = await Promise.all([
        getSessionById(id),
        getAudioSegmentsBySession(id),
        getNotesBySession(id),
      ]);
      setSession(s);
      setAudioCount(segs.length);
      setNoteCount(notes.length);
      setLoading(false);
    };
    load();
  }, [id]);

  const handleDelete = () => {
    Alert.alert(
      "Delete Session",
      "This will permanently delete this session and all local audio. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteSession(id);
            router.replace("/");
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color="#38BDF8" />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorText}>Session not found.</Text>
      </View>
    );
  }

  const statusColor: Record<string, string> = {
    locally_complete: "#F59E0B",
    awaiting_upload: "#F59E0B",
    syncing: "#38BDF8",
    cached: "#38BDF8",
    review_required: "#A78BFA",
    finalized: "#34D399",
    recording: "#EF4444",
    paused: "#F59E0B",
    draft: "#64748B",
    local_error: "#EF4444",
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      {/* Header */}
      <View style={styles.card}>
        <Text style={styles.workoutType}>
          {session.workoutType ?? "Workout"}
        </Text>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: (statusColor[session.localStatus] ?? "#64748B") + "22" },
          ]}
        >
          <Text
            style={[
              styles.statusBadgeText,
              { color: statusColor[session.localStatus] ?? "#64748B" },
            ]}
          >
            {session.localStatus.replace(/_/g, " ")}
          </Text>
        </View>

        <Text style={styles.date}>
          {new Date(session.startedAt).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </Text>

        {session.durationSeconds ? (
          <Text style={styles.duration}>
            Duration: {formatDuration(session.durationSeconds)}
          </Text>
        ) : null}

        {session.trainerName && (
          <Text style={styles.detail}>Trainer: {session.trainerName}</Text>
        )}
        {session.goals.length > 0 && (
          <Text style={styles.detail}>Goal: {session.goals.join(", ")}</Text>
        )}
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{audioCount}</Text>
          <Text style={styles.statLabel}>Audio Chunks</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{noteCount}</Text>
          <Text style={styles.statLabel}>Quick Notes</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>
            {session.exercises?.length ?? 0}
          </Text>
          <Text style={styles.statLabel}>Exercises</Text>
        </View>
      </View>

      {/* Processing status */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sync Status</Text>
        <Text style={styles.detail}>
          Processing: {session.remoteStatus.replace(/_/g, " ")}
        </Text>
        <Text style={styles.detail}>
          Sync: {session.syncStatus.replace(/_/g, " ")}
        </Text>
        <Text style={styles.detail}>
          Mode: {session.processingMode.replace(/_/g, " ")}
        </Text>
      </View>

      {/* Exercises if available */}
      {session.exercises && session.exercises.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Exercises</Text>
          {session.exercises.map((ex, i) => (
            <View key={ex.id} style={styles.exerciseRow}>
              <Text style={styles.exerciseName}>
                {i + 1}. {ex.canonicalName}
              </Text>
              {ex.sets.length > 0 && (
                <Text style={styles.exerciseDetail}>
                  {ex.sets.length} set{ex.sets.length !== 1 ? "s" : ""}
                  {ex.sets[0]?.weight
                    ? ` × ${ex.sets[0].weight.value}${ex.sets[0].weight.unit}`
                    : ""}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Session notes */}
      {session.sessionNotes && session.sessionNotes.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Session Notes</Text>
          {session.sessionNotes.map((note, i) => (
            <Text key={i} style={styles.noteText}>
              • {note}
            </Text>
          ))}
        </View>
      )}

      {/* Next session plan */}
      {session.nextSessionPlan && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Next Session Plan</Text>
          {session.nextSessionPlan.exercises.map((ex, i) => (
            <Text key={i} style={styles.noteText}>
              • {ex.exerciseName}
              {ex.targetSets ? ` — ${ex.targetSets} sets` : ""}
              {ex.targetWeight ? ` @ ${ex.targetWeight}` : ""}
            </Text>
          ))}
          {session.nextSessionPlan.generalNotes.map((n, i) => (
            <Text key={`gn-${i}`} style={styles.noteText}>
              {n}
            </Text>
          ))}
        </View>
      )}

      {/* Actions */}
      {session.remoteStatus === "review_required" && (
        <TouchableOpacity
          style={styles.reviewButton}
          onPress={() => router.push(`/review/${id}`)}
        >
          <Text style={styles.reviewButtonText}>Review & Finalize</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
        <Text style={styles.deleteButtonText}>Delete Session</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  center: { alignItems: "center", justifyContent: "center" },
  errorText: { color: "#F87171", fontSize: 16 },
  card: {
    backgroundColor: "#1E293B",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  workoutType: {
    color: "#F1F5F9",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  statusBadge: {
    alignSelf: "flex-start",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 12,
  },
  statusBadgeText: { fontSize: 13, fontWeight: "600", textTransform: "capitalize" },
  date: { color: "#94A3B8", fontSize: 15, marginBottom: 4 },
  duration: { color: "#64748B", fontSize: 14, marginBottom: 4 },
  detail: { color: "#64748B", fontSize: 14, marginBottom: 2 },
  statsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  stat: {
    flex: 1,
    backgroundColor: "#1E293B",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
  },
  statValue: { color: "#38BDF8", fontSize: 22, fontWeight: "700" },
  statLabel: { color: "#64748B", fontSize: 12, marginTop: 2 },
  exerciseRow: { marginBottom: 8 },
  exerciseName: { color: "#F1F5F9", fontSize: 15, fontWeight: "500" },
  exerciseDetail: { color: "#64748B", fontSize: 13, marginTop: 2 },
  noteText: { color: "#CBD5E1", fontSize: 14, marginBottom: 4 },
  reviewButton: {
    backgroundColor: "#7C3AED",
    borderRadius: 14,
    padding: 18,
    alignItems: "center",
    marginBottom: 12,
  },
  reviewButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  deleteButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#7F1D1D",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginTop: 8,
  },
  deleteButtonText: { color: "#F87171", fontSize: 15 },
});
