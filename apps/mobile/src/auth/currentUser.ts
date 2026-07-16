let currentUserId: string | null = null;

export function setCurrentUserId(userId: string | null): void {
  currentUserId = userId;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

export function requireCurrentUserId(): string {
  if (!currentUserId) throw new Error("No signed-in user");
  return currentUserId;
}
