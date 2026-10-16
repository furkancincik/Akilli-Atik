import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAnalysisStore,
  StorageUnavailableError,
  StorageValidationError,
} from "../supabase/functions/analyze-waste/storage.ts";
import {
  HAZARDOUS_SORTING,
  HAZARDOUS_WARNING,
  type WasteAnalysis,
} from "../supabase/functions/_shared/analysis.ts";

// Synthetic fixtures; no live database, JWT or Gemini request is used.
const userA = "00000000-0000-4000-8000-000000000001";
const userB = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";
const analysisId = "00000000-0000-4000-8000-000000000004";
const config = { supabaseUrl: "https://nyoxbwandadakfagoner.supabase.co", serviceRoleKey: "server-only-test-key" };
const valid: WasteAnalysis = {
  success: true,
  wasteName: "Plastik şişe",
  category: "Plastik",
  description: "Boş plastik içecek şişesi.",
  sortingInstruction: "Ambalaj toplama sistemine teslim et.",
  recyclingAdvice: "Yerel kabul kurallarını doğrula.",
  safetyWarning: null,
  objectCount: "single",
  uncertain: false,
  hazardous: false,
};
function row(result: WasteAnalysis = valid, userId = userA, clientRequestId = requestId) {
  return {
    id: analysisId,
    user_id: userId,
    client_request_id: clientRequestId,
    waste_name: result.wasteName,
    category: result.category,
    description: result.description,
    sorting_instruction: result.sortingInstruction,
    recycling_advice: result.recyclingAdvice,
    safety_warning: result.safetyWarning,
    object_count: result.objectCount,
    uncertain: result.uncertain,
    hazardous: result.hazardous,
    model: "gemini-test-model",
    schema_version: 1,
  };
}

test("Depo okuması kullanıcı ve istek UUID'siyle sınırlandırılır; yalnız izinli sütunlar seçilir", async () => {
  const store = createAnalysisStore(config, async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, config.supabaseUrl);
    assert.equal(url.pathname, "/rest/v1/waste_analyses");
    assert.equal(url.searchParams.get("user_id"), `eq.${userA}`);
    assert.equal(url.searchParams.get("client_request_id"), `eq.${requestId}`);
    assert.equal(url.searchParams.get("limit"), "2");
    assert.deepEqual(url.searchParams.get("select")?.split(",").sort(), Object.keys(row()).sort());
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("apikey"), config.serviceRoleKey);
    assert.equal(headers.get("authorization"), `Bearer ${config.serviceRoleKey}`);
    assert.doesNotMatch(String(input), /server-only-test-key/);
    return Response.json([row()]);
  });
  assert.deepEqual(await store.find(userA, requestId), {
    id: analysisId, result: valid, model: "gemini-test-model", schemaVersion: 1,
  });
});

test("Kayıt yoksa null; başka kullanıcı veya istek için dönen kayıt reddedilir", async () => {
  assert.equal(await createAnalysisStore(config, async () => Response.json([])).find(userA, requestId), null);
  for (const fixture of [row(valid, userB), row(valid, userA, analysisId)])
    await assert.rejects(
      createAnalysisStore(config, async () => Response.json([fixture])).find(userA, requestId),
      StorageUnavailableError,
    );
});

test("INSERT yalnız doğrulanmış analiz alanlarını ve sunucu kullanıcısını içerir; varsayılan kimlik/tarih DB'ye bırakılır", async () => {
  const store = createAnalysisStore(config, async (_, init) => {
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init.headers).get("Prefer"), "return=representation");
    const body = JSON.parse(String(init.body));
    const expected = Object.fromEntries(Object.entries(row()).filter(([key]) => key !== "id"));
    assert.deepEqual(body, expected);
    for (const forbidden of ["id", "created_at", "photo", "base64", "token", "raw_response", "success"])
      assert.equal(Object.hasOwn(body, forbidden), false);
    assert.equal(body.user_id, userA);
    return Response.json([row()], { status: 201 });
  });
  const outcome = await store.save(userA, requestId, valid, "gemini-test-model");
  assert.equal(outcome.status, "saved");
  assert.equal(outcome.id, analysisId);
  assert.deepEqual(outcome.result, valid);
});

