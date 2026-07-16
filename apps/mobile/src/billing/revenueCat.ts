import { Platform } from "react-native";
import Purchases from "react-native-purchases";

let configuredUserId: string | null = null;

export async function configureRevenueCat(userId: string): Promise<boolean> {
  const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
  if (Platform.OS !== "ios" || !apiKey) return false;

  if (!(await Purchases.isConfigured())) {
    Purchases.configure({ apiKey, appUserID: userId });
  } else if (configuredUserId !== userId) {
    await Purchases.logIn(userId);
  }
  configuredUserId = userId;
  return true;
}
