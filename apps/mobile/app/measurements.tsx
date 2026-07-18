import type { BodyMeasurement, BodyMeasurementUnit } from "@trainwell/schemas";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
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
import { useFocusEffect, useRouter } from "expo-router";
import {
  createBodyMeasurement,
  deleteBodyMeasurement,
  listBodyMeasurements,
  syncBodyMeasurements,
} from "../src/db/bodyMeasurements";
import { ScreenHeader } from "../src/ui/ScreenHeader";
import { colors, radii } from "../src/ui/theme";

const COMMON_BODY_PARTS = [
  "Waist",
  "Chest",
  "Hips",
  "Shoulders",
  "Neck",
  "Left arm",
  "Right arm",
  "Left thigh",
  "Right thigh",
  "Left calf",
  "Right calf",
] as const;

function todayInput(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime()) || todayInputForDate(date) !== value) return null;
  return date.toISOString();
}

function todayInputForDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function normalizedPart(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function inCentimeters(measurement: BodyMeasurement): number {
  return measurement.unit === "cm" ? measurement.value : measurement.value * 2.54;
}

function changeLabel(current: BodyMeasurement, previous?: BodyMeasurement): string | null {
  if (!previous) return null;
  const deltaCm = inCentimeters(current) - inCentimeters(previous);
  const delta = current.unit === "cm" ? deltaCm : deltaCm / 2.54;
  if (Math.abs(delta) < 0.005) return "No change";
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)} ${current.unit}`;
}

export default function MeasurementsScreen() {
  const router = useRouter();
  const [measurements, setMeasurements] = useState<BodyMeasurement[]>([]);
  const [selectedPart, setSelectedPart] = useState<string>("Waist");
  const [customPart, setCustomPart] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<BodyMeasurementUnit>("cm");
  const [date, setDate] = useState(todayInput());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setMeasurements(await listBodyMeasurements());
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      listBodyMeasurements().then((rows) => {
        if (active) setMeasurements(rows);
      });
      syncBodyMeasurements()
        .then(() => listBodyMeasurements())
        .then((rows) => {
          if (active) setMeasurements(rows);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [])
  );

  const grouped = useMemo(() => {
    const result = new Map<string, BodyMeasurement[]>();
    for (const measurement of measurements) {
      const key = normalizedPart(measurement.bodyPart);
      const existing = result.get(key) ?? [];
      existing.push(measurement);
      result.set(key, existing);
    }
    return Array.from(result.values()).sort(
      (left, right) =>
        new Date(right[0].measuredAt).getTime() - new Date(left[0].measuredAt).getTime()
    );
  }, [measurements]);

  const save = async () => {
    const bodyPart = selectedPart === "Custom" ? customPart.trim() : selectedPart;
    const numericValue = Number(value);
    const measuredAt = parseDateInput(date);
    if (!bodyPart) {
      Alert.alert("Choose a body part", "Select a common area or enter your own label.");
      return;
    }
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      Alert.alert("Check the measurement", "Enter a number greater than zero.");
      return;
    }
    if (!measuredAt) {
      Alert.alert("Check the date", "Use the format YYYY-MM-DD.");
      return;
    }

    setSaving(true);
    try {
      await createBodyMeasurement({
        bodyPart,
        value: numericValue,
        unit,
        measuredAt,
        note,
      });
      await load();
      setValue("");
      setNote("");
      setDate(todayInput());
      setShowForm(false);
      syncBodyMeasurements().then(load).catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (measurement: BodyMeasurement) => {
    Alert.alert(
      "Delete measurement?",
      `${measurement.bodyPart} · ${measurement.value} ${measurement.unit}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteBodyMeasurement(measurement.id);
            await load();
            syncBodyMeasurements().then(load).catch(() => {});
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ScreenHeader
            eyebrow="BODY PROGRESS"
            title="Measurements"
            subtitle="Track the changes that the mirror cannot measure for you."
            onBack={() => router.back()}
            action={
              <TouchableOpacity style={styles.addHeaderButton} onPress={() => setShowForm(!showForm)}>
                <Text style={styles.addHeaderText}>{showForm ? "Close" : "+ Add"}</Text>
              </TouchableOpacity>
            }
          />

          <View style={styles.heroCard}>
            <View style={styles.heroRing} />
            <Text style={styles.heroEyebrow}>YOUR BASELINE</Text>
            <Text style={styles.heroValue}>{grouped.length || "—"}</Text>
            <Text style={styles.heroLabel}>
              {grouped.length === 1 ? "body area tracked" : "body areas tracked"}
            </Text>
            <Text style={styles.heroBody}>
              Consistency matters more than frequency. Measure under similar conditions each time.
            </Text>
          </View>

          {showForm ? (
            <View style={styles.formCard}>
              <Text style={styles.formEyebrow}>NEW MEASUREMENT</Text>
              <Text style={styles.formTitle}>What changed?</Text>

              <Text style={styles.fieldLabel}>BODY PART</Text>
              <View style={styles.chipWrap}>
                {[...COMMON_BODY_PARTS, "Custom"].map((part) => (
                  <TouchableOpacity
                    key={part}
                    style={[styles.chip, selectedPart === part && styles.chipSelected]}
                    onPress={() => setSelectedPart(part)}
                  >
                    <Text style={[styles.chipText, selectedPart === part && styles.chipTextSelected]}>
                      {part}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {selectedPart === "Custom" ? (
                <TextInput
                  style={styles.input}
                  value={customPart}
                  onChangeText={setCustomPart}
                  placeholder="e.g. Forearm"
                  placeholderTextColor={colors.textFaint}
                  maxLength={60}
                  autoCapitalize="words"
                />
              ) : null}

              <Text style={styles.fieldLabel}>MEASUREMENT</Text>
              <View style={styles.measurementRow}>
                <TextInput
                  style={[styles.input, styles.valueInput]}
                  value={value}
                  onChangeText={setValue}
                  placeholder="0.0"
                  placeholderTextColor={colors.textFaint}
                  keyboardType="decimal-pad"
                />
                <View style={styles.unitToggle}>
                  {(["cm", "in"] as BodyMeasurementUnit[]).map((option) => (
                    <TouchableOpacity
                      key={option}
                      style={[styles.unitButton, unit === option && styles.unitButtonSelected]}
                      onPress={() => setUnit(option)}
                    >
                      <Text style={[styles.unitText, unit === option && styles.unitTextSelected]}>
                        {option}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <Text style={styles.fieldLabel}>DATE</Text>
              <TextInput
                style={styles.input}
                value={date}
                onChangeText={setDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textFaint}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />

              <Text style={styles.fieldLabel}>NOTE · OPTIONAL</Text>
              <TextInput
                style={[styles.input, styles.noteInput]}
                value={note}
                onChangeText={setNote}
                placeholder="Same time of day, post-workout, or anything useful"
                placeholderTextColor={colors.textFaint}
                multiline
                maxLength={500}
              />

              <TouchableOpacity
                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                onPress={save}
                disabled={saving}
              >
                <Text style={styles.saveText}>{saving ? "Saving…" : "Save measurement"}</Text>
                <Text style={styles.saveArrow}>→</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionEyebrow}>LATEST BY AREA</Text>
            <Text style={styles.sectionTitle}>Your current numbers</Text>
          </View>

          {grouped.length === 0 ? (
            <TouchableOpacity style={styles.emptyCard} onPress={() => setShowForm(true)}>
              <Text style={styles.emptyMark}>＋</Text>
              <Text style={styles.emptyTitle}>Build your baseline</Text>
              <Text style={styles.emptyBody}>
                Add waist, chest, hips, limbs, or any custom body area you care about.
              </Text>
            </TouchableOpacity>
          ) : (
            grouped.map((entries) => {
              const latest = entries[0];
              const change = changeLabel(latest, entries[1]);
              return (
                <View key={normalizedPart(latest.bodyPart)} style={styles.areaCard}>
                  <View style={styles.areaAccent} />
                  <View style={styles.areaTopRow}>
                    <View>
                      <Text style={styles.areaName}>{latest.bodyPart}</Text>
                      <Text style={styles.areaDate}>{displayDate(latest.measuredAt)}</Text>
                    </View>
                    <View style={styles.areaValueRow}>
                      <Text style={styles.areaValue}>{latest.value}</Text>
                      <Text style={styles.areaUnit}>{latest.unit}</Text>
                    </View>
                  </View>
                  <View style={styles.areaFooter}>
                    <Text style={[styles.changeText, change === "No change" && styles.changeNeutral]}>
                      {change ?? "First entry"}
                    </Text>
                    <Text style={styles.entryCount}>
                      {entries.length} {entries.length === 1 ? "entry" : "entries"}
                    </Text>
                  </View>
                </View>
              );
            })
          )}

          {measurements.length > 0 ? (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionEyebrow}>TIMELINE</Text>
                <Text style={styles.sectionTitle}>Measurement history</Text>
              </View>
              <View style={styles.historyCard}>
                {measurements.map((measurement, index) => (
                  <TouchableOpacity
                    key={measurement.id}
                    style={[
                      styles.historyRow,
                      index === measurements.length - 1 && styles.historyRowLast,
                    ]}
                    onLongPress={() => confirmDelete(measurement)}
                    accessibilityHint="Long press to delete"
                  >
                    <View style={styles.historyDot} />
                    <View style={styles.historyContent}>
                      <Text style={styles.historyPart}>{measurement.bodyPart}</Text>
                      <Text style={styles.historyDate}>{displayDate(measurement.measuredAt)}</Text>
                      {measurement.note ? (
                        <Text style={styles.historyNote}>{measurement.note}</Text>
                      ) : null}
                    </View>
                    <View style={styles.historyValueWrap}>
                      <Text style={styles.historyValue}>
                        {measurement.value} <Text style={styles.historyUnit}>{measurement.unit}</Text>
                      </Text>
                      <Text style={styles.syncLabel}>
                        {measurement.syncStatus === "synchronized" ? "SAVED" : "SYNCING"}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.deleteHint}>Long press a history entry to delete it.</Text>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 50 },
  addHeaderButton: {
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addHeaderText: { color: colors.accentText, fontSize: 10, fontWeight: "900" },
  heroCard: {
    minHeight: 226,
    borderRadius: 30,
    backgroundColor: colors.accent,
    padding: 23,
    overflow: "hidden",
    marginBottom: 16,
  },
  heroRing: {
    position: "absolute",
    width: 210,
    height: 210,
    borderRadius: 105,
    borderWidth: 38,
    borderColor: "rgba(16, 23, 7, 0.07)",
    right: -66,
    top: -58,
  },
  heroEyebrow: { color: "#4E6726", fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  heroValue: { color: colors.accentText, fontSize: 58, fontWeight: "900", letterSpacing: -2.5, marginTop: 15 },
  heroLabel: { color: colors.accentText, fontSize: 15, fontWeight: "800", marginTop: -4 },
  heroBody: { color: "#3F5221", fontSize: 12, lineHeight: 18, fontWeight: "600", maxWidth: 260, marginTop: 18 },
  formCard: {
    borderRadius: radii.large,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginBottom: 28,
  },
  formEyebrow: { color: colors.violet, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  formTitle: { color: colors.text, fontSize: 25, fontWeight: "900", letterSpacing: -0.6, marginTop: 5, marginBottom: 20 },
  fieldLabel: { color: colors.textFaint, fontSize: 9, fontWeight: "900", letterSpacing: 1.25, marginBottom: 8, marginTop: 15 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated, paddingHorizontal: 12, paddingVertical: 9 },
  chipSelected: { backgroundColor: colors.violetDark, borderColor: colors.violet },
  chipText: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  chipTextSelected: { color: colors.violet },
  input: { minHeight: 50, borderRadius: 14, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 15, fontWeight: "700", paddingHorizontal: 14 },
  noteInput: { minHeight: 88, paddingTop: 14, textAlignVertical: "top" },
  measurementRow: { flexDirection: "row", gap: 10 },
  valueInput: { flex: 1 },
  unitToggle: { flexDirection: "row", backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 4 },
  unitButton: { minWidth: 46, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  unitButtonSelected: { backgroundColor: colors.accent },
  unitText: { color: colors.textMuted, fontSize: 12, fontWeight: "900" },
  unitTextSelected: { color: colors.accentText },
  saveButton: { minHeight: 54, borderRadius: 16, backgroundColor: colors.accent, marginTop: 20, paddingHorizontal: 17, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  saveButtonDisabled: { opacity: 0.6 },
  saveText: { color: colors.accentText, fontSize: 14, fontWeight: "900" },
  saveArrow: { color: colors.accentText, fontSize: 20 },
  sectionHeader: { marginTop: 16, marginBottom: 12 },
  sectionEyebrow: { color: colors.textFaint, fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  sectionTitle: { color: colors.text, fontSize: 24, fontWeight: "900", letterSpacing: -0.6, marginTop: 4 },
  emptyCard: { minHeight: 170, borderRadius: radii.large, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyMark: { color: colors.accent, fontSize: 30, fontWeight: "300" },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 9 },
  emptyBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 7, maxWidth: 280 },
  areaCard: { borderRadius: radii.medium, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 9, overflow: "hidden" },
  areaAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: colors.accent },
  areaTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  areaName: { color: colors.text, fontSize: 16, fontWeight: "900" },
  areaDate: { color: colors.textFaint, fontSize: 10, fontWeight: "700", marginTop: 4 },
  areaValueRow: { flexDirection: "row", alignItems: "baseline", gap: 5 },
  areaValue: { color: colors.text, fontSize: 29, fontWeight: "900", letterSpacing: -0.8 },
  areaUnit: { color: colors.accent, fontSize: 11, fontWeight: "900" },
  areaFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.border, marginTop: 13, paddingTop: 11 },
  changeText: { color: colors.violet, fontSize: 10, fontWeight: "900" },
  changeNeutral: { color: colors.textMuted },
  entryCount: { color: colors.textFaint, fontSize: 10, fontWeight: "700" },
  historyCard: { borderRadius: radii.large, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16 },
  historyRow: { minHeight: 78, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 13 },
  historyRowLast: { borderBottomWidth: 0 },
  historyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginRight: 12 },
  historyContent: { flex: 1 },
  historyPart: { color: colors.text, fontSize: 13, fontWeight: "900" },
  historyDate: { color: colors.textFaint, fontSize: 9, fontWeight: "700", marginTop: 3 },
  historyNote: { color: colors.textMuted, fontSize: 10, lineHeight: 14, marginTop: 5, maxWidth: 210 },
  historyValueWrap: { alignItems: "flex-end", marginLeft: 10 },
  historyValue: { color: colors.text, fontSize: 16, fontWeight: "900" },
  historyUnit: { color: colors.textMuted, fontSize: 10 },
  syncLabel: { color: colors.textFaint, fontSize: 7, fontWeight: "900", letterSpacing: 1, marginTop: 5 },
  deleteHint: { color: colors.textFaint, fontSize: 9, textAlign: "center", marginTop: 10 },
});
