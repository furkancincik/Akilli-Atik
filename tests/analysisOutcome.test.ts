import { test } from "node:test";
import assert from "node:assert/strict";
import { AnalysisError, parseAnalysisOutcome } from "../supabase/functions/_shared/analysis.ts";

const result = {
  success: true, wasteName: "Test şişesi", category: "Plastik",
  description: "Yalnız test verisi.", sortingInstruction: "Ayrı topla.",
  recyclingAdvice: "Yerel kuralları doğrula.", safetyWarning: null,
  objectCount: "single", uncertain: false, hazardous: false,
};
const id = "00000000-0000-4000-8000-000000000004";
const invalid = (error: unknown) => error instanceof AnalysisError && error.code === "INVALID_RESPONSE";

test("Analiz sonucu ve kayıt durumu bağımsız doğrulanır; kaydedilme varsayılmaz", () => {
  for (const status of ["saved", "duplicate"])
    assert.deepEqual(parseAnalysisOutcome({ result, persistence: { status, id } }).persistence, { status, id });
  assert.equal(parseAnalysisOutcome({ result, persistence: { status: "failed" } }).result.success, true);
});

test("Kayıt durumu yoksa, UUID geçersizse veya ek alan taşıyorsa kayıt başarısı reddedilir", () => {
  for (const persistence of [undefined, null, {}, { status: "saved" }, { status: "saved", id: "bad" },
    { status: "failed", id }, { status: "duplicate", id, token: "test-only" }, { status: "not_saved" }])
    assert.throws(() => parseAnalysisOutcome({ result, persistence }), invalid);
});

test("Atık bulunamayan sonuç kaydedilmiş veya kayıt hatası olarak gösterilemez", () => {
  const noWaste = { ...result, success: false, wasteName: null, category: null, objectCount: "none",
    sortingInstruction: "", recyclingAdvice: "" };
  assert.deepEqual(parseAnalysisOutcome({ result: noWaste, persistence: { status: "not_saved" } }).persistence, { status: "not_saved" });
  for (const persistence of [{ status: "saved", id }, { status: "failed" }])
    assert.throws(() => parseAnalysisOutcome({ result: noWaste, persistence }), invalid);
});

test("Geçerli kayıt işareti geçersiz analiz JSON'unu meşru hale getirmez", () => {
  assert.throws(() => parseAnalysisOutcome({ result: { ...result, category: "bad" }, persistence: { status: "saved", id } }), invalid);
  assert.throws(() => parseAnalysisOutcome({ result, persistence: { status: "saved", id }, rawResponse: {} }), invalid);
});
