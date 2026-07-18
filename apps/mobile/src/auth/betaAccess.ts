import * as SecureStore from "expo-secure-store";
import { apiGet } from "../utils/api";

const listeners = new Set<(userId: string) => void>();

function cacheKey(userId: string): string {
  return `trainwell-beta-access:${userId}`;
}

export async function resolveBetaAccess(userId: string): Promise<boolean> {
  const cached = await SecureStore.getItemAsync(cacheKey(userId)).catch(() => null);
  try {
    const status = await apiGet<{ allowed: boolean }>("/api/beta-access/status");
    if (status.allowed) {
      await SecureStore.setItemAsync(cacheKey(userId), "allowed").catch(() => undefined);
    } else {
      await SecureStore.deleteItemAsync(cacheKey(userId)).catch(() => undefined);
    }
    return status.allowed;
  } catch {
    return cached === "allowed";
  }
}

export async function notifyBetaAccessGranted(userId: string): Promise<void> {
  await SecureStore.setItemAsync(cacheKey(userId), "allowed").catch(() => undefined);
  listeners.forEach((listener) => listener(userId));
}

export function subscribeToBetaAccess(listener: (userId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
