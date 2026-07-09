// Bridges Clerk's React-only auth token to the non-React code paths (the sync
// worker and api.ts run outside components). The root layout registers Clerk's
// getToken() here; api.ts reads the current token to attach an Authorization
// header. Returns null when signed out.
type TokenGetter = () => Promise<string | null>;

let getTokenFn: TokenGetter | null = null;

export function setTokenGetter(fn: TokenGetter | null): void {
  getTokenFn = fn;
}

export async function getAuthToken(): Promise<string | null> {
  if (!getTokenFn) return null;
  try {
    return await getTokenFn();
  } catch {
    return null;
  }
}
