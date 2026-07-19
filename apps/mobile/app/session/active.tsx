import type { AudioRetentionPolicy, ProcessingMode } from "@trainwell/schemas";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useActiveSession } from "../../src/hooks/useActiveSession";
import { recorder } from "../../src/recording/recorder";
import { colors, radii } from "../../src/ui/theme";
import { formatDuration } from "../../src/utils/time";

const BAR_COUNT = 42;
const MAX_BAR_HEIGHT = 54;

function Waveform({ isRecording }: { isRecording: boolean }) {
  const [bars, setBars] = useState<number[]>(Array(BAR_COUNT).fill(0.05));

  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      const decibels = recorder.getCurrentDb();
      const amplitude = Math.max(0.05, Math.min(1, (decibels + 60) / 60));
      setBars((previous) => [...previous.slice(1), amplitude]);
    }, 80);
    return () => clearInterval(interval);
  }, [isRecording]);

  return (
    <View style={waveformStyles.container} accessibilityLabel="Live recording waveform">
      {bars.map((amplitude, index) => (
        <View
          key={index}
          style={[
            waveformStyles.bar,
            {
              height: Math.max(3, amplitude * MAX_BAR_HEIGHT),
              opacity: isRecording ? 0.22 + (index / BAR_COUNT) * 0.78 : 0.18,
            },
          ]}
        />
      ))}
    </View>
  );
}

