import type { AudioRetentionPolicy, ProcessingMode } from "@trainwell/schemas";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { ScreenHeader } from "../../src/ui/ScreenHeader";
import { colors, radii } from "../../src/ui/theme";

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

const PROCESSING_MODES: {
  label: string;
  value: ProcessingMode;
  description: string;
  badge: string;
}[] = [
  {
    label: "Automatic",
    value: "automatic_hybrid",
    description: "Upload and create your workout record whenever you are connected.",
    badge: "RECOMMENDED",
  },
  {
    label: "Manual upload",
    value: "manual_upload",
    description: "Save the recording locally and choose when to upload it.",
    badge: "YOUR CONTROL",
  },
  {
    label: "Local only",
    value: "local_only",
    description: "Keep audio on this phone without a transcript or AI summary.",
    badge: "PRIVATE",
  },
];

const RETENTION_POLICIES: {
  label: string;
  value: AudioRetentionPolicy;
  description: string;
}[] = [
  {
    label: "Delete after review",
    value: "delete_after_review",
    description: "Keep audio until you approve the finished workout record.",
  },
  {
    label: "Delete after transcript",
    value: "delete_after_transcription",
    description: "Remove audio once transcription has completed.",
  },
  {
    label: "Keep on this phone",
    value: "keep",
    description: "Retain the recording unless you delete the session.",
  },
  {
    label: "Delete manually",
    value: "manual",
    description: "Only remove the recording when you explicitly choose to.",
  },
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
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <ScreenHeader
            eyebrow="SET THE INTENTION"
            title="New workout"
            subtitle="A little context now makes your training record much more useful later."
            onBack={() => router.back()}
          />

          <View style={styles.setupCard}>
            <View style={styles.setupAccent} />
            <View style={styles.setupCopy}>
              <Text style={styles.setupEyebrow}>READY TO RECORD</Text>
              <Text style={styles.setupTitle}>{workoutType}</Text>
              <Text style={styles.setupText}>
                One continuous recording. Your session stays safe locally while it processes.
              </Text>
            </View>
            <View style={styles.recordGlyph}>
              <View style={styles.recordDot} />
            </View>
          </View>

          <SectionHeading
            step="01"
            title="Choose your session"
            subtitle="Pick the closest match—you can still correct it later."
          />
          <View style={styles.typeGrid}>
            {WORKOUT_TYPES.map((type) => {
              const selected = workoutType === type;
              return (
                <TouchableOpacity
                  key={type}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[styles.typeChip, selected && styles.typeChipSelected]}
                  onPress={() => setWorkoutType(type)}
                >
                  <View style={[styles.typeIndicator, selected && styles.typeIndicatorSelected]} />
                  <Text style={[styles.typeText, selected && styles.typeTextSelected]}>
                    {type}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <SectionHeading
            step="02"
            title="Add useful context"
            subtitle="Both fields are optional. Short, specific notes work best."
          />
          <View style={styles.formCard}>
            <Text style={styles.fieldLabel}>TRAINER</Text>
            <TextInput
              style={styles.input}
              placeholder="Who are you training with?"
              placeholderTextColor={colors.textFaint}
              value={trainerName}
              onChangeText={setTrainerName}
              autoCapitalize="words"
              returnKeyType="next"
            />

            <View style={styles.fieldDivider} />

            <Text style={styles.fieldLabel}>TODAY&apos;S FOCUS</Text>
            <TextInput
              style={[styles.input, styles.goalInput]}
              placeholder="For example: improve squat depth"
              placeholderTextColor={colors.textFaint}
              value={goal}
              onChangeText={setGoal}
              multiline
              textAlignVertical="top"
            />
          </View>

          <SectionHeading
            step="03"
            title="Session handling"
            subtitle="Automatic is the simplest choice for most workouts."
          />
          <View style={styles.optionStack}>
            {PROCESSING_MODES.map((mode) => {
              const selected = processingMode === mode.value;
              return (
                <OptionCard
                  key={mode.value}
                  selected={selected}
                  label={mode.label}
                  description={mode.description}
                  badge={mode.badge}
                  onPress={() => setProcessingMode(mode.value)}
                />
              );
            })}
          </View>

          <SectionHeading
            step="04"
            title="Audio retention"
            subtitle="Choose when the physical recording should leave your phone."
          />
          <View style={styles.optionStack}>
            {RETENTION_POLICIES.map((policy) => (
              <OptionCard
                key={policy.value}
                selected={retentionPolicy === policy.value}
                label={policy.label}
                description={policy.description}
                onPress={() => setRetentionPolicy(policy.value)}
              />
            ))}
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Start ${workoutType} recording`}
            style={styles.startButton}
            onPress={handleStart}
          >
            <View style={styles.startIcon}>
              <View style={styles.startDot} />
            </View>
            <View style={styles.startCopy}>
              <Text style={styles.startEyebrow}>BEGIN SESSION</Text>
              <Text style={styles.startButtonText}>Start recording</Text>
            </View>
            <Text style={styles.startArrow}>→</Text>
          </TouchableOpacity>
          <Text style={styles.footerNote}>
            Recording begins on the next screen so you have time to get settled.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SectionHeading({
  step,
  title,
  subtitle,
}: {
  step: string;
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.sectionHeading}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepText}>{step}</Text>
      </View>
      <View style={styles.sectionCopy}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

function OptionCard({
  selected,
  label,
  description,
  badge,
  onPress,
}: {
  selected: boolean;
  label: string;
  description: string;
  badge?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.optionCard, selected && styles.optionCardSelected]}
      onPress={onPress}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={styles.radioFill} /> : null}
      </View>
      <View style={styles.optionCopy}>
        <View style={styles.optionTitleRow}>
          <Text style={styles.optionLabel}>{label}</Text>
          {badge ? (
            <Text style={[styles.optionBadge, selected && styles.optionBadgeSelected]}>
              {badge}
            </Text>
          ) : null}
        </View>
        <Text style={styles.optionDescription}>{description}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  keyboardView: { flex: 1 },
  scrollView: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 58 },
  setupCard: {
    position: "relative",
    overflow: "hidden",
    minHeight: 142,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.violetDark,
    borderWidth: 1,
    borderColor: "rgba(155, 138, 251, 0.22)",
    borderRadius: radii.large,
    padding: 19,
    marginBottom: 34,
  },
  setupAccent: {
    position: "absolute",
    width: 165,
    height: 165,
    borderRadius: 83,
    right: -70,
    top: -80,
    borderWidth: 30,
    borderColor: "rgba(155, 138, 251, 0.08)",
  },
  setupCopy: { flex: 1, paddingRight: 16 },
  setupEyebrow: { color: colors.violet, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  setupTitle: { color: colors.text, fontSize: 21, fontWeight: "900", letterSpacing: -0.5, marginTop: 7 },
  setupText: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 7 },
  recordGlyph: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: "rgba(7, 10, 17, 0.44)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  recordDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger },
  sectionHeading: { flexDirection: "row", alignItems: "flex-start", marginBottom: 14, marginTop: 2 },
  stepBadge: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.accentDark,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 11,
  },
  stepText: { color: colors.accent, fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  sectionCopy: { flex: 1 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "900", letterSpacing: -0.35 },
  sectionSubtitle: { color: colors.textFaint, fontSize: 11, lineHeight: 16, marginTop: 4 },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginBottom: 32 },
  typeChip: {
    minHeight: 46,
    flexBasis: "48%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 15,
    paddingHorizontal: 13,
  },
  typeChipSelected: { backgroundColor: colors.accentDark, borderColor: "rgba(199, 243, 107, 0.34)" },
  typeIndicator: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.textFaint, marginRight: 9 },
  typeIndicatorSelected: { backgroundColor: colors.accent },
  typeText: { color: colors.textMuted, fontSize: 12, fontWeight: "800" },
  typeTextSelected: { color: colors.text },
  formCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.large,
    padding: 16,
    marginBottom: 32,
  },
  fieldLabel: { color: colors.accent, fontSize: 9, fontWeight: "900", letterSpacing: 1.4, marginBottom: 8 },
  input: {
    minHeight: 48,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    color: colors.text,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 15,
  },
  goalInput: { minHeight: 88 },
  fieldDivider: { height: 1, backgroundColor: colors.border, marginVertical: 16 },
  optionStack: { gap: 9, marginBottom: 32 },
  optionCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.medium,
    padding: 15,
  },
  optionCardSelected: { backgroundColor: colors.accentDark, borderColor: "rgba(199, 243, 107, 0.34)" },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.textFaint,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    marginTop: 1,
  },
  radioSelected: { borderColor: colors.accent },
  radioFill: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  optionCopy: { flex: 1 },
  optionTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  optionLabel: { color: colors.text, fontSize: 14, fontWeight: "900" },
  optionBadge: { color: colors.textFaint, fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  optionBadgeSelected: { color: colors.success },
  optionDescription: { color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 5, paddingRight: 6 },
  startButton: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radii.large,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  startIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: colors.accentText,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },
  startDot: { width: 13, height: 13, borderRadius: 7, backgroundColor: colors.danger },
  startCopy: { flex: 1 },
  startEyebrow: { color: "#506A28", fontSize: 8, fontWeight: "900", letterSpacing: 1.3 },
  startButtonText: { color: colors.accentText, fontSize: 17, fontWeight: "900", letterSpacing: -0.35, marginTop: 3 },
  startArrow: { color: colors.accentText, fontSize: 24, fontWeight: "700" },
  footerNote: { color: colors.textFaint, fontSize: 10, lineHeight: 15, textAlign: "center", marginTop: 10, paddingHorizontal: 18 },
});
