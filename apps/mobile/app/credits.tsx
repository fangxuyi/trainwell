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
      <View style={styles.balanceCard}>
        <Text style={styles.balanceValue}>{balance?.totalCredits ?? 0}</Text>
        <Text style={styles.balanceLabel}>credits available</Text>
        <Text style={styles.detail}>{balance?.permanentCredits ?? 0} purchased or free</Text>
        <Text style={styles.detail}>{balance?.subscriptionCredits ?? 0} monthly</Text>
        {balance?.subscriptionPeriodEnd ? (
          <Text style={styles.resetText}>
            Monthly credits reset {new Date(balance.subscriptionPeriodEnd).toLocaleDateString()}
          </Text>
        ) : null}
      </View>

      <Text style={styles.explainer}>One credit transcribes one started minute.</Text>
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
          <Text style={styles.price}>
            {purchasing === item.identifier ? "…" : item.product.priceString}
          </Text>
        </TouchableOpacity>
      ))}

      {!storeReady || packages.length === 0 ? (
        <Text style={styles.unavailable}>
          {Platform.OS === "ios"
            ? "App Store products are not available yet."
            : "Purchases are currently available on iOS."}
        </Text>
      ) : (
        <TouchableOpacity style={styles.restoreButton} onPress={restore}>
          <Text style={styles.restoreText}>Restore Purchases</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  content: { padding: 16, gap: 12 },
  loading: { flex: 1, backgroundColor: "#0F172A" },
  balanceCard: { backgroundColor: "#1E293B", borderRadius: 16, padding: 24, alignItems: "center" },
  balanceValue: { color: "#F8FAFC", fontSize: 48, fontWeight: "800" },
  balanceLabel: { color: "#38BDF8", fontSize: 16, fontWeight: "600", marginBottom: 12 },
  detail: { color: "#94A3B8", fontSize: 14 },
  resetText: { color: "#64748B", fontSize: 12, marginTop: 8 },
  explainer: { color: "#94A3B8", lineHeight: 20, marginVertical: 8 },
  productCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#1E293B", borderRadius: 14, padding: 16 },
  productText: { flex: 1, paddingRight: 12 },
  productTitle: { color: "#F1F5F9", fontSize: 16, fontWeight: "700" },
  productDescription: { color: "#94A3B8", fontSize: 13, marginTop: 3 },
  price: { color: "#38BDF8", fontSize: 16, fontWeight: "700" },
  unavailable: { color: "#64748B", textAlign: "center", padding: 20 },
  restoreButton: { padding: 16, alignItems: "center" },
  restoreText: { color: "#38BDF8", fontWeight: "600" },
});
