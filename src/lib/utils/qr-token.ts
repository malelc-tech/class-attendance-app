// Anti-proxy measure #1: rotating QR tokens.
//
// Instead of a static QR code (which a student could screenshot and
// forward to friends), the teacher's screen shows a code that changes
// every ROTATE_SECONDS. Each token is an HMAC-SHA256 signature over
// (classId + time-bucket), keyed by a per-class secret that only
// lives server-side (classes.qr_secret). A screenshotted code is
// worthless within seconds, and nobody outside the server can forge
// a valid token without the secret.
//
// This module must only be imported in server-side code (Route
// Handlers) — it is never bundled for the client.

import { createHmac, timingSafeEqual } from "crypto";

export const ROTATE_SECONDS = 10;

function timeBucket(date = new Date()): number {
  return Math.floor(date.getTime() / 1000 / ROTATE_SECONDS);
}

export function signToken(classId: string, secret: string, bucket: number): string {
  const payload = `${classId}.${bucket}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${bucket}.${sig}`;
}

/** Generates the token that should currently be displayed on the teacher's screen. */
export function currentToken(classId: string, secret: string): {
  token: string;
  expiresInMs: number;
} {
  const bucket = timeBucket();
  const token = signToken(classId, secret, bucket);
  const msIntoWindow = (Date.now() / 1000) % ROTATE_SECONDS;
  const expiresInMs = Math.round((ROTATE_SECONDS - msIntoWindow) * 1000);
  return { token, expiresInMs };
}

/**
 * Verifies a token submitted by a student. Accepts the current bucket
 * AND the previous one, to tolerate normal scan/network latency
 * (roughly a 10-20s grace window total) without letting a stale
 * screenshot stay valid for long.
 */
export function verifyToken(
  classId: string,
  secret: string,
  submittedToken: string
): boolean {
  const [bucketStr, sig] = submittedToken.split(".");
  const bucket = Number(bucketStr);
  if (!bucket || !sig) return false;

  const nowBucket = timeBucket();
  if (bucket !== nowBucket && bucket !== nowBucket - 1) {
    return false; // too old (or from the future — clock skew abuse)
  }

  const expected = signToken(classId, secret, bucket).split(".")[1];

  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
