import { NextRequest, NextResponse } from "next/server";
import {
  issueSignedToken,
  presignUrl,
  parseStoreIdFromDelegationToken,
} from "@vercel/blob";

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

  const body = (await req.json().catch(() => ({}))) as {
    sequence?: number;
    contentType?: string;
    chunkId?: string;
  };
  const sequence = body.sequence ?? 0;
  const contentType = body.contentType ?? "audio/mp4";
  const chunkId = body.chunkId ?? "";

  const pathname = `sessions/${sessionId}/audio/chunk_${String(sequence).padStart(4, "0")}.m4a`;

  // When the blob upload finishes, Vercel Blob POSTs this callback — which lets
  // the server transcribe + run the pipeline even if the app was backgrounded or
  // killed mid-upload (the file keeps uploading on a native background session,
  // but the app's JS never runs again). tokenPayload carries what the callback
  // needs; the secret lets it reject spoofed calls.
  const callbackUrl = `${req.nextUrl.origin}/api/blob/upload-complete`;
  const tokenPayload = JSON.stringify({
    sessionId,
    chunkId,
    sequence,
    secret: process.env.BLOB_CALLBACK_SECRET ?? "",
  });

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
      onUploadCompleted: { callbackUrl, tokenPayload },
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
