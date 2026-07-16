import type { CreditBalance } from "@trainwell/schemas";
import { useAuth, useUser } from "@clerk/clerk-expo";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { colors, radii } from "./theme";

interface AccountDrawerProps {
  visible: boolean;
  balance: CreditBalance | null;
  onClose: () => void;
}

function planLabel(balance: CreditBalance | null): string {
  if (!balance?.subscriptionTier) return "No active membership";
  if (balance.subscriptionTier === "monthly_300") return "300-minute monthly";
  if (balance.subscriptionTier === "monthly_800") return "800-minute monthly";
  return balance.subscriptionTier.replaceAll("_", " ");
}

export function AccountDrawer({ visible, balance, onClose }: AccountDrawerProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user } = useUser();
  const { signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const email = user?.primaryEmailAddress?.emailAddress ?? "Signed-in account";
  const displayName = user?.fullName || user?.username || email.split("@")[0];
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  function navigate(path: "/credits" | "/history" | "/ask") {
    onClose();
    router.push(path);
  }

  function confirmSwitchAccount() {
    Alert.alert(
      "Switch account?",
      "You’ll be signed out, then you can choose another account.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: async () => {
            setSigningOut(true);
            try {
              await signOut();
              onClose();
              router.replace("/sign-in");
            } finally {
              setSigningOut(false);
            }
          },
        },
      ]
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <View style={[styles.panel, { width: Math.min(width * 0.88, 360) }]}>
          <View style={styles.drawerHeader}>
            <Text style={styles.brand}>TRAINWELL</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close account menu"
              style={styles.closeButton}
              onPress={onClose}
            >
              <Text style={styles.closeText}>×</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.identityRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials || "TW"}</Text>
            </View>
            <View style={styles.identityText}>
              <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
              <Text style={styles.email} numberOfLines={1}>{email}</Text>
              <View style={styles.signedInBadge}>
                <View style={styles.onlineDot} />
                <Text style={styles.signedInText}>Signed in</Text>
              </View>
            </View>
          </View>

          <TouchableOpacity style={styles.creditCard} onPress={() => navigate("/credits")}>
            <View>
              <Text style={styles.creditEyebrow}>AVAILABLE BALANCE</Text>
              <View style={styles.creditValueRow}>
                <Text style={styles.creditValue}>{balance?.totalCredits ?? "—"}</Text>
                <Text style={styles.creditUnit}>credits</Text>
              </View>
            </View>
            <View style={styles.creditArrow}>
              <Text style={styles.creditArrowText}>→</Text>
            </View>
            <View style={styles.creditBreakdown}>
              <Text style={styles.breakdownText}>
                {balance?.permanentCredits ?? "—"} permanent
              </Text>
              <View style={styles.breakdownDivider} />
              <Text style={styles.breakdownText}>
                {balance?.subscriptionCredits ?? "—"} monthly
              </Text>
            </View>
          </TouchableOpacity>

          <View style={styles.planCard}>
            <View style={styles.planIcon}>
              <Text style={styles.planIconText}>◆</Text>
            </View>
            <View style={styles.planContent}>
              <Text style={styles.planLabel}>MEMBERSHIP</Text>
              <Text style={styles.planName}>{planLabel(balance)}</Text>
              <Text style={styles.planDetail}>
                {balance?.subscriptionPeriodEnd
                  ? `Monthly balance resets ${new Date(balance.subscriptionPeriodEnd).toLocaleDateString()}`
                  : "Permanent credits never expire"}
              </Text>
            </View>
          </View>

          <View style={styles.menuSection}>
            <Text style={styles.menuLabel}>QUICK LINKS</Text>
            <DrawerItem title="Credits & plans" detail="Balance and purchases" onPress={() => navigate("/credits")} />
            <DrawerItem title="Workout history" detail="All recorded sessions" onPress={() => navigate("/history")} />
            <DrawerItem title="Ask Trainwell" detail="Search your training history" onPress={() => navigate("/ask")} />
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.switchButton}
              onPress={confirmSwitchAccount}
              disabled={signingOut}
            >
              {signingOut ? (
                <ActivityIndicator color={colors.danger} />
              ) : (
                <>
                  <View>
                    <Text style={styles.switchTitle}>Switch account</Text>
                    <Text style={styles.switchDetail}>Sign out and use another login</Text>
                  </View>
                  <Text style={styles.switchArrow}>↗</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close account menu"
          style={styles.scrim}
          onPress={onClose}
        />
      </View>
    </Modal>
  );
}

