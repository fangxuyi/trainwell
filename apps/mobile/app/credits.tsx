import type { CreditBalance } from "@trainwell/schemas";
import { useAuth } from "@clerk/clerk-expo";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Purchases, {
  PRODUCT_CATEGORY,
  type PurchasesPackage,
} from "react-native-purchases";
import { configureRevenueCat } from "../src/billing/revenueCat";
import { apiGet } from "../src/utils/api";
import { colors, radii } from "../src/ui/theme";

function membershipName(tier: string | null | undefined): string {
  if (tier === "monthly_300") return "300-minute monthly";
  if (tier === "monthly_800") return "800-minute monthly";
  return "Pay as you go";
}

export default function CreditsScreen() {
  const { userId } = useAuth();
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [storeReady, setStoreReady] = useState(false);

  const loadBalance = useCallback(async () => {
    const current = await apiGet<CreditBalance>("/api/credits");
    setBalance(current);
    return current;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const currentBalance = await loadBalance();
      if (userId && (await configureRevenueCat(userId))) {
        setStoreReady(true);
        const offerings = await Purchases.getOfferings();
        const available = offerings.current?.availablePackages ?? [];
        setPackages(
          currentBalance.subscriptionTier
            ? available.filter(
                (item) => item.product.productCategory !== PRODUCT_CATEGORY.SUBSCRIPTION
              )
            : available
        );
      }
    } catch (error) {
      Alert.alert("Unable to load credits", (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loadBalance, userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function refreshAfterPurchase() {
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await loadBalance();
    }
  }

  async function purchase(item: PurchasesPackage) {
    setPurchasing(item.identifier);
    try {
      await Purchases.purchasePackage(item);
      await refreshAfterPurchase();
      Alert.alert("Purchase complete", "Your credits are ready to use.");
    } catch (error) {
      const purchaseError = error as { code?: string; message?: string };
      if (purchaseError.code !== Purchases.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
        Alert.alert("Purchase failed", purchaseError.message ?? "Please try again.");
      }
    } finally {
      setPurchasing(null);
    }
  }

  async function restore() {
    try {
      await Purchases.restorePurchases();
      await refreshAfterPurchase();
      Alert.alert("Purchases restored");
    } catch (error) {
      Alert.alert("Restore failed", (error as Error).message);
    }
  }

  if (loading) {
    return <ActivityIndicator style={styles.loading} size="large" color="#38BDF8" />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>YOUR TRAINING BALANCE</Text>
      <Text style={styles.title}>Credits & plans</Text>
      <Text style={styles.subtitle}>
        One credit covers one started minute of transcription.
      </Text>

      {balance?.stripeBillingStatus ? (
        <View style={styles.billingAlert}>
          <Text style={styles.billingAlertTitle}>Payment needs attention</Text>
          <Text style={styles.billingAlertMessage}>
            {balance.stripeBillingMessage ?? "Update your payment method in the web billing portal."}
          </Text>
        </View>
      ) : null}

      <View style={styles.balanceCard}>
        <View style={styles.balanceOrb} />
        <Text style={styles.balanceLabel}>AVAILABLE NOW</Text>
        <View style={styles.balanceValueRow}>
          <Text style={styles.balanceValue}>{balance?.totalCredits ?? 0}</Text>
          <Text style={styles.balanceUnit}>credits</Text>
        </View>
        <View style={styles.breakdownRow}>
          <View style={styles.breakdownItem}>
            <Text style={styles.breakdownValue}>{balance?.permanentCredits ?? 0}</Text>
            <Text style={styles.breakdownLabel}>Permanent</Text>
          </View>
          <View style={styles.breakdownDivider} />
          <View style={styles.breakdownItem}>
            <Text style={styles.breakdownValue}>{balance?.subscriptionCredits ?? 0}</Text>
            <Text style={styles.breakdownLabel}>Monthly</Text>
          </View>
        </View>
      </View>

      <View style={styles.membershipCard}>
        <View style={styles.membershipMark}><Text style={styles.membershipMarkText}>◆</Text></View>
        <View style={styles.membershipContent}>
          <Text style={styles.membershipEyebrow}>CURRENT MEMBERSHIP</Text>
          <Text style={styles.membershipName}>{membershipName(balance?.subscriptionTier)}</Text>
          <Text style={styles.membershipDetail}>
            {balance?.subscriptionPeriodEnd
              ? `Monthly balance resets ${new Date(balance.subscriptionPeriodEnd).toLocaleDateString()}`
              : "Permanent credits stay available until you use them."}
          </Text>
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Available options</Text>
        <Text style={styles.sectionHint}>Secure App Store billing</Text>
      </View>
      {packages.map((item) => (
        <TouchableOpacity
          key={item.identifier}
          style={styles.productCard}
          disabled={purchasing !== null}
          onPress={() => purchase(item)}
        >
          <View style={styles.productText}>
            <Text style={styles.productTitle}>{item.product.title}</Text>
            <Text style={styles.productDescription}>{item.product.description}</Text>
          </View>
          <View style={styles.pricePill}>
            <Text style={styles.price}>
              {purchasing === item.identifier ? "…" : item.product.priceString}
            </Text>
          </View>
        </TouchableOpacity>
      ))}

      {!storeReady || packages.length === 0 ? (
        <View style={styles.unavailableCard}>
          <Text style={styles.unavailableTitle}>Purchases aren’t available here yet</Text>
          <Text style={styles.unavailable}>
            {Platform.OS === "ios"
              ? "Your balance is ready to use. App Store purchase options will appear when mobile billing is enabled."
              : "Mobile purchases are currently available on iOS."}
          </Text>
        </View>
      ) : (
        <TouchableOpacity style={styles.restoreButton} onPress={restore}>
          <Text style={styles.restoreText}>Restore Purchases</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 18, paddingBottom: 44 },
  loading: { flex: 1, backgroundColor: colors.background },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: "900", letterSpacing: 1.6, marginTop: 4 },
  title: { color: colors.text, fontSize: 32, fontWeight: "900", letterSpacing: -1, marginTop: 7 },
  subtitle: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 7, marginBottom: 22 },
  billingAlert: {
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: "rgba(255, 125, 125, 0.25)",
    backgroundColor: "rgba(58, 30, 36, 0.7)",
    padding: 16,
    marginBottom: 12,
  },
  billingAlertTitle: { color: "#FFD0D0", fontSize: 14, fontWeight: "900" },
  billingAlertMessage: { color: "#FFB0B0", fontSize: 11, lineHeight: 17, marginTop: 5 },
  balanceCard: { backgroundColor: colors.accent, borderRadius: 28, padding: 22, overflow: "hidden" },
  balanceOrb: {
    position: "absolute",
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 32,
    borderColor: "rgba(16, 23, 7, 0.07)",
    right: -45,
    top: -55,
  },
  balanceLabel: { color: "#506A28", fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  balanceValueRow: { flexDirection: "row", alignItems: "baseline", marginTop: 4 },
  balanceValue: { color: colors.accentText, fontSize: 58, fontWeight: "900", letterSpacing: -2.5 },
  balanceUnit: { color: "#3E5220", fontSize: 14, fontWeight: "800", marginLeft: 8 },
  breakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 15,
    paddingTop: 15,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(16, 23, 7, 0.2)",
  },
  breakdownItem: { flex: 1 },
  breakdownValue: { color: colors.accentText, fontSize: 18, fontWeight: "900" },
  breakdownLabel: { color: "#526B2A", fontSize: 10, fontWeight: "700", marginTop: 2 },
  breakdownDivider: { width: 1, height: 34, backgroundColor: "rgba(16, 23, 7, 0.18)", marginHorizontal: 18 },
  membershipCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.large,
    padding: 17,
    marginTop: 12,
  },
  membershipMark: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.violetDark,
    marginRight: 13,
  },
  membershipMarkText: { color: colors.violet, fontSize: 16 },
  membershipContent: { flex: 1 },
  membershipEyebrow: { color: colors.textFaint, fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  membershipName: { color: colors.text, fontSize: 16, fontWeight: "800", marginTop: 4 },
  membershipDetail: { color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  sectionHeader: { marginTop: 30, marginBottom: 11 },
  sectionTitle: { color: colors.text, fontSize: 19, fontWeight: "900" },
  sectionHint: { color: colors.textFaint, fontSize: 10, marginTop: 3 },
  productCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.medium,
    padding: 16,
    marginBottom: 10,
  },
  productText: { flex: 1, paddingRight: 12 },
  productTitle: { color: colors.text, fontSize: 15, fontWeight: "800" },
  productDescription: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  pricePill: { backgroundColor: colors.accentDark, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 8 },
  price: { color: colors.accent, fontSize: 13, fontWeight: "900" },
  unavailableCard: {
    borderRadius: radii.medium,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    padding: 18,
    backgroundColor: "rgba(16, 21, 32, 0.6)",
  },
  unavailableTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  unavailable: { color: colors.textMuted, fontSize: 11, lineHeight: 17, marginTop: 5 },
  restoreButton: { padding: 16, alignItems: "center" },
  restoreText: { color: colors.accent, fontWeight: "800" },
});
