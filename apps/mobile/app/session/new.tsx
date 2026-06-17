import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import type { ProcessingMode, AudioRetentionPolicy } from "@trainwell/schemas";

const WORKOUT_TYPES = [
  "Strength Training",
  "Cardio",
  "Lower Body",
  "Upper Body",
  "Full Body",
  "HIIT",
  "Mobility",
  "Other",
];

const PROCESSING_MODES: { label: string; value: ProcessingMode; desc: string }[] = [
  {
    label: "Auto Upload",
    value: "automatic_hybrid",
    desc: "Upload and process automatically when connected",
  },
  {
    label: "Manual",
    value: "manual_upload",
    desc: "You choose when to upload",
  },
  {
    label: "Local Only",
    value: "local_only",
    desc: "Never upload — keep everything on device",
  },
];

const RETENTION_POLICIES: {
  label: string;
  value: AudioRetentionPolicy;
}[] = [
  { label: "Delete after review", value: "delete_after_review" },
  { label: "Delete after transcript", value: "delete_after_transcription" },
  { label: "Keep always", value: "keep" },
  { label: "Delete manually", value: "manual" },
];

export default function NewSessionScreen() {
  const router = useRouter();
  const [workoutType, setWorkoutType] = useState("Strength Training");
  const [trainerName, setTrainerName] = useState("");
  const [goal, setGoal] = useState("");
  const [processingMode, setProcessingMode] =
    useState<ProcessingMode>("automatic_hybrid");
  const [retentionPolicy, setRetentionPolicy] =
    useState<AudioRetentionPolicy>("delete_after_review");

  const handleStart = () => {
    router.replace({
      pathname: "/session/active",
      params: {
        workoutType,
        trainerName,
        goal,
        processingMode,
        audioRetentionPolicy: retentionPolicy,
      },
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Text style={styles.label}>Workout Type</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginBottom: 20 }}
      >
        {WORKOUT_TYPES.map((type) => (
          <TouchableOpacity
            key={type}
            style={[styles.chip, workoutType === type && styles.chipSelected]}
            onPress={() => setWorkoutType(type)}
          >
            <Text
              style={[
                styles.chipText,
                workoutType === type && styles.chipTextSelected,
              ]}
            >
              {type}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.label}>Trainer Name (optional)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Alex"
        placeholderTextColor="#475569"
        value={trainerName}
        onChangeText={setTrainerName}
        autoCapitalize="words"
      />

      <Text style={styles.label}>Goal for Today (optional)</Text>
      <TextInput
        style={[styles.input, { height: 80 }]}
        placeholder="e.g. Improve squat form"
        placeholderTextColor="#475569"
        value={goal}
        onChangeText={setGoal}
        multiline
        textAlignVertical="top"
      />

      <Text style={styles.label}>Processing Mode</Text>
      {PROCESSING_MODES.map((mode) => (
        <TouchableOpacity
          key={mode.value}
          style={[
            styles.optionRow,
            processingMode === mode.value && styles.optionRowSelected,
          ]}
          onPress={() => setProcessingMode(mode.value)}
        >
          <View style={styles.optionRadio}>
            {processingMode === mode.value && (
              <View style={styles.optionRadioFill} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.optionLabel}>{mode.label}</Text>
            <Text style={styles.optionDesc}>{mode.desc}</Text>
          </View>
        </TouchableOpacity>
      ))}

      <Text style={[styles.label, { marginTop: 12 }]}>Audio Retention</Text>
      {RETENTION_POLICIES.map((policy) => (
        <TouchableOpacity
          key={policy.value}
          style={[
            styles.optionRow,
            retentionPolicy === policy.value && styles.optionRowSelected,
          ]}
          onPress={() => setRetentionPolicy(policy.value)}
        >
          <View style={styles.optionRadio}>
            {retentionPolicy === policy.value && (
              <View style={styles.optionRadioFill} />
            )}
          </View>
          <Text style={styles.optionLabel}>{policy.label}</Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={styles.startButton} onPress={handleStart}>
        <Text style={styles.startButtonText}>Start Recording</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  label: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  input: {
    backgroundColor: "#1E293B",
    borderRadius: 10,
    color: "#F1F5F9",
    padding: 14,
    fontSize: 16,
    marginBottom: 20,
  },
  chip: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  chipSelected: { backgroundColor: "#2563EB" },
  chipText: { color: "#94A3B8", fontSize: 14 },
  chipTextSelected: { color: "#fff", fontWeight: "600" },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E293B",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  optionRowSelected: {
    borderWidth: 1,
    borderColor: "#2563EB",
  },
  optionRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#475569",
    alignItems: "center",
    justifyContent: "center",
  },
  optionRadioFill: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#2563EB",
  },
  optionLabel: { color: "#F1F5F9", fontSize: 15, fontWeight: "500" },
  optionDesc: { color: "#64748B", fontSize: 13, marginTop: 2 },
  startButton: {
    backgroundColor: "#16A34A",
    borderRadius: 14,
    padding: 18,
    alignItems: "center",
    marginTop: 24,
  },
  startButtonText: { color: "#fff", fontSize: 18, fontWeight: "700" },
});
