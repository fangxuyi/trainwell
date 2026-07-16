import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import type { WorkoutSession, ExerciseRecord } from "@trainwell/schemas";
import { getSessionById, saveExerciseEdits, finalizeSession } from "../../src/db/sessions";
import { deleteLocalAudio } from "../../src/storage/audioFiles";

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [exercises, setExercises] = useState<ExerciseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSessionById(id).then((s) => {
      setSession(s);
      setExercises(s?.exercises ?? []);
      setLoading(false);
    });
  }, [id]);

  const updateExerciseName = (idx: number, name: string) => {
    setExercises((prev) =>
      prev.map((ex, i) => (i === idx ? { ...ex, canonicalName: name } : ex))
    );
  };

  const updateSet = (
    exIdx: number,
    setIdx: number,
    field: "completedReps" | "weightValue",
    raw: string
  ) => {
    const num = parseInt(raw, 10);
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) => {
            if (j !== setIdx) return s;
            if (field === "completedReps") return { ...s, completedReps: isNaN(num) ? undefined : num };
            if (field === "weightValue" && s.weight) {
              return { ...s, weight: { ...s.weight, value: isNaN(num) ? s.weight.value : num } };
            }
            return s;
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
              await finalizeSession(id);
              if (session?.audioRetentionPolicy === "delete_after_review") {
                await deleteLocalAudio(id);
              }
              router.replace(`/session/${id}`);
            } catch (err) {
              Alert.alert("Error", (err as Error).message);
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <Text style={styles.intro}>
        Review what Claude extracted. Edit anything that's wrong, then tap Finalize.
      </Text>

      {exercises.length === 0 && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No exercises were extracted from this session.</Text>
        </View>
      )}

      {exercises.map((ex, exIdx) => (
        <View key={ex.id} style={styles.card}>
          <Text style={styles.cardLabel}>Exercise {exIdx + 1}</Text>
          <TextInput
            style={styles.nameInput}
            value={ex.canonicalName}
            onChangeText={(v) => updateExerciseName(exIdx, v)}
            placeholder="Exercise name"
            placeholderTextColor="#475569"
          />

          {ex.sets.filter((s) => s.completed).map((set, setIdx) => (
            <View key={setIdx} style={styles.setRow}>
              <Text style={styles.setLabel}>Set {set.setNumber}</Text>
              <View style={styles.setFields}>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Reps</Text>
                  <TextInput
                    style={styles.fieldInput}
                    keyboardType="number-pad"
                    value={set.completedReps != null ? String(set.completedReps) : ""}
                    onChangeText={(v) => updateSet(exIdx, setIdx, "completedReps", v)}
                    placeholder="—"
                    placeholderTextColor="#475569"
                  />
                </View>
                {set.weight && (
                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>
                      Weight ({set.weight.unit})
                    </Text>
                    <TextInput
                      style={styles.fieldInput}
                      keyboardType="decimal-pad"
                      value={set.weight.value != null ? String(set.weight.value) : ""}
                      onChangeText={(v) => updateSet(exIdx, setIdx, "weightValue", v)}
                      placeholder="—"
                      placeholderTextColor="#475569"
                    />
                  </View>
                )}
              </View>
            </View>
          ))}

          {ex.techniqueNotes.length > 0 && (
            <View style={styles.cueBox}>
              <Text style={styles.cueLabel}>Trainer cues</Text>
              {ex.techniqueNotes.map((n, i) => (
                <Text key={i} style={styles.cueText}>• {n.text}</Text>
              ))}
            </View>
          )}
        </View>
      ))}

      <TouchableOpacity
        style={[styles.finalizeButton, saving && styles.buttonDisabled]}
        onPress={handleFinalize}
        disabled={saving}
      >
        <Text style={styles.finalizeText}>
          {saving ? "Saving..." : "Finalize Session"}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  center: { alignItems: "center", justifyContent: "center" },
  errorText: { color: "#F87171", fontSize: 16 },
  intro: { color: "#64748B", fontSize: 14, marginBottom: 16, lineHeight: 20 },
  card: {
    backgroundColor: "#1E293B",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  cardLabel: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  nameInput: {
    backgroundColor: "#0F172A",
    borderRadius: 8,
    color: "#F1F5F9",
    fontSize: 16,
    fontWeight: "600",
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
  },
  setRow: { marginBottom: 8 },
  setLabel: { color: "#94A3B8", fontSize: 12, marginBottom: 4 },
  setFields: { flexDirection: "row", gap: 10 },
  fieldGroup: { flex: 1 },
  fieldLabel: { color: "#64748B", fontSize: 11, marginBottom: 3 },
  fieldInput: {
    backgroundColor: "#0F172A",
    borderRadius: 8,
    color: "#F1F5F9",
    fontSize: 15,
    paddingHorizontal: 10,
    paddingVertical: 7,
    textAlign: "center",
  },
  cueBox: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#0F172A",
    paddingTop: 8,
  },
  cueLabel: { color: "#64748B", fontSize: 11, marginBottom: 4 },
  cueText: { color: "#94A3B8", fontSize: 13, lineHeight: 18 },
  emptyCard: {
    backgroundColor: "#1E293B",
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
    marginBottom: 16,
  },
  emptyText: { color: "#475569", fontSize: 14 },
  finalizeButton: {
    backgroundColor: "#7C3AED",
    borderRadius: 14,
    padding: 18,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  finalizeText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
