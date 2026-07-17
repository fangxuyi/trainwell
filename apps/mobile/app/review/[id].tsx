import type { ExerciseRecord, WorkoutSession } from "@trainwell/schemas";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  finalizeSession,
  getSessionById,
  saveExerciseEdits,
} from "../../src/db/sessions";
import { enqueueJob } from "../../src/db/syncJobs";
import { deleteLocalAudio } from "../../src/storage/audioFiles";
import { runSyncWorker } from "../../src/sync/worker";
import { ScreenHeader } from "../../src/ui/ScreenHeader";
import { colors, radii } from "../../src/ui/theme";

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [exercises, setExercises] = useState<ExerciseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSessionById(id).then((currentSession) => {
      setSession(currentSession);
      setExercises(currentSession?.exercises ?? []);
      setLoading(false);
    });
  }, [id]);

  const returnToSession = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/session/${id}`);
    }
  };

  const updateExerciseName = (exerciseIndex: number, name: string) => {
    setExercises((previous) =>
      previous.map((exercise, index) =>
        index === exerciseIndex ? { ...exercise, canonicalName: name } : exercise
      )
    );
  };

  const updateSet = (
    exerciseIndex: number,
    setIndex: number,
    field: "completedReps" | "weightValue",
    raw: string
  ) => {
    const value = Number(raw);
    setExercises((previous) =>
      previous.map((exercise, index) => {
        if (index !== exerciseIndex) return exercise;
        return {
          ...exercise,
          sets: exercise.sets.map((set, currentSetIndex) => {
            if (currentSetIndex !== setIndex) return set;
            if (field === "completedReps") {
              return { ...set, completedReps: raw === "" || Number.isNaN(value) ? undefined : value };
            }
            if (field === "weightValue" && set.weight && raw !== "" && !Number.isNaN(value)) {
              return { ...set, weight: { ...set.weight, value } };
            }
            return set;
          }),
        };
      })
    );
  };

  const handleFinalize = () => {
    Alert.alert(
      "Finalize Session",
      "Mark this session as reviewed and finalized. Audio files will be deleted if your retention policy is set to delete after review.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Finalize",
          onPress: async () => {
            setSaving(true);
            try {
              await saveExerciseEdits(id, exercises);
              await enqueueJob(id, "finalize_remote_session");
              await finalizeSession(id);
              if (session?.audioRetentionPolicy === "delete_after_review") {
                await deleteLocalAudio(id);
              }
              void runSyncWorker(id);
              returnToSession();
            } catch (error) {
              Alert.alert("Could not finalize session", (error as Error).message);
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.safeArea, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={[styles.safeArea, styles.center]}>
        <Text style={styles.errorText}>Session not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader
          eyebrow="FINAL CHECK"
          title="Review session"
          subtitle="Confirm the workout record and correct anything the AI misunderstood."
          onBack={returnToSession}
        />

        {exercises.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No exercises extracted</Text>
            <Text style={styles.emptyText}>You can still finalize this session as reviewed.</Text>
          </View>
        ) : null}

        {exercises.map((exercise, exerciseIndex) => (
          <View key={exercise.id} style={styles.card}>
            <Text style={styles.cardLabel}>EXERCISE {exerciseIndex + 1}</Text>
            <TextInput
              style={styles.nameInput}
              value={exercise.canonicalName}
              onChangeText={(value) => updateExerciseName(exerciseIndex, value)}
              placeholder="Exercise name"
              placeholderTextColor={colors.textFaint}
            />

            {exercise.sets.map((set, setIndex) =>
              set.completed ? (
                <View key={`${exercise.id}-${set.setNumber}-${setIndex}`} style={styles.setRow}>
                  <Text style={styles.setLabel}>Set {set.setNumber}</Text>
                  <View style={styles.setFields}>
                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>REPS</Text>
                      <TextInput
                        style={styles.fieldInput}
                        keyboardType="number-pad"
                        value={set.completedReps != null ? String(set.completedReps) : ""}
                        onChangeText={(value) =>
                          updateSet(exerciseIndex, setIndex, "completedReps", value)
                        }
                        placeholder="—"
                        placeholderTextColor={colors.textFaint}
                      />
                    </View>
                    {set.weight ? (
                      <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>WEIGHT ({set.weight.unit.toUpperCase()})</Text>
                        <TextInput
                          style={styles.fieldInput}
                          keyboardType="decimal-pad"
                          value={set.weight.value != null ? String(set.weight.value) : ""}
                          onChangeText={(value) =>
                            updateSet(exerciseIndex, setIndex, "weightValue", value)
                          }
                          placeholder="—"
                          placeholderTextColor={colors.textFaint}
                        />
                      </View>
                    ) : null}
                  </View>
                </View>
              ) : null
            )}

            {exercise.techniqueNotes.length > 0 ? (
              <View style={styles.cueBox}>
                <Text style={styles.cueLabel}>TRAINER CUES</Text>
                {exercise.techniqueNotes.map((note, index) => (
                  <Text key={`${note.text}-${index}`} style={styles.cueText}>
                    • {note.text}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        ))}

        <TouchableOpacity
          style={[styles.finalizeButton, saving && styles.buttonDisabled]}
          onPress={handleFinalize}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color={colors.background} /> : null}
          <Text style={styles.finalizeText}>
            {saving ? "Finalizing…" : "Finalize session"}
          </Text>
          {!saving ? <Text style={styles.finalizeArrow}>→</Text> : null}
        </TouchableOpacity>
        <Text style={styles.finalizeNote}>
          Finalizing saves your corrections and removes this session from the review queue.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 60 },
  center: { alignItems: "center", justifyContent: "center" },
  errorText: { color: colors.danger, fontSize: 16 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.large,
    padding: 16,
    marginBottom: 12,
  },
  cardLabel: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
    marginBottom: 9,
  },
  nameInput: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    paddingHorizontal: 13,
    paddingVertical: 11,
    marginBottom: 14,
  },
  setRow: { marginBottom: 12 },
  setLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "700", marginBottom: 6 },
  setFields: { flexDirection: "row", gap: 10 },
  fieldGroup: { flex: 1 },
  fieldLabel: { color: colors.textFaint, fontSize: 9, fontWeight: "900", letterSpacing: 1, marginBottom: 5 },
  fieldInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 9,
    textAlign: "center",
  },
  cueBox: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 13,
  },
  cueLabel: { color: colors.violet, fontSize: 9, fontWeight: "900", letterSpacing: 1.2, marginBottom: 7 },
  cueText: { color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  emptyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.large,
    padding: 22,
    marginBottom: 16,
  },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
  emptyText: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  finalizeButton: {
    minHeight: 58,
    backgroundColor: colors.accent,
    borderRadius: radii.medium,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.65 },
  finalizeText: { color: colors.background, fontSize: 15, fontWeight: "900" },
  finalizeArrow: { color: colors.background, fontSize: 20, fontWeight: "700" },
  finalizeNote: { color: colors.textFaint, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 10, paddingHorizontal: 12 },
});
