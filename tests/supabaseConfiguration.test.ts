import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSupabaseConfiguration } from "../src/services/supabaseConfiguration.ts";
const publicKey = "sb_publishable_test-only";
function jwt(role: string) {
  return `${btoa('{"alg":"HS256"}')}.${btoa(JSON.stringify({ role }))}.test-signature`;
}
test("Eksik veya bozuk Supabase yapılandırması erişim başlatmaz", () => {
  for (const [url, key] of [
    [undefined, undefined],
    ["https://project.supabase.co", ""],
    ["not-url", publicKey],
    ["https://project.supabase.co", "invalid-key"],
  ])
    assert.equal(validateSupabaseConfiguration(url, key), null);
});
test("Herkese açık publishable ve eski anon anahtarına izin verilir", () => {
  assert.deepEqual(
    validateSupabaseConfiguration(" https://project.supabase.co/ ", publicKey),
    { url: "https://project.supabase.co", key: publicKey },
  );
  assert.equal(
    validateSupabaseConfiguration("https://project.supabase.co", jwt("anon"))
      ?.key,
    jwt("anon"),
  );
});
test("Secret/service_role anahtarları frontend yapılandırmasında reddedilir", () => {
  for (const key of [
    "sb_secret_test-only",
    jwt("service_role"),
    jwt("authenticated"),
    "eyJ.invalid.invalid",
  ])
    assert.equal(
      validateSupabaseConfiguration("https://project.supabase.co", key),
      null,
    );
});
test("Uzak HTTP, URL içine gömülü kimlik, query ve ek yol reddedilir", () => {
  for (const url of [
    "http://project.supabase.co",
    "https://user:pass@project.supabase.co",
    "https://project.supabase.co?key=oops",
    "https://project.supabase.co/path",
    "https://project.supabase.co#fragment",
    "javascript:alert(1)",
  ])
    assert.equal(validateSupabaseConfiguration(url, publicKey), null);
  assert.ok(validateSupabaseConfiguration("http://127.0.0.1:54321", publicKey));
});
