import { Image } from "expo-image";
import {
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { ExerciseReferenceMedia } from "@trainwell/schemas";

interface ExerciseMediaPreviewProps {
  exerciseName: string;
  media: ExerciseReferenceMedia;
  expanded: boolean;
  onToggle: () => void;
}

export function ExerciseMediaPreview({
  exerciseName,
  media,
  expanded,
  onToggle,
}: ExerciseMediaPreviewProps) {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={styles.toggle}
        onPress={onToggle}
      >
        <Text style={styles.toggleIcon}>{expanded ? "×" : "▶"}</Text>
        <Text style={styles.toggleText}>
          {expanded ? "Close movement" : "View movement"}
        </Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.previewPanel}>
          <Image
            source={media.gifUrl}
            accessibilityLabel={`${exerciseName} movement demonstration`}
            style={styles.animation}
            contentFit="contain"
            cachePolicy="disk"
            recyclingKey={media.gifUrl}
            transition={180}
          />
          <Text style={styles.previewTitle}>Movement reference</Text>
          <Text style={styles.previewText}>
            Use this as a visual reminder, not a substitute for your trainer&apos;s cues or
            individualized guidance.
          </Text>
          <TouchableOpacity
            accessibilityRole="link"
            onPress={() => Linking.openURL("https://gymvisual.com/")}
          >
            <Text style={styles.attribution}>{media.attribution}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 10 },
  toggle: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(199, 243, 107, 0.24)",
    backgroundColor: "rgba(199, 243, 107, 0.07)",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  toggleIcon: { color: "#C7F36B", fontSize: 10, fontWeight: "800" },
  toggleText: {
    color: "#C7F36B",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  previewPanel: {
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    padding: 14,
    alignItems: "center",
  },
  animation: {
    width: 180,
    height: 180,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
  },
  previewTitle: {
    alignSelf: "stretch",
    color: "#F8FAFC",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 12,
  },
  previewText: {
    alignSelf: "stretch",
    color: "#94A3B8",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  attribution: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "600",
    marginTop: 10,
    textDecorationLine: "underline",
  },
});
