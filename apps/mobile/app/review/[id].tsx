import type {
  ExerciseRecord,
  ExerciseSet,
  SourcedNote,
  WorkoutSession,
} from "@trainwell/schemas";
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
import { uuid } from "../../src/utils/uuid";

function newSourcedNote(text = ""): SourcedNote {
  return {
    text,
    confidence: 1,
    status: "user_corrected",
    sourceSegmentIds: [],
  };
}

function newExerciseSet(setNumber: number): ExerciseSet {
  return {
    setNumber,
    completed: true,
    userNotes: [],
    trainerNotes: [],
    confidence: 1,
    sourceSegmentIds: [],
    weight: undefined,
  };
}

function newExercise(sequenceNumber: number): ExerciseRecord {
  return {
    id: uuid(),
    canonicalName: "",
    spokenNames: [],
    bodyRegions: [],
    equipment: [],
    sequenceNumber,
    planned: false,
    completed: true,
    sets: [newExerciseSet(1)],
    techniqueNotes: [],
    userNotes: [],
    trainerNotes: [],
    painObservations: [],
    confidence: 1,
  };
}

function cleanedExercises(exercises: ExerciseRecord[]): ExerciseRecord[] {
  return exercises.map((exercise, exerciseIndex) => ({
    ...exercise,
    canonicalName: exercise.canonicalName.trim(),
    sequenceNumber: exerciseIndex + 1,
    completed: true,
    confidence: 1,
    sets: exercise.sets.map((set, setIndex) => ({
      ...set,
      setNumber: setIndex + 1,
      completed: true,
      confidence: 1,
    })),
    techniqueNotes: (exercise.techniqueNotes ?? []).flatMap((note) => {
      const text = typeof note?.text === "string" ? note.text.trim() : "";
      return text ? [{ ...note, text }] : [];
    }),
  }));
}

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
      setExercises(cleanedExercises(currentSession?.exercises ?? []));
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
        index === exerciseIndex
          ? { ...exercise, canonicalName: name, confidence: 1, referenceMedia: undefined }
          : exercise
      )
    );
  };

  const updateSet = (
    exerciseIndex: number,
    setIndex: number,
    field: "completedReps" | "weightValue" | "weightUnit",
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
              return {
                ...set,
                completedReps: raw === "" || Number.isNaN(value) ? undefined : value,
                completed: true,
                confidence: 1,
              };
            }
            if (field === "weightUnit") {
              return set.weight
                ? { ...set, weight: { ...set.weight, unit: raw, status: "user_corrected" } }
                : set;
            }
            if (field === "weightValue") {
              if (raw === "" || Number.isNaN(value)) return { ...set, weight: undefined };
              return {
                ...set,
                completed: true,
                confidence: 1,
                weight: {
                  value,
                  unit: set.weight?.unit ?? "lb",
                  confidence: 1,
                  status: "user_corrected",
                  sourceSegmentIds: set.weight?.sourceSegmentIds ?? [],
                },
              };
            }
            return set;
          }),
        };
      })
    );
  };

  const addSet = (exerciseIndex: number) => {
    setExercises((previous) =>
      previous.map((exercise, index) => {
        if (index !== exerciseIndex) return exercise;
        return {
          ...exercise,
          sets: [...exercise.sets, newExerciseSet(exercise.sets.length + 1)],
        };
      })
    );
  };

  const removeSet = (exerciseIndex: number, setIndex: number) => {
    setExercises((previous) =>
      previous.map((exercise, index) =>
        index === exerciseIndex
          ? {
              ...exercise,
              sets: exercise.sets
                .filter((_, currentSetIndex) => currentSetIndex !== setIndex)
                .map((set, currentSetIndex) => ({ ...set, setNumber: currentSetIndex + 1 })),
            }
          : exercise
      )
    );
  };

  const addExercise = () => {
    setExercises((previous) => [...previous, newExercise(previous.length + 1)]);
  };

  const removeExercise = (exerciseIndex: number) => {
    const exercise = exercises[exerciseIndex];
    Alert.alert(
      "Remove exercise?",
      `Remove ${exercise.canonicalName.trim() || `exercise ${exerciseIndex + 1}`} from this workout?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            setExercises((previous) =>
              previous
                .filter((_, index) => index !== exerciseIndex)
                .map((item, index) => ({ ...item, sequenceNumber: index + 1 }))
            );
          },
        },
      ]
    );
  };

  const addCue = (exerciseIndex: number) => {
    setExercises((previous) =>
      previous.map((exercise, index) =>
        index === exerciseIndex
          ? { ...exercise, techniqueNotes: [...exercise.techniqueNotes, newSourcedNote()] }
          : exercise
      )
    );
  };

  const updateCue = (exerciseIndex: number, cueIndex: number, text: string) => {
    setExercises((previous) =>
      previous.map((exercise, index) =>
        index === exerciseIndex
          ? {
              ...exercise,
              techniqueNotes: exercise.techniqueNotes.map((note, currentCueIndex) =>
                currentCueIndex === cueIndex ? newSourcedNote(text) : note
              ),
            }
          : exercise
      )
    );
  };

  const removeCue = (exerciseIndex: number, cueIndex: number) => {
    setExercises((previous) =>
      previous.map((exercise, index) =>
        index === exerciseIndex
          ? {
              ...exercise,
              techniqueNotes: exercise.techniqueNotes.filter(
                (_, currentCueIndex) => currentCueIndex !== cueIndex
              ),
            }
          : exercise
      )
    );
  };

  const handleFinalize = () => {
    const finalizedExercises = cleanedExercises(exercises);
    if (finalizedExercises.some((exercise) => !exercise.canonicalName)) {
      Alert.alert("Exercise name required", "Name every exercise or remove the empty exercise.");
      return;
    }
    if (
      finalizedExercises.some((exercise) =>
        exercise.sets.some(
          (set) =>
            (set.completedReps != null && (!Number.isInteger(set.completedReps) || set.completedReps < 0)) ||
            (set.weight != null && set.weight.value < 0)
        )
      )
    ) {
      Alert.alert("Check set values", "Reps must be whole numbers and reps and weight cannot be negative.");
      return;
    }

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
              await saveExerciseEdits(id, finalizedExercises);
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
            <Text style={styles.emptyText}>Add the exercises you completed, or finalize an empty workout.</Text>
          </View>
        ) : null}

        {exercises.map((exercise, exerciseIndex) => (
          <View key={exercise.id} style={styles.card}>
            <View style={styles.cardTopRow}>
              <Text style={styles.cardLabel}>EXERCISE {exerciseIndex + 1}</Text>
              <TouchableOpacity onPress={() => removeExercise(exerciseIndex)} hitSlop={8}>
                <Text style={styles.removeExerciseText}>REMOVE</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.nameInput}
              value={exercise.canonicalName}
              onChangeText={(value) => updateExerciseName(exerciseIndex, value)}
              placeholder="Exercise name"
              placeholderTextColor={colors.textFaint}
            />

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.editorSectionLabel}>SETS · {exercise.sets.length}</Text>
              <TouchableOpacity onPress={() => addSet(exerciseIndex)} style={styles.inlineAddButton}>
                <Text style={styles.inlineAddText}>＋ ADD SET</Text>
              </TouchableOpacity>
            </View>

            {exercise.sets.length === 0 ? (
              <Text style={styles.inlineEmptyText}>No sets recorded. Add one if needed.</Text>
            ) : null}

            {exercise.sets.map((set, setIndex) => (
              <View key={`${exercise.id}-${setIndex}`} style={styles.setRow}>
                <View style={styles.setHeaderRow}>
                  <Text style={styles.setLabel}>Set {setIndex + 1}</Text>
                  <TouchableOpacity onPress={() => removeSet(exerciseIndex, setIndex)} hitSlop={8}>
                    <Text style={styles.removeSetText}>Remove set</Text>
                  </TouchableOpacity>
                </View>
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
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>WEIGHT</Text>
                    <View style={styles.weightFieldRow}>
                      <TextInput
                        style={[styles.fieldInput, styles.weightInput]}
                        keyboardType="decimal-pad"
                        value={set.weight?.value != null ? String(set.weight.value) : ""}
                        onChangeText={(value) =>
                          updateSet(exerciseIndex, setIndex, "weightValue", value)
                        }
                        placeholder="—"
                        placeholderTextColor={colors.textFaint}
                      />
                      <TouchableOpacity
                        style={styles.unitButton}
                        onPress={() =>
                          updateSet(
                            exerciseIndex,
                            setIndex,
                            "weightUnit",
                            set.weight?.unit === "kg" ? "lb" : "kg"
                          )
                        }
                      >
                        <Text style={styles.unitText}>
                          {(set.weight?.unit ?? "lb").toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>
            ))}

            <View style={styles.cueBox}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.cueLabel}>TRAINER CUES</Text>
                <TouchableOpacity onPress={() => addCue(exerciseIndex)} style={styles.inlineAddButton}>
                  <Text style={styles.inlineAddText}>＋ ADD CUE</Text>
                </TouchableOpacity>
              </View>
              {exercise.techniqueNotes.length === 0 ? (
                <Text style={styles.inlineEmptyText}>No trainer cues recorded.</Text>
              ) : null}
              {exercise.techniqueNotes.map((note, cueIndex) => (
                <View key={`${exercise.id}-cue-${cueIndex}`} style={styles.cueEditRow}>
                  <TextInput
                    style={styles.cueInput}
                    value={note.text}
                    onChangeText={(value) => updateCue(exerciseIndex, cueIndex, value)}
                    placeholder="Add a coaching cue"
                    placeholderTextColor={colors.textFaint}
                    multiline
                  />
                  <TouchableOpacity onPress={() => removeCue(exerciseIndex, cueIndex)} hitSlop={8}>
                    <Text style={styles.removeCueText}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        ))}

        <TouchableOpacity style={styles.addExerciseButton} onPress={addExercise}>
          <Text style={styles.addExerciseIcon}>＋</Text>
          <View style={styles.addExerciseCopy}>
            <Text style={styles.addExerciseTitle}>Add exercise</Text>
            <Text style={styles.addExerciseText}>Include a movement the recap missed.</Text>
          </View>
        </TouchableOpacity>

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
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 9,
  },
  removeExerciseText: { color: colors.danger, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
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
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 9 },
  editorSectionLabel: { color: colors.textFaint, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  inlineAddButton: { paddingVertical: 4, paddingLeft: 10 },
  inlineAddText: { color: colors.accent, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  inlineEmptyText: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginBottom: 12 },
  setRow: { marginBottom: 14, borderRadius: 14, backgroundColor: colors.surfaceMuted, padding: 11 },
  setHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 7 },
  setLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "700", marginBottom: 6 },
  removeSetText: { color: colors.textFaint, fontSize: 9, fontWeight: "800" },
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
  weightFieldRow: { flexDirection: "row", gap: 6 },
  weightInput: { flex: 1 },
  unitButton: { minWidth: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  unitText: { color: colors.accent, fontSize: 10, fontWeight: "900" },
  cueBox: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 13,
  },
  cueLabel: { color: colors.violet, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  cueEditRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  cueInput: { flex: 1, minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.text, fontSize: 12, lineHeight: 17, paddingHorizontal: 11, paddingVertical: 9 },
  removeCueText: { color: colors.danger, fontSize: 22, fontWeight: "500", paddingHorizontal: 3 },
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
  addExerciseButton: { minHeight: 72, borderRadius: radii.large, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(199, 243, 107, 0.34)", backgroundColor: "rgba(199, 243, 107, 0.05)", flexDirection: "row", alignItems: "center", paddingHorizontal: 17, marginBottom: 12 },
  addExerciseIcon: { color: colors.accent, fontSize: 24, marginRight: 12 },
  addExerciseCopy: { flex: 1 },
  addExerciseTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  addExerciseText: { color: colors.textFaint, fontSize: 10, marginTop: 3 },
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
