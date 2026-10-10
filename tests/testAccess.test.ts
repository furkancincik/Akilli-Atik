import { test } from "node:test";
import assert from "node:assert/strict";
import { requireTestAccess } from "../supabase/functions/analyze-waste/testAccess.ts";
import { createHandler } from "../supabase/functions/analyze-waste/handler.ts";
import { AnalysisError } from "../supabase/functions/_shared/analysis.ts";
const token = "test-only-private-code-at-least-32-characters";
const now = Date.parse("2026-10-09T18:00:00Z");
const expiry = new Date(now + 10 * 60000).toISOString();
const denied = (error: unknown) =>
  error instanceof AnalysisError && error.code === "TEST_ACCESS_REQUIRED";

test("Süreli test erişimi doğru kod ve geçerli zaman penceresiyle çalışır", async () => {
  await assert.doesNotReject(requireTestAccess(token, token, expiry, now));
});
test("Eksik, yanlış veya fazla uzun test kodu reddedilir", async () => {
  for (const supplied of [null, "", "wrong-code", `${token}x`, "x".repeat(257)])
    await assert.rejects(
      requireTestAccess(supplied, token, expiry, now),
      denied,
    );
});
test("Sunucu test secret yoksa/kısaysa ve zaman penceresi geçersizse erişim kapanır", async () => {
  for (const [expected, expiresAt] of [
    [undefined, expiry],
    ["short", expiry],
    [token, undefined],
    [token, "invalid"],
    [token, new Date(now).toISOString()],
    [token, new Date(now + 16 * 60000).toISOString()],
  ] as const)
    await assert.rejects(
      requireTestAccess(token, expected, expiresAt, now),
      denied,
    );
});
test("Test penceresi fonksiyon yeniden başlasa da absolute expiry ile kapanır", async () => {
  await assert.rejects(
    requireTestAccess(token, token, expiry, now + 10 * 60000),
    denied,
  );
});
test("Public proje anahtarı tek başına, originsiz çağrıda da Gemini'ye erişemez", async () => {
  let calls = 0;
  const handler = createHandler(
    {
      enabled: true,
      apiKey: "test-provider-key",
      publicKeys: ["public-test-key"],
      allowedOrigins: [],
      testToken: token,
      testExpiresAt: expiry,
    },
    async () => {
      calls++;
      return Response.json({});
    },
    () => now,
  );
  for (const access of [undefined, "wrong-code"]) {
    const headers: Record<string, string> = {
      apikey: "public-test-key",
      "Content-Type": "image/jpeg",
    };
    if (access) headers["x-analysis-test-token"] = access;
    const response = await handler(
      new Request("https://example.supabase.co/functions/v1/analyze-waste", {
        method: "POST",
        headers,
        body: new Uint8Array([1, 2]).buffer,
      }),
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "TEST_ACCESS_REQUIRED");
  }
  assert.equal(calls, 0);
});