const waveformStyles = StyleSheet.create({
  container: {
    height: MAX_BAR_HEIGHT + 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  bar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
});

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

  useEffect(() => {
    if (hasStarted || state !== "idle") return;
    setHasStarted(true);
    start({
      workoutType: params.workoutType,
      trainerName: params.trainerName,
      goals: params.goal ? [params.goal] : [],
      processingMode: params.processingMode ?? "automatic_hybrid",
      audioRetentionPolicy: params.audioRetentionPolicy ?? "delete_after_review",
    }).catch((startError) =>
      Alert.alert("Recording unavailable", (startError as Error).message, [
        { text: "Go home", onPress: () => router.replace("/") },
      ])
    );
  }, [hasStarted, params, router, start, state]);

  const handlePauseResume = async () => {
    try {
      if (state === "recording") await pause();
      if (state === "paused") await resume();
    } catch (pauseError) {
      Alert.alert("Could not update recording", (pauseError as Error).message);
    }
  };

  const handleStop = () => {
    Alert.alert(
      "Finish this workout?",
      "Your recording will be secured on this phone first, then uploaded when a connection is available.",
      [
        { text: "Keep recording", style: "cancel" },
        {
          text: "Finish workout",
          style: "destructive",
          onPress: async () => {
            try {
              const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
              const finished = await Promise.race([stop(), timeout]);
              router.replace(finished ? `/session/${finished.id}` : "/");
            } catch {
              router.replace("/");
            }
          },
        },
      ]
    );
  };

  const handleAddNote = async () => {
    const text = noteText.trim();
    if (!text) return;
    await addNote(text);
    setNoteText("");
    setNoteModalVisible(false);
  };

  if (state === "creating" || (state === "idle" && !hasStarted)) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerState}>
          <View style={styles.loadingOrb}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
          <Text style={styles.stateEyebrow}>PREPARING AUDIO</Text>
          <Text style={styles.stateTitle}>Setting up your session</Text>
          <Text style={styles.stateBody}>Your workout will be saved locally from the first second.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || state === "error") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerState}>
          <View style={[styles.loadingOrb, styles.errorOrb]}>
            <Text style={styles.errorMark}>!</Text>
          </View>
          <Text style={[styles.stateEyebrow, styles.errorEyebrow]}>RECORDING INTERRUPTED</Text>
          <Text style={styles.stateTitle}>We could not start safely</Text>
          <Text style={styles.stateBody}>{error ?? "An unexpected recording error occurred."}</Text>
          <TouchableOpacity style={styles.homeButton} onPress={() => router.replace("/")}>
            <Text style={styles.homeButtonText}>Return home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isRecording = state === "recording";
  const isPaused = state === "paused";
  const isStopping = state === "stopping";
  const statusLabel = isRecording ? "Recording" : isPaused ? "Paused" : "Securing audio";

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.topBar}>
          <View>
            <Text style={styles.brand}>MOTION MEMO</Text>
            <Text style={styles.topCaption}>LIVE WORKOUT</Text>
          </View>
          <View style={[styles.statusPill, isPaused && styles.statusPillPaused]}>
            <View style={[styles.statusDot, isPaused && styles.statusDotPaused]} />
            <Text style={[styles.statusPillText, isPaused && styles.statusPillTextPaused]}>
              {statusLabel.toUpperCase()}
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.heroCard, isPaused && styles.heroCardPaused]}>
            <View style={styles.heroRingLarge} />
            <View style={styles.heroRingSmall} />
            <Text style={styles.heroEyebrow}>{isPaused ? "SESSION ON HOLD" : "SESSION IN MOTION"}</Text>
            <Text style={styles.timer}>{formatDuration(Math.round(elapsedSeconds))}</Text>
            <Waveform isRecording={isRecording} />
            <View style={styles.localSaveRow}>
              <View style={styles.localSaveIcon}>
                <Text style={styles.localSaveCheck}>✓</Text>
              </View>
              <Text style={styles.localSaveText}>Recording securely on this iPhone</Text>
            </View>
          </View>

          <View style={styles.sessionCard}>
            <View style={styles.sessionHeaderRow}>
              <View>
                <Text style={styles.cardEyebrow}>TODAY'S WORKOUT</Text>
                <Text style={styles.sessionTitle}>{session?.workoutType || "Training session"}</Text>
              </View>
              <View style={styles.sessionGlyph}>
                <View style={styles.glyphLine} />
                <View style={[styles.glyphLine, styles.glyphLineShort]} />
                <View style={styles.glyphLine} />
              </View>
            </View>
            <View style={styles.metadataRow}>
              <View style={styles.metadataChip}>
                <Text style={styles.metadataLabel}>COACH</Text>
                <Text style={styles.metadataValue}>{session?.trainerName || "Self-guided"}</Text>
              </View>
              <View style={styles.metadataChip}>
                <Text style={styles.metadataLabel}>NOTES</Text>
                <Text style={styles.metadataValue}>{notes.length}</Text>
              </View>
            </View>
          </View>

          {notes.length > 0 ? (
            <View style={styles.notesCard}>
              <View style={styles.notesHeadingRow}>
                <View>
                  <Text style={styles.cardEyebrow}>CAPTURED IN THE MOMENT</Text>
                  <Text style={styles.notesTitle}>Quick notes</Text>
                </View>
                <TouchableOpacity onPress={() => setNoteModalVisible(true)}>
                  <Text style={styles.addAnother}>+ Add</Text>
                </TouchableOpacity>
              </View>
              {notes.slice().reverse().map((note, index) => (
                <View key={note.id} style={[styles.noteRow, index === notes.length - 1 && styles.noteRowLast]}>
                  <Text style={styles.noteTime}>
                    {formatDuration(Math.round(note.offsetSeconds ?? 0))}
                  </Text>
                  <Text style={styles.noteText}>{note.text}</Text>
                </View>
              ))}
            </View>
          ) : (
            <TouchableOpacity style={styles.notePrompt} onPress={() => setNoteModalVisible(true)}>
              <View style={styles.notePromptIcon}><Text style={styles.notePromptPlus}>＋</Text></View>
              <View style={styles.notePromptContent}>
                <Text style={styles.notePromptTitle}>Capture a quick note</Text>
                <Text style={styles.notePromptBody}>Save a cue, milestone, or discomfort at this exact moment.</Text>
              </View>
              <Text style={styles.notePromptArrow}>→</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        <View style={styles.controlDock}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Add quick note"
            style={styles.noteControl}
            onPress={() => setNoteModalVisible(true)}
            disabled={isStopping}
          >
            <Text style={styles.noteControlPlus}>＋</Text>
            <Text style={styles.noteControlLabel}>Note</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={isRecording ? "Pause recording" : "Resume recording"}
            style={[styles.primaryControl, isPaused && styles.primaryControlPaused]}
            onPress={handlePauseResume}
            disabled={isStopping}
          >
            {isRecording ? (
              <View style={styles.pauseIcon}><View style={styles.pauseBar} /><View style={styles.pauseBar} /></View>
            ) : (
              <View style={styles.playIcon} />
            )}
            <Text style={styles.primaryControlLabel}>{isRecording ? "Pause" : "Resume"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Finish workout"
            style={styles.finishControl}
            onPress={handleStop}
            disabled={isStopping}
          >
            {isStopping ? <ActivityIndicator color={colors.danger} /> : <View style={styles.stopIcon} />}
            <Text style={styles.finishControlLabel}>{isStopping ? "Saving" : "Finish"}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={noteModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setNoteModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalEyebrow}>QUICK NOTE · {formatDuration(Math.round(elapsedSeconds))}</Text>
            <Text style={styles.modalTitle}>Capture the moment</Text>
            <Text style={styles.modalBody}>This note stays linked to the exact point in your recording.</Text>
            <TextInput
              style={styles.noteInput}
              placeholder="Trainer cue, how a set felt, pain, or a breakthrough…"
              placeholderTextColor={colors.textFaint}
              value={noteText}
              onChangeText={setNoteText}
              autoFocus
              multiline
              maxLength={500}
              returnKeyType="done"
              blurOnSubmit
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
                style={[styles.modalSave, !noteText.trim() && styles.modalSaveDisabled]}
                onPress={handleAddNote}
                disabled={!noteText.trim()}
              >
                <Text style={styles.modalSaveText}>Save note</Text>
                <Text style={styles.modalSaveArrow}>→</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  screen: { flex: 1, paddingHorizontal: 18, paddingTop: 8 },
  centerState: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  loadingOrb: { width: 86, height: 86, borderRadius: 28, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", marginBottom: 28 },
  errorOrb: { backgroundColor: "#341B22", borderColor: "rgba(255, 125, 125, 0.25)" },
  errorMark: { color: colors.danger, fontSize: 32, fontWeight: "900" },
  stateEyebrow: { color: colors.accent, fontSize: 9, fontWeight: "900", letterSpacing: 1.6 },
  errorEyebrow: { color: colors.danger },
  stateTitle: { color: colors.text, fontSize: 27, fontWeight: "900", letterSpacing: -0.7, textAlign: "center", marginTop: 8 },
  stateBody: { color: colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 10, maxWidth: 300 },
  homeButton: { minHeight: 50, borderRadius: 15, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", marginTop: 24 },
  homeButtonText: { color: colors.text, fontSize: 13, fontWeight: "900" },
  topBar: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  brand: { color: colors.accent, fontSize: 11, fontWeight: "900", letterSpacing: 2.4 },
  topCaption: { color: colors.textFaint, fontSize: 8, fontWeight: "900", letterSpacing: 1.35, marginTop: 4 },
  statusPill: { minHeight: 34, borderRadius: radii.pill, backgroundColor: colors.accentDark, borderWidth: 1, borderColor: "rgba(199, 243, 107, 0.24)", paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7 },
  statusPillPaused: { backgroundColor: "#352D18", borderColor: "rgba(244, 199, 107, 0.28)" },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  statusDotPaused: { backgroundColor: colors.warning },
  statusPillText: { color: colors.accent, fontSize: 8, fontWeight: "900", letterSpacing: 1.1 },
  statusPillTextPaused: { color: colors.warning },
  scrollContent: { paddingBottom: 18 },
  heroCard: { minHeight: 274, borderRadius: 30, backgroundColor: colors.accent, padding: 22, overflow: "hidden", marginBottom: 12 },
  heroCardPaused: { backgroundColor: colors.warning },
  heroRingLarge: { position: "absolute", width: 220, height: 220, borderRadius: 110, borderWidth: 38, borderColor: "rgba(16, 23, 7, 0.07)", right: -75, top: -72 },
  heroRingSmall: { position: "absolute", width: 82, height: 82, borderRadius: 41, backgroundColor: "rgba(255,255,255,0.16)", right: 32, bottom: 38 },
  heroEyebrow: { color: "#4E6726", fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  timer: { color: colors.accentText, fontSize: 60, fontWeight: "900", letterSpacing: -2.6, fontVariant: ["tabular-nums"], marginTop: 12 },
  localSaveRow: { flexDirection: "row", alignItems: "center", marginTop: "auto" },
  localSaveIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.accentText, alignItems: "center", justifyContent: "center", marginRight: 9 },
  localSaveCheck: { color: colors.accent, fontSize: 12, fontWeight: "900" },
  localSaveText: { color: "#3F5221", fontSize: 11, fontWeight: "800" },
  sessionCard: { borderRadius: radii.large, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 17, marginBottom: 12 },
  sessionHeaderRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  cardEyebrow: { color: colors.textFaint, fontSize: 8, fontWeight: "900", letterSpacing: 1.35 },
  sessionTitle: { color: colors.text, fontSize: 21, fontWeight: "900", letterSpacing: -0.45, marginTop: 5 },
  sessionGlyph: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.violetDark, alignItems: "center", justifyContent: "center", gap: 4 },
  glyphLine: { width: 18, height: 2, borderRadius: 1, backgroundColor: colors.violet },
  glyphLineShort: { width: 11 },
  metadataRow: { flexDirection: "row", gap: 8, marginTop: 16 },
  metadataChip: { flex: 1, minHeight: 54, borderRadius: 13, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, justifyContent: "center" },
  metadataLabel: { color: colors.textFaint, fontSize: 7, fontWeight: "900", letterSpacing: 1.1 },
  metadataValue: { color: colors.text, fontSize: 11, fontWeight: "800", marginTop: 4 },
  notesCard: { borderRadius: radii.large, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 17 },
  notesHeadingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  notesTitle: { color: colors.text, fontSize: 20, fontWeight: "900", marginTop: 4 },
  addAnother: { color: colors.accent, fontSize: 11, fontWeight: "900", padding: 6 },
  noteRow: { flexDirection: "row", alignItems: "flex-start", borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 12 },
  noteRowLast: { borderBottomWidth: 0 },
  noteTime: { color: colors.violet, fontSize: 9, fontWeight: "900", width: 46, marginTop: 2 },
  noteText: { color: colors.textMuted, fontSize: 12, lineHeight: 17, flex: 1 },
  notePrompt: { minHeight: 96, borderRadius: radii.large, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 15, flexDirection: "row", alignItems: "center" },
  notePromptIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: colors.violetDark, alignItems: "center", justifyContent: "center" },
  notePromptPlus: { color: colors.violet, fontSize: 22, fontWeight: "300" },
  notePromptContent: { flex: 1, marginLeft: 12 },
  notePromptTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  notePromptBody: { color: colors.textMuted, fontSize: 9, lineHeight: 14, marginTop: 4 },
  notePromptArrow: { color: colors.violet, fontSize: 18, marginLeft: 8 },
  controlDock: { minHeight: 94, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 12 },
  noteControl: { width: 68, height: 68, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  noteControlPlus: { color: colors.violet, fontSize: 21, fontWeight: "300", lineHeight: 22 },
  noteControlLabel: { color: colors.textMuted, fontSize: 8, fontWeight: "900", marginTop: 3 },
  primaryControl: { flex: 1, height: 68, borderRadius: 22, backgroundColor: colors.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  primaryControlPaused: { backgroundColor: colors.warning },
  pauseIcon: { flexDirection: "row", gap: 4 },
  pauseBar: { width: 4, height: 16, borderRadius: 2, backgroundColor: colors.accentText },
  playIcon: { width: 0, height: 0, borderTopWidth: 8, borderBottomWidth: 8, borderLeftWidth: 13, borderTopColor: "transparent", borderBottomColor: "transparent", borderLeftColor: colors.accentText, marginLeft: 3 },
  primaryControlLabel: { color: colors.accentText, fontSize: 14, fontWeight: "900" },
  finishControl: { width: 68, height: 68, borderRadius: 22, backgroundColor: "#2A171D", borderWidth: 1, borderColor: "rgba(255, 125, 125, 0.2)", alignItems: "center", justifyContent: "center" },
  stopIcon: { width: 15, height: 15, borderRadius: 4, backgroundColor: colors.danger },
  finishControlLabel: { color: colors.danger, fontSize: 8, fontWeight: "900", marginTop: 6 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.78)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: colors.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 20, paddingTop: 11, paddingBottom: 34 },
  modalHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 22 },
  modalEyebrow: { color: colors.violet, fontSize: 9, fontWeight: "900", letterSpacing: 1.35 },
  modalTitle: { color: colors.text, fontSize: 27, fontWeight: "900", letterSpacing: -0.7, marginTop: 6 },
  modalBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 7, marginBottom: 17 },
  noteInput: { minHeight: 112, borderRadius: 16, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, color: colors.text, padding: 14, fontSize: 15, lineHeight: 21, textAlignVertical: "top" },
  modalButtons: { flexDirection: "row", gap: 10, marginTop: 14 },
  modalCancel: { minHeight: 52, paddingHorizontal: 20, borderRadius: 15, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  modalCancelText: { color: colors.textMuted, fontSize: 12, fontWeight: "900" },
  modalSave: { flex: 1, minHeight: 52, borderRadius: 15, backgroundColor: colors.accent, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalSaveDisabled: { opacity: 0.45 },
  modalSaveText: { color: colors.accentText, fontSize: 13, fontWeight: "900" },
  modalSaveArrow: { color: colors.accentText, fontSize: 19 },
});
