import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AnalysisError,
  CATEGORIES,
  HAZARDOUS_SORTING,
  HAZARDOUS_WARNING,
  applySafetyRules,
  edgeError,
  parseAnalysis,
  upstreamError,
} from "../supabase/functions/_shared/analysis.ts";
import {
  MAX_ANALYSIS_BYTES,
  readLimitedBody,
  validateAnalysisImage,
} from "../supabase/functions/_shared/image.ts";
import {
  analyzeWithGemini,
  extractGeminiAnalysis,
} from "../supabase/functions/analyze-waste/gemini.ts";
import {
  createHandler,
  createLimiter,
} from "../supabase/functions/analyze-waste/handler.ts";
import type { ServerConfig } from "../supabase/functions/analyze-waste/handler.ts";

// Synthetic fixtures live only in tests; the app never generates analysis results.
const valid = {
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
const noWaste = {
  ...valid,
  success: false,
  wasteName: null,
  category: null,
  description: "Görselde ayırt edilebilir atık yok.",
  sortingInstruction: "",
  recyclingAdvice: "",
  objectCount: "none",
  uncertain: true,
};
const payload = (result: unknown = valid) => ({
  candidates: [
    {
      finishReason: "STOP",
      content: { parts: [{ text: JSON.stringify(result) }] },
    },
  ],
});
const assertCode = (code: string) => (error: unknown) =>
  error instanceof AnalysisError && error.code === code;
// Minimal structural JPEG fixture; actual decoding is delegated to Gemini, not mocked as a device test.
function jpeg(width = 1600, height = 800): Uint8Array {
  return new Uint8Array([
    255,
    216,
    255,
    192,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    1,
    1,
    17,
    0,
    255,
    218,
    0,
    8,
    1,
    1,
    0,
    0,
    63,
    0,
    0,
    255,
    217,
  ]);
}
const config: ServerConfig = {
  testToken: "test-only-private-code-at-least-32-characters",
  testExpiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
  enabled: true,
  apiKey: "test-provider-key",
  publicKeys: ["test-public-key"],
  allowedOrigins: ["https://localhost"],
};
function request(
  body: Uint8Array = jpeg(),
  headers: Record<string, string> = {},
  method = "POST",
) {
  return new Request("https://project.supabase.co/functions/v1/analyze-waste", {
    method,
    headers: {
      "Content-Type": "image/jpeg",
      "x-analysis-test-token": "test-only-private-code-at-least-32-characters",
      apikey: "test-public-key",
      Origin: "https://localhost",
      ...headers,
    },
    ...(method === "POST" ? { body: body.slice().buffer } : {}),
  });
}
const goodTransport: typeof fetch = async () => Response.json(payload());

test("Pilav gibi organik nesne adları pil olarak işaretlenmez", () => {
  const result = parseAnalysis({
    ...valid,
    wasteName: "Pilav",
    category: "Organik",
  });
  assert.equal(applySafetyRules(result).hazardous, false);
});

test("Geçerli JSON: sekiz kategorinin tümü ve yapılandırılmış alanlar kabul edilir", () => {
  for (const category of CATEGORIES)
    assert.equal(
      parseAnalysis(JSON.stringify({ ...valid, category })).category,
      category,
    );
  assert.deepEqual(parseAnalysis(valid), valid);
});
test("Geçersiz kategori, eksik alan, yanlış tür ve ek güven yüzdesi reddedilir", () => {
  for (const data of [
    { ...valid, category: "Bilinmeyen" },
    { ...valid, description: undefined },
    { ...valid, success: "true" },
    { ...valid, confidence: 99 },
    { ...valid, wasteName: "" },
    { ...valid, uncertain: null },
  ])
    assert.throws(() => parseAnalysis(data), assertCode("INVALID_RESPONSE"));
});
test("Geçersiz JSON ve aşırı uzun model cevabı reddedilir", () => {
  for (const data of [
    "not-json",
    "```json\n{}\n```",
    null,
    [],
    "x".repeat(16001),
  ])
    assert.throws(() => parseAnalysis(data), assertCode("INVALID_RESPONSE"));
});
test("Atık bulunmaması başarı değildir; tutarsız başarı/nesne alanları reddedilir", () => {
  assert.equal(parseAnalysis(noWaste).success, false);
  assert.throws(
    () => parseAnalysis({ ...noWaste, category: "Diğer" }),
    assertCode("INVALID_RESPONSE"),
  );
  assert.throws(
    () => parseAnalysis({ ...valid, objectCount: "none" }),
    assertCode("INVALID_RESPONSE"),
  );
  assert.throws(
    () => parseAnalysis({ ...noWaste, hazardous: true }),
    assertCode("INVALID_RESPONSE"),
  );
});
test("Birden fazla nesne ve belirsizlik işaretleri korunur", () => {
  const result = parseAnalysis({
    ...valid,
    objectCount: "multiple",
    uncertain: true,
  });
  assert.equal(result.objectCount, "multiple");
  assert.equal(result.uncertain, true);
});
test("Pil, elektronik, tehlikeli işareti ve riskli isimde modelin güvensiz talimatı değiştirilir", () => {
  for (const change of [
    { category: "Pil" },
    { category: "Elektronik" },
    { hazardous: true },
    { wasteName: "Lityum batarya", category: "Metal" },
    { wasteName: "Cıvalı ampul", category: "Cam" },
  ]) {
    const result = applySafetyRules(
      parseAnalysis({
        ...valid,
        ...change,
        description: "Söküp yak.",
        sortingInstruction: "Evsel çöpe at.",
        recyclingAdvice: "Del ve yak.",
        safetyWarning: null,
      }),
    );
    assert.equal(result.sortingInstruction, HAZARDOUS_SORTING);
    assert.equal(result.safetyWarning, HAZARDOUS_WARNING);
    assert.equal(result.hazardous, true);
    assert.doesNotMatch(result.description, /Söküp yak/);
  }
  assert.deepEqual(applySafetyRules(parseAnalysis(noWaste)), noWaste);
});
test("Kota, erişim, zaman aşımı ve servis hataları güvenli Türkçe kodlara eşlenir", () => {
  for (const [status, code] of [
    [429, "QUOTA_EXCEEDED"],
    [403, "INVALID_API_KEY"],
    [401, "INVALID_API_KEY"],
    [504, "TIMEOUT"],
    [500, "SERVICE_ERROR"],
  ] as const)
    assert.equal(upstreamError(status).code, code);
  assert.equal(
    edgeError(
      { error: { code: "MISSING_API_KEY", message: "secret-detail" } },
      503,
    ).code,
    "MISSING_API_KEY",
  );
  assert.equal(
    edgeError({ error: { code: "unknown", message: "secret-detail" } }, 403)
      .code,
    "UNAUTHORIZED",
  );
  assert.doesNotMatch(edgeError(null, 500).message, /secret-detail/);
});
test("Sunucu fotoğraf kontrolü: JPEG ölçüsü, türü, boyutu ve bozuk başlık", () => {
  assert.doesNotThrow(() => validateAnalysisImage(jpeg()));
  for (const bytes of [
    new Uint8Array(),
    new Uint8Array([137, 80, 78, 71]),
    jpeg(1601),
    jpeg(0),
    jpeg().slice(0, -2),
    new Uint8Array(MAX_ANALYSIS_BYTES + 1),
  ])
    assert.throws(
      () => validateAnalysisImage(bytes),
      assertCode("INVALID_PHOTO"),
    );
});
test("Akış boyut sınırı Content-Length olmadan uygulanır ve okuma iptal edilebilir", async () => {
  await assert.rejects(
    readLimitedBody(new Blob([new Uint8Array(11)]).stream(), 10),
    assertCode("INVALID_PHOTO"),
  );
  const controller = new AbortController();
  const body = new ReadableStream<Uint8Array>({ start() {} });
  const read = readLimitedBody(body, 10, "INVALID_PHOTO", controller.signal);
  controller.abort();
  await assert.rejects(read, assertCode("TIMEOUT"));
});
test("Gemini paketinden yalnız tamamlanmış metin alınır; kesilmiş/bloklanmış cevap reddedilir", () => {
  assert.deepEqual(extractGeminiAnalysis(payload()), valid);
  for (const value of [
    {},
    { candidates: [] },
    { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] },
    {
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: "bad-json" }] } },
      ],
    },
  ])
    assert.throws(
      () => extractGeminiAnalysis(value),
      assertCode("INVALID_RESPONSE"),
    );
});
test("Gemini HTTP isteği görüntü ve JSON şeması içerir; anahtar URL'ye konmaz", async () => {
  let called = false;
  const result = await analyzeWithGemini(
    jpeg(),
    "test-provider-key",
    undefined,
    async (url, init) => {
      called = true;
      assert.doesNotMatch(String(url), /test-provider-key/);
      assert.equal(
        new Headers(init?.headers).get("x-goog-api-key"),
        "test-provider-key",
      );
      const body = JSON.parse(String(init?.body));
      assert.equal(body.contents[0].parts[0].inlineData.mimeType, "image/jpeg");
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      assert.equal(
        body.generationConfig.responseJsonSchema.additionalProperties,
        false,
      );
      return Response.json(payload());
    },
  );
  assert.ok(called);
  assert.equal(result.success, true);
});
test("Gerçek API olmadan Gemini servis/kota/anahtar/JSON hataları", async () => {
  await assert.rejects(
    analyzeWithGemini(jpeg(), "", undefined, goodTransport),
    assertCode("MISSING_API_KEY"),
  );
  for (const [status, code] of [
    [429, "QUOTA_EXCEEDED"],
    [403, "INVALID_API_KEY"],
    [500, "SERVICE_ERROR"],
  ] as const)
    await assert.rejects(
      analyzeWithGemini(jpeg(), "test", undefined, async () =>
        Response.json({ secret: "do-not-echo" }, { status }),
      ),
      assertCode(code),
    );
  await assert.rejects(
    analyzeWithGemini(jpeg(), "test", undefined, async () =>
      Response.json(
        { error: { details: [{ reason: "API_KEY_INVALID" }] } },
        { status: 400 },
      ),
    ),
    assertCode("INVALID_API_KEY"),
  );
  await assert.rejects(
    analyzeWithGemini(
      jpeg(),
      "test",
      undefined,
      async () => new Response("<html>"),
    ),
    assertCode("INVALID_RESPONSE"),
  );
});
test("Gemini zaman aşımı: saat ilerletilerek test edilir, gerçek API kullanılmaz", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const result = analyzeWithGemini(
    jpeg(),
    "test",
    undefined,
    async (_, init) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("abort")),
          { once: true },
        ),
      ),
  );
  const check = assert.rejects(result, assertCode("TIMEOUT"));
  t.mock.timers.tick(35000);
  await check;
});
test("Edge Function başarı akışı ve atık bulunamaması gerçek API olmadan", async () => {
  for (const fixture of [valid, noWaste]) {
    const handler = createHandler(config, async () =>
      Response.json(payload(fixture)),
    );
    const response = await handler(request());
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result, fixture);
    assert.equal(
      response.headers.get("Access-Control-Allow-Origin"),
      "https://localhost",
    );
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});
test("Eksik sunucu anahtarı, kapalı hizmet, yanlış proje anahtarı ve origin Gemini'ye ulaşmaz", async () => {
  let calls = 0;
  const transport: typeof fetch = async () => {
    calls++;
    return Response.json(payload());
  };
  for (const [settings, headers, expected] of [
    [{ ...config, apiKey: "" }, {}, "MISSING_API_KEY"],
    [{ ...config, enabled: false }, {}, "SERVICE_DISABLED"],
    [config, { apikey: "wrong" }, "UNAUTHORIZED"],
    [config, { Origin: "https://evil.example" }, "ORIGIN_DENIED"],
  ] as const) {
    const response = await createHandler(
      settings,
      transport,
    )(request(jpeg(), headers));
    assert.equal((await response.json()).error.code, expected);
  }
  assert.equal(calls, 0);
});
test("Edge fotoğraf reddi, geçersiz yanıt ve kota cevabı kontrollü hata üretir", async () => {
  let calls = 0;
  const handler = createHandler(config, async () => {
    calls++;
    return Response.json(payload());
  });
  assert.equal(
    (await (await handler(request(new Uint8Array([1, 2])))).json()).error.code,
    "INVALID_PHOTO",
  );
  assert.equal(
    (
      await (
        await handler(
          request(jpeg(), { "Content-Length": String(MAX_ANALYSIS_BYTES + 1) }),
        )
      ).json()
    ).error.code,
    "INVALID_PHOTO",
  );
  assert.equal(calls, 0);
  for (const [transport, code, status] of [
    [
      async () => Response.json(payload({ ...valid, category: "bad" })),
      "INVALID_RESPONSE",
      502,
    ],
    [
      async () =>
        Response.json({ error: "secret-do-not-echo" }, { status: 429 }),
      "QUOTA_EXCEEDED",
      429,
    ],
  ] as const) {
    const response = await createHandler(config, transport)(request());
    assert.equal(response.status, status);
    const body = await response.text();
    assert.doesNotMatch(body, /secret-do-not-echo/);
    assert.equal(JSON.parse(body).error.code, code);
  }
});
test("CORS preflight anahtar istemez; GET desteklenmez", async () => {
  const handler = createHandler(config, goodTransport);
  assert.equal((await handler(request(jpeg(), {}, "OPTIONS"))).status, 204);
  assert.equal((await handler(request(jpeg(), {}, "GET"))).status, 405);
});
test("İstek sınırı ve eşzamanlılık sınırı; hata sonrası kaynak serbest bırakılır", async () => {
  let time = 0;
  const limiter = createLimiter(() => time);
  const release1 = limiter()("one");
  const release2 = limiter()("two");
  assert.throws(() => limiter()("three"), assertCode("RATE_LIMITED"));
  release1();
  release1();
  release2();
  limiter()("one")();
  limiter()("one")();
  assert.throws(() => limiter()("one"), assertCode("RATE_LIMITED"));
  time = 60000;
  limiter()("one")();
  const handler = createHandler(config, async () =>
    Response.json({ candidates: [] }),
  );
  for (let i = 0; i < 3; i++)
    assert.equal((await handler(request())).status, 502);
  assert.equal((await handler(request())).status, 429);
});