test("Depo güvenlik kurallarını tekrar uygular: pil talimatları kayıttan önce güvenli hale gelir", async () => {
  let saved: Record<string, unknown> | undefined;
  const battery = { ...valid, wasteName: "Pil", category: "Pil" as const };
  const store = createAnalysisStore(config, async (_, init) => {
    saved = JSON.parse(String(init?.body));
    return Response.json([{ id: analysisId, ...saved }], { status: 201 });
  });
  const outcome = await store.save(userA, requestId, battery, "gemini-test-model");
  assert.equal(saved?.sorting_instruction, HAZARDOUS_SORTING);
  assert.equal(saved?.safety_warning, HAZARDOUS_WARNING);
  assert.equal(outcome.result.hazardous, true);
});

test("Hatalı UUID, kategori, ek alan, başarısız analiz veya boş model hiçbir DB isteği üretmez", async () => {
  let calls = 0;
  const store = createAnalysisStore(config, async () => { calls++; return Response.json([]); });
  for (const id of ["", "not-uuid", `${userA}&user_id=eq.${userB}`, "00000000-0000-0000-0000-000000000000"])
    await assert.rejects(store.find(id, requestId), StorageValidationError);
  await assert.rejects(store.save(userA, "invalid", valid, "gemini-test-model"), StorageValidationError);
  for (const result of [
    { ...valid, category: "Unknown" },
    { ...valid, user_id: userB },
    { ...valid, description: " " },
    { ...valid, success: false, wasteName: null, category: null, objectCount: "none", sortingInstruction: "", recyclingAdvice: "" },
  ])
    await assert.rejects(store.save(userA, requestId, result as WasteAnalysis, "gemini-test-model"), StorageValidationError);
  for (const model of [" ", "x".repeat(121), "model\nsecret"])
    await assert.rejects(store.save(userA, requestId, valid, model), StorageValidationError);
  assert.equal(calls, 0);
});

test("Tekrarlı INSERT 23505 sonrasında eski özgün kayıt ve model döner; yeni Gemini sonucu eski ID ile eşlenmez", async () => {
  const newerResult = { ...valid, wasteName: "Farklı şişe", description: "Yeni model cevabı." };
  const calls: string[] = [];
  const store = createAnalysisStore(config, async (input, init) => {
    calls.push(init?.method ?? "");
    if (init?.method === "POST")
      return Response.json({ code: "23505", message: "private-db-error" }, { status: 409 });
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("user_id"), `eq.${userA}`);
    assert.equal(url.searchParams.get("client_request_id"), `eq.${requestId}`);
    return Response.json([row()]);
  });
  const outcome = await store.save(userA, requestId, newerResult, "new-gemini-model");
  assert.deepEqual(calls, ["POST", "GET"]);
  assert.equal(outcome.status, "duplicate");
  assert.equal(outcome.id, analysisId);
  assert.equal(outcome.model, "gemini-test-model");
  assert.deepEqual(outcome.result, valid);
});

test("Eşzamanlı kayıt yarışında bir INSERT ve bir duplicate aynı ilk sonucu döndürür", async () => {
  let first: ReturnType<typeof row> | undefined;
  const store = createAnalysisStore(config, async (_, init) => {
    if (init?.method === "POST") {
      if (first) return Response.json({ code: "23505" }, { status: 409 });
      first = { id: analysisId, ...JSON.parse(String(init.body)) };
      return Response.json([first], { status: 201 });
    }
    return Response.json(first ? [first] : []);
  });
  const [one, two] = await Promise.all([
    store.save(userA, requestId, valid, "gemini-test-model"),
    store.save(userA, requestId, { ...valid, wasteName: "Başka nesne" }, "another-model"),
  ]);
  assert.deepEqual([one.status, two.status].sort(), ["duplicate", "saved"]);
  assert.equal(one.id, two.id);
  assert.deepEqual(one.result, two.result);
  assert.equal(two.model, "gemini-test-model");
});

