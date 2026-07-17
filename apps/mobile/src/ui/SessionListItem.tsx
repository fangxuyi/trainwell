import type { WorkoutSession } from "@trainwell/schemas";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { formatDuration } from "../utils/time";
import { sessionStatusPresentation } from "./sessionPresentation";
import { colors, radii } from "./theme";

export function SessionListItem({
  session,
  onPress,
}: {
  session: WorkoutSession;
  onPress: () => void;
}) {
  const date = new Date(session.startedAt);
  const status = sessionStatusPresentation(session);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={styles.dateTile}>
        <Text style={styles.dateMonth}>
          {date.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}
        </Text>
        <Text style={styles.dateDay}>{date.getDate()}</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.type} numberOfLines={1}>
          {session.workoutType || "Training session"}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[
            session.trainerName ? `with ${session.trainerName}` : null,
            session.durationSeconds ? formatDuration(session.durationSeconds) : null,
          ]
            .filter(Boolean)
            .join("  ·  ") || "Workout captured"}
        </Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: status.color }]} />
          <Text style={[styles.status, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>
      <Text style={styles.arrow}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.medium,
    padding: 13,
    marginBottom: 10,
  },
  dateTile: {
    width: 52,
    height: 62,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },
  dateMonth: { color: colors.accent, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  dateDay: { color: colors.text, fontSize: 22, fontWeight: "900", marginTop: 1 },
  content: { flex: 1 },
  type: { color: colors.text, fontSize: 15, fontWeight: "800" },
  meta: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 7 },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  status: { fontSize: 10, fontWeight: "800" },
  arrow: { color: colors.textFaint, fontSize: 24, fontWeight: "300", marginLeft: 8 },
});
