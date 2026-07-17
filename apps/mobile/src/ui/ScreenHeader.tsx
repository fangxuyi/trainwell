import type { ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radii } from "./theme";

interface ScreenHeaderProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  onBack: () => void;
  action?: ReactNode;
}

export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  onBack,
  action,
}: ScreenHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.navigationRow}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.backButton}
          onPress={onBack}
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.brand}>TRAINWELL</Text>
        <View style={styles.action}>{action}</View>
      </View>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function HeaderAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.actionButton} onPress={onPress}>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 22 },
  navigationRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 25,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: { color: colors.text, fontSize: 31, fontWeight: "300", lineHeight: 32, marginTop: -2 },
  brand: { color: colors.accent, fontSize: 10, fontWeight: "900", letterSpacing: 2.1 },
  action: { minWidth: 44, alignItems: "flex-end" },
  actionButton: {
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  actionLabel: { color: colors.accent, fontSize: 10, fontWeight: "900" },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: "900", letterSpacing: 1.6 },
  title: {
    color: colors.text,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "900",
    letterSpacing: -1.15,
    marginTop: 7,
  },
  subtitle: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 8 },
});