test("23505 olmasına rağmen kullanıcı/istek kaydı yoksa başarı uydurulmaz", async () => {
  const store = createAnalysisStore(config, async (_, init) => init?.method === "POST"
    ? Response.json({ code: "23505" }, { status: 409 }) : Response.json([]));
  await assert.rejects(store.save(userA, requestId, valid, "gemini-test-model"), StorageUnavailableError);
});

test("Yabancı ID, bozuk sözleşme, fazla satır veya bilinmeyen DB sütunu saklanmış başarı olarak dönmez", async () => {
  for (const data of [
    [row(valid, userB)], [row(), row()], [{ ...row(), category: "Unknown" }],
    [{ ...row(), schema_version: 2 }], [{ ...row(), raw_response: "private" }],
    [{ ...row(), id: "invalid" }], [{ ...row(), waste_name: null }],
  ]) {
    const store = createAnalysisStore(config, async () => Response.json(data));
    await assert.rejects(store.find(userA, requestId), StorageUnavailableError);
    await assert.rejects(store.save(userA, requestId, valid, "gemini-test-model"), StorageUnavailableError);
  }
});

test("DB erişim, tablo eksikliği, bozuk JSON ve ağ hataları ayrıntısız StorageUnavailableError olur", async () => {
  for (const transport of [
    async () => Response.json({ code: "42501", message: "private-db-error" }, { status: 403 }),
    async () => Response.json({ code: "42P01", message: "private-db-error" }, { status: 404 }),
    async () => Response.json({ code: "other", message: "private-db-error" }, { status: 409 }),
    async () => new Response("not-json"),
    async () => { throw new Error("server-only-test-key private-db-error"); },
  ] satisfies Array<typeof fetch>) {
    const store = createAnalysisStore(config, transport);
    await assert.rejects(store.save(userA, requestId, valid, "gemini-test-model"), (error: unknown) => {
      assert.ok(error instanceof StorageUnavailableError);
      assert.doesNotMatch(error.message, /private-db-error|server-only-test-key/);
      return true;
    });
  }
});

test("DB yanıtı boyut sınırını aşarsa veya boşsa kayıt doğrulanmaz", async () => {
  for (const response of [new Response("x".repeat(32769)), new Response(null, { status: 204 })])
    await assert.rejects(
      createAnalysisStore(config, async () => response).find(userA, requestId),
      StorageUnavailableError,
    );
});

test("Depo isteği zaman aşımında iptal edilir; abort'u dikkate almayan taşıyıcı bile sonlu sürede hata verir", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | null | undefined;
  const store = createAnalysisStore({ ...config, timeoutMs: 50 }, async (_, init) => {
    signal = init?.signal;
    return new Promise<Response>(() => {});
  });
  const lookup = store.find(userA, requestId);
  const checked = assert.rejects(lookup, StorageUnavailableError);
  t.mock.timers.tick(50);
  await checked;
  assert.equal(signal?.aborted, true);
});

test("Güvensiz URL, yönlendirme, eksik anahtar ve geçersiz zaman aşımı yapılandırması reddedilir", () => {
  for (const settings of [
    { ...config, supabaseUrl: "http://remote.example" },
    { ...config, supabaseUrl: "https://another-project.supabase.co" },
    { ...config, supabaseUrl: "https://nyoxbwandadakfagoner.supabase.co:8443" },
    { ...config, supabaseUrl: "https://user:pass@project.supabase.co" },
    { ...config, supabaseUrl: "https://project.supabase.co?key=private" },
    { ...config, supabaseUrl: "https://project.supabase.co/another-path" },
    { ...config, serviceRoleKey: "" },
    { ...config, serviceRoleKey: "key\r\nX-Evil: true" },
    { ...config, timeoutMs: 0 }, { ...config, timeoutMs: 15001 },
  ]) assert.throws(() => createAnalysisStore(settings), StorageUnavailableError);
});

test("Ağsız yerel test adaptörü yalnız loopback adreslerini kullanabilir", async () => {
  for (const supabaseUrl of ["http://localhost:54321", "http://127.0.0.1:54321", "http://[::1]:54321"])
    assert.equal(await createAnalysisStore({ ...config, supabaseUrl }, async () => Response.json([])).find(userA, requestId), null);
});
