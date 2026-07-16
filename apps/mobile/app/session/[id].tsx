import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import type { WorkoutSession } from "@trainwell/schemas";
import { getSessionById, deleteSession, listSessions } from "../../src/db/sessions";
import { apiDelete } from "../../src/utils/api";
import { runSyncWorker } from "../../src/sync/worker";
import { getAudioSegmentsBySession } from "../../src/db/audio";
import { getNotesBySession } from "../../src/db/quickNotes";
import { formatDuration } from "../../src/utils/time";

const SYNCING_STATUSES = new Set(["syncing", "locally_complete"]);

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [audioCount, setAudioCount] = useState(0);
  const [noteCount, setNoteCount] = useState(0);
  const [prevId, setPrevId] = useState<string | null>(null);
  const [nextId, setNextId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAll = useCallback(async () => {
    const [s, segs, notes, all] = await Promise.all([
      getSessionById(id),
      getAudioSegmentsBySession(id),
      getNotesBySession(id),
      listSessions(200),
    ]);
    setSession(s);
    setAudioCount(segs.length);
    setNoteCount(notes.length);
    setLoading(false);

    const idx = all.findIndex((x) => x.id === id);
    // listSessions returns newest-first; "previous" = older = higher index
    setPrevId(idx < all.length - 1 ? all[idx + 1].id : null);
    setNextId(idx > 0 ? all[idx - 1].id : null);

    return s;
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      loadAll().then((s) => {
        if (s && SYNCING_STATUSES.has(s.localStatus)) {
          pollRef.current = setInterval(async () => {
            const refreshed = await getSessionById(id);
            if (!refreshed) return;
            setSession(refreshed);
            if (!SYNCING_STATUSES.has(refreshed.localStatus)) {
              clearInterval(pollRef.current!);
              pollRef.current = null;
            }
          }, 3000);
        }
      });

      return () => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      };
    }, [id, loadAll])
  );

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
            await Promise.all([
              deleteSession(id),
              apiDelete(`/api/workouts/${id}`),
            ]);
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

  const isSyncing = SYNCING_STATUSES.has(session.localStatus);

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
      {/* Session navigation */}
      <View style={styles.navRow}>
        <TouchableOpacity
          style={[styles.navButton, !prevId && styles.navButtonDisabled]}
          disabled={!prevId}
          onPress={() => prevId && router.replace(`/session/${prevId}`)}
        >
          <Text style={[styles.navButtonText, !prevId && styles.navButtonTextDisabled]}>
            ‹ Older
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navButton}
          onPress={() => router.push("/history")}
        >
          <Text style={styles.navButtonText}>All Sessions</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navButton, !nextId && styles.navButtonDisabled]}
          disabled={!nextId}
          onPress={() => nextId && router.replace(`/session/${nextId}`)}
        >
          <Text style={[styles.navButtonText, !nextId && styles.navButtonTextDisabled]}>
            Newer ›
          </Text>
        </TouchableOpacity>
      </View>
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

      {/* Syncing indicator */}
      {isSyncing && (
        <View style={styles.syncingCard}>
          <ActivityIndicator color="#38BDF8" size="small" style={{ marginRight: 10 }} />
          <Text style={styles.syncingText}>
            {session.localStatus === "syncing"
              ? "Uploading and processing your session..."
              : "Preparing to sync..."}
          </Text>
        </View>
      )}

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

      {/* Compact workout summary */}
      {session.markdownContent && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Summary</Text>
          <Text style={styles.summaryText}>{session.markdownContent}</Text>
        </View>
      )}

      {/* Exercises */}
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

      {/* Review & finalize */}
      {session.remoteStatus === "review_required" && (
        <TouchableOpacity
          style={styles.reviewButton}
          onPress={() => router.push(`/review/${id}`)}
        >
          <Text style={styles.reviewButtonText}>Review & Finalize</Text>
        </TouchableOpacity>
      )}

      {/* Error state with retry */}
      {session.localStatus === "local_error" && (
        <View style={styles.errorCard}>
          <Text style={styles.errorCardText}>
            Sync failed. The session is saved locally.
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              runSyncWorker(id).catch(console.error);
              loadAll();
            }}
          >
            <Text style={styles.retryButtonText}>Retry Sync</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => router.push("/credits")}
          >
            <Text style={styles.retryButtonText}>Get Credits</Text>
          </TouchableOpacity>
        </View>
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
  syncingCard: {
    backgroundColor: "#0F2744",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#1E4080",
  },
  syncingText: { color: "#38BDF8", fontSize: 14, flex: 1 },
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
  summaryText: {
    color: "#CBD5E1",
    fontSize: 14,
    lineHeight: 22,
    fontFamily: "monospace",
  },
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
  errorCard: {
    backgroundColor: "#2D1515",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#7F1D1D",
    gap: 10,
  },
  errorCardText: { color: "#F87171", fontSize: 14 },
  retryButton: {
    backgroundColor: "#7F1D1D",
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
  },
  retryButtonText: { color: "#FCA5A5", fontSize: 14, fontWeight: "600" },
  navRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 8,
  },
  navButton: {
    flex: 1,
    backgroundColor: "#1E293B",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  navButtonDisabled: { opacity: 0.3 },
  navButtonText: { color: "#38BDF8", fontSize: 13, fontWeight: "600" },
  navButtonTextDisabled: { color: "#64748B" },
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
