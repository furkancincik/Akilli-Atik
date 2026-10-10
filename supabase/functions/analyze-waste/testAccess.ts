import { AnalysisError } from "../_shared/analysis.ts";

export async function requireTestAccess(
  provided: string | null,
  expected: string | undefined,
  expiresAt: string | undefined,
  now: number,
): Promise<void> {
  const expiry = Date.parse(expiresAt ?? "");
  // Unconfigured, expired or excessively long test windows always fail closed.
  if (
    !expected ||
    expected.length < 32 ||
    expected.length > 256 ||
    !Number.isFinite(expiry) ||
    expiry <= now ||
    expiry - now > 15 * 60000
  )
    throw new AnalysisError("TEST_ACCESS_REQUIRED");
  if (!provided || provided.length > 256)
    throw new AnalysisError("TEST_ACCESS_REQUIRED");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(expected),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const proof = await crypto.subtle.sign("HMAC", key, encoder.encode(provided));
  // Native HMAC verification avoids comparing access-code strings with early exits.
  if (
    !(await crypto.subtle.verify("HMAC", key, proof, encoder.encode(expected)))
  )
    throw new AnalysisError("TEST_ACCESS_REQUIRED");
}
