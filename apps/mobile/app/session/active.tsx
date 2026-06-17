import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useState, useEffect } from "react";
import type { ProcessingMode, AudioRetentionPolicy } from "@trainwell/schemas";
import { useActiveSession } from "../../src/hooks/useActiveSession";
import { formatDuration } from "../../src/utils/time";

export default function ActiveSessionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    workoutType?: string;
    trainerName?: string;
    goal?: string;
    processingMode?: ProcessingMode;
    audioRetentionPolicy?: AudioRetentionPolicy;
  }>();

  const {
    state,
    session,
    notes,
    elapsedSeconds,
    chunkCount,
    error,
    start,
    pause,
    resume,
    stop,
    addNote,
  } = useActiveSession();

  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [hasStarted, setHasStarted] = useState(false);

  // Auto-start on mount with params
  useEffect(() => {
    if (!hasStarted && state === "idle") {
      setHasStarted(true);
      start({
        workoutType: params.workoutType,
        trainerName: params.trainerName,
        goals: params.goal ? [params.goal] : [],
        processingMode: params.processingMode ?? "automatic_hybrid",
        audioRetentionPolicy:
          params.audioRetentionPolicy ?? "delete_after_review",
      }).catch((err) =>
        Alert.alert("Recording Error", (err as Error).message)
      );
    }
  }, []);

  const handlePauseResume = async () => {
    if (state === "recording") {
      await pause();
    } else if (state === "paused") {
      await resume();
    }
  };

  const handleStop = () => {
    Alert.alert(
      "End Workout",
      "Are you sure you want to end this session? Recording will stop and be saved locally.",
      [
        { text: "Keep Recording", style: "cancel" },
        {
          text: "End Workout",
          style: "destructive",
          onPress: async () => {
            const finished = await stop();
            if (finished) {
              router.replace(`/session/${finished.id}`);
            } else {
              router.replace("/");
            }
          },
        },
      ]
    );
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    await addNote(noteText.trim());
    setNoteText("");
    setNoteModalVisible(false);
  };

  if (state === "creating" || (state === "idle" && !hasStarted)) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#38BDF8" />
        <Text style={styles.loadingText}>Starting session...</Text>
      </View>
    );
  }

  if (error || state === "error") {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorText}>{error ?? "An error occurred"}</Text>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => router.replace("/")}
        >
          <Text style={styles.secondaryButtonText}>Go Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isRecording = state === "recording";
  const isPaused = state === "paused";

  return (
    <View style={styles.container}>
      {/* Recording indicator */}
      <View style={styles.statusBar}>
        <View
          style={[styles.dot, isRecording ? styles.dotRecording : styles.dotPaused]}
        />
        <Text style={styles.statusText}>
          {isRecording ? "Recording" : isPaused ? "Paused" : "Processing..."}
        </Text>
        <Text style={styles.chunkCount}>{chunkCount} chunk{chunkCount !== 1 ? "s" : ""} saved</Text>
      </View>

      {/* Timer */}
      <View style={styles.timerContainer}>
        <Text style={styles.timer}>{formatDuration(Math.round(elapsedSeconds))}</Text>
        {session?.workoutType && (
          <Text style={styles.workoutType}>{session.workoutType}</Text>
        )}
        {session?.trainerName && (
          <Text style={styles.trainerName}>with {session.trainerName}</Text>
        )}
      </View>

      {/* Notes list */}
      {notes.length > 0 && (
        <View style={styles.notesContainer}>
          <Text style={styles.notesHeader}>Quick Notes</Text>
          <ScrollView style={{ maxHeight: 160 }}>
            {notes.map((n) => (
              <Text key={n.id} style={styles.noteItem}>
                • {n.text}
              </Text>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={styles.noteButton}
          onPress={() => setNoteModalVisible(true)}
        >
          <Text style={styles.noteButtonText}>+ Note</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.pauseButton, isPaused && styles.pauseButtonPaused]}
          onPress={handlePauseResume}
          disabled={state === "stopping"}
        >
          <Text style={styles.pauseButtonText}>
            {isRecording ? "⏸ Pause" : "▶ Resume"}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.stopButton}
        onPress={handleStop}
        disabled={state === "stopping"}
      >
        <Text style={styles.stopButtonText}>
          {state === "stopping" ? "Saving..." : "End Workout"}
        </Text>
      </TouchableOpacity>

      {/* Note modal */}
      <Modal
        visible={noteModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setNoteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Quick Note</Text>
            <TextInput
              style={styles.noteInput}
              placeholder="e.g. Left knee felt tight"
              placeholderTextColor="#475569"
              value={noteText}
              onChangeText={setNoteText}
              autoFocus
              multiline
              returnKeyType="done"
              onSubmitEditing={handleAddNote}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setNoteText("");
                  setNoteModalVisible(false);
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSave}
                onPress={handleAddNote}
              >
                <Text style={styles.modalSaveText}>Save Note</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A", padding: 20 },
  center: { alignItems: "center", justifyContent: "center" },
  loadingText: { color: "#94A3B8", marginTop: 16, fontSize: 16 },
  errorText: {
    color: "#F87171",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 24,
  },
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotRecording: { backgroundColor: "#EF4444" },
  dotPaused: { backgroundColor: "#F59E0B" },
  statusText: { color: "#94A3B8", fontSize: 14, flex: 1 },
  chunkCount: { color: "#475569", fontSize: 12 },
  timerContainer: { alignItems: "center", marginVertical: 40 },
  timer: {
    color: "#F8FAFC",
    fontSize: 64,
    fontWeight: "200",
    letterSpacing: -2,
    fontVariant: ["tabular-nums"],
  },
  workoutType: {
    color: "#38BDF8",
    fontSize: 18,
    fontWeight: "600",
    marginTop: 8,
  },
  trainerName: { color: "#64748B", fontSize: 15, marginTop: 4 },
  notesContainer: {
    backgroundColor: "#1E293B",
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  notesHeader: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  noteItem: { color: "#CBD5E1", fontSize: 14, marginBottom: 4 },
  controls: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  noteButton: {
    flex: 1,
    backgroundColor: "#1E293B",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  noteButtonText: { color: "#38BDF8", fontSize: 16, fontWeight: "600" },
  pauseButton: {
    flex: 1,
    backgroundColor: "#1E293B",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  pauseButtonPaused: { backgroundColor: "#1C3D2A" },
  pauseButtonText: { color: "#F1F5F9", fontSize: 16, fontWeight: "600" },
  stopButton: {
    backgroundColor: "#7F1D1D",
    borderRadius: 14,
    padding: 18,
    alignItems: "center",
  },
  stopButtonText: { color: "#FCA5A5", fontSize: 18, fontWeight: "700" },
  secondaryButton: {
    backgroundColor: "#1E293B",
    borderRadius: 12,
    padding: 14,
    paddingHorizontal: 28,
    marginTop: 12,
  },
  secondaryButtonText: { color: "#94A3B8", fontSize: 16 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#1E293B",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: {
    color: "#F1F5F9",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 16,
  },
  noteInput: {
    backgroundColor: "#0F172A",
    borderRadius: 10,
    color: "#F1F5F9",
    padding: 14,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: "top",
    marginBottom: 16,
  },
  modalButtons: { flexDirection: "row", gap: 12 },
  modalCancel: {
    flex: 1,
    backgroundColor: "#0F172A",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
  },
  modalCancelText: { color: "#64748B", fontSize: 16 },
  modalSave: {
    flex: 1,
    backgroundColor: "#2563EB",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
  },
  modalSaveText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
