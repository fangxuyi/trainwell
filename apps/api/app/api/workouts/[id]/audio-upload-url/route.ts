import { NextRequest, NextResponse } from "next/server";
import {
  issueSignedToken,
  presignUrl,
  parseStoreIdFromDelegationToken,
} from "@vercel/blob";
import { requireSessionOwner } from "@/lib/auth";
import sql from "@/lib/db";
import {
  InsufficientCreditsError,
  reserveCreditsForSession,
} from "@/lib/credits";

export const dynamic = "force-dynamic";

// Vercel Blob's current control-plane API version. The presigned PUT (performed
// by the phone, outside the SDK) must send this as `x-api-version`, so we return
// it to the client rather than hardcoding it there — keeps mobile in lockstep
// with whatever @vercel/blob version the server ships.
const BLOB_API_VERSION = "12";

// Generous ceiling so it never blocks a legitimate recording. This is NOT the
// Groq transcription limit (that's checked separately at transcribe time); it
// only guards against absurd uploads. Compressed m4a is ~16 MB at 90 min.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

// Issues a presigned PUT URL so the phone can upload the whole recording
// straight to Vercel Blob, bypassing the 4.5 MB serverless request-body limit.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  const owner = await requireSessionOwner(sessionId);
  if (owner instanceof NextResponse) return owner;

  const sessions = await sql`
    SELECT duration_seconds FROM sessions WHERE id = ${sessionId}
  `;
  try {
    await reserveCreditsForSession(
      owner.userId,
      sessionId,
      Number(sessions[0]?.duration_seconds ?? 0)
    );
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json(
        {
          error: "insufficient_credits",
          requiredCredits: error.requiredCredits,
          balance: error.balance,
        },
        { status: 402 }
      );
    }
    throw error;
  }

  const body = (await req.json().catch(() => ({}))) as {
    sequence?: number;
    contentType?: string;
  };
  const sequence = body.sequence ?? 0;
  const contentType = body.contentType ?? "audio/mp4";

  const pathname = `sessions/${sessionId}/audio/chunk_${String(sequence).padStart(4, "0")}.m4a`;

  const signed = await issueSignedToken({
    pathname,
    operations: ["put"],
    allowedContentTypes: [contentType],
    maximumSizeInBytes: MAX_UPLOAD_BYTES,
  });

  const { presignedUrl } = await presignUrl(
    {
      clientSigningToken: signed.clientSigningToken,
      delegationToken: signed.delegationToken,
    },
    {
      operation: "put",
      pathname,
      access: "private",
      allowedContentTypes: [contentType],
      maximumSizeInBytes: MAX_UPLOAD_BYTES,
      // The blob pathname is deterministic (chunk_<seq>.m4a). If an upload is
      // interrupted after the blob lands but before the client records it, the
      // retry re-PUTs to the same path — which 400s ("blob already exists")
      // unless overwrite is allowed. Without this, any interrupted upload fails
      // permanently after retries.
      allowOverwrite: true,
    }
  );

  const storeId = parseStoreIdFromDelegationToken(signed.delegationToken);
  const blobUrl = `https://${storeId}.private.blob.vercel-storage.com/${pathname}`;

  return NextResponse.json({
    presignedUrl,
    blobUrl,
    contentType,
    apiVersion: BLOB_API_VERSION,
  });
}
