import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import sql from "@/lib/db";

// The Clerk user id for the current request, or null if unauthenticated.
// Works for both the web portal (session cookie) and the mobile app
// (Authorization: Bearer <token>).
export async function getUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId;
}

// Standard 401 for API routes when there's no authenticated user.
export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// Verifies the request is authenticated AND owns the given session. Returns the
// userId on success, or a NextResponse (401 if signed out, 404 if the session
// isn't theirs / doesn't exist) to return directly from the route. Use on
// per-session routes so a user can't act on another user's session by id.
export async function requireSessionOwner(
  sessionId: string
): Promise<{ userId: string } | NextResponse> {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  const rows = await sql`SELECT user_id FROM sessions WHERE id = ${sessionId}`;
  if (rows.length === 0 || rows[0].user_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return { userId };
}
