import * as SecureStore from "expo-secure-store";

// Persists Clerk's session token in the device keychain via expo-secure-store,
// so the session survives app restarts.
export const tokenCache = {
  async getToken(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // ignore write failures — Clerk will re-fetch/re-issue as needed
    }
  },
};
