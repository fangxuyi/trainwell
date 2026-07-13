import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

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