function DrawerItem({
  title,
  detail,
  onPress,
}: {
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress}>
      <View>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuDetail}>{detail}</Text>
      </View>
      <Text style={styles.menuArrow}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, flexDirection: "row" },
  panel: {
    backgroundColor: colors.background,
    paddingTop: 58,
    paddingHorizontal: 20,
    paddingBottom: 28,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  scrim: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.64)" },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 26,
  },
  brand: { color: colors.accent, fontSize: 13, fontWeight: "900", letterSpacing: 2.2 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  closeText: { color: colors.text, fontSize: 26, lineHeight: 28, fontWeight: "300" },
  identityRow: { flexDirection: "row", alignItems: "center", marginBottom: 22 },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
    marginRight: 14,
  },
  avatarText: { color: colors.accentText, fontWeight: "900", fontSize: 19 },
  identityText: { flex: 1 },
  name: { color: colors.text, fontSize: 19, fontWeight: "800" },
  email: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  signedInBadge: { flexDirection: "row", alignItems: "center", marginTop: 7 },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success, marginRight: 6 },
  signedInText: { color: colors.success, fontSize: 11, fontWeight: "700" },
  creditCard: {
    backgroundColor: colors.accent,
    borderRadius: radii.large,
    padding: 18,
    marginBottom: 12,
    overflow: "hidden",
  },
  creditEyebrow: { color: "#496026", fontSize: 10, fontWeight: "900", letterSpacing: 1.3 },
  creditValueRow: { flexDirection: "row", alignItems: "baseline", marginTop: 2 },
  creditValue: { color: colors.accentText, fontSize: 40, fontWeight: "900", letterSpacing: -1.5 },
  creditUnit: { color: "#35461C", fontSize: 14, fontWeight: "700", marginLeft: 7 },
  creditArrow: {
    position: "absolute",
    right: 17,
    top: 18,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(16, 23, 7, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  creditArrowText: { color: colors.accentText, fontSize: 19, fontWeight: "700" },
  creditBreakdown: { flexDirection: "row", alignItems: "center", marginTop: 11 },
  breakdownText: { color: "#405422", fontSize: 11, fontWeight: "700" },
  breakdownDivider: { width: 1, height: 12, backgroundColor: "rgba(16,23,7,0.2)", marginHorizontal: 9 },
  planCard: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.medium,
    padding: 15,
  },
  planIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.violetDark,
    marginRight: 12,
  },
  planIconText: { color: colors.violet, fontSize: 14 },
  planContent: { flex: 1 },
  planLabel: { color: colors.textFaint, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  planName: { color: colors.text, fontSize: 14, fontWeight: "800", marginTop: 3, textTransform: "capitalize" },
  planDetail: { color: colors.textMuted, fontSize: 11, marginTop: 3 },
  menuSection: { marginTop: 28 },
  menuLabel: { color: colors.textFaint, fontSize: 10, fontWeight: "900", letterSpacing: 1.5, marginBottom: 6 },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  menuTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  menuDetail: { color: colors.textFaint, fontSize: 11, marginTop: 2 },
  menuArrow: { color: colors.textMuted, fontSize: 26, fontWeight: "300" },
  footer: { marginTop: "auto", paddingTop: 20 },
  switchButton: {
    minHeight: 62,
    borderRadius: radii.medium,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255, 125, 125, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 125, 125, 0.18)",
  },
  switchTitle: { color: colors.danger, fontSize: 14, fontWeight: "800" },
  switchDetail: { color: colors.textFaint, fontSize: 10, marginTop: 3 },
  switchArrow: { color: colors.danger, fontSize: 18 },
});
