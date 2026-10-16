import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHandler,
  type ServerConfig,
} from "../supabase/functions/analyze-waste/handler.ts";
import type { AnalysisStore, StoredAnalysis } from "../supabase/functions/analyze-waste/storage.ts";
import type { WasteAnalysis } from "../supabase/functions/_shared/analysis.ts";

// All responses in this file are isolated fixtures. No Auth, database or Gemini
// network request, real e-mail, JWT or user account is used.
const userA = "00000000-0000-4000-8000-000000000001";
const userB = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";
const analysisIdA = "00000000-0000-4000-8000-000000000004";
const analysisIdB = "00000000-0000-4000-8000-000000000005";
const bearerA = "testHeader.testUserA.testSignature";
const bearerB = "testHeader.testUserB.testSignature";
const testCode = "unit-only-private-test-code-with-32-characters";
const now = Date.parse("2026-10-16T10:00:00Z");
const configuration: ServerConfig = {
  enabled: true,
  apiKey: "unit-gemini-key",
  publicKeys: ["unit-public-key"],
  allowedOrigins: ["http://localhost:5173"],
  testToken: testCode,
  testExpiresAt: new Date(now + 10 * 60_000).toISOString(),
  supabaseUrl: "https://nyoxbwandadakfagoner.supabase.co",
  serviceRoleKey: "unit-server-only-key",
};
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
const noWaste: WasteAnalysis = {
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
function jpeg(): Uint8Array {
  return new Uint8Array([
    255, 216, 255, 192, 0, 11, 8, 3, 32, 6, 64, 1, 1, 17, 0,
    255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 0, 255, 217,
  ]);
}
function incoming(
  changes: Record<string, string | null> = {},
  body: BodyInit = jpeg().slice().buffer,
  signal?: AbortSignal,
): Request {
  const headers = new Headers({
    apikey: "unit-public-key",
    authorization: `Bearer ${bearerA}`,
    origin: "http://localhost:5173",
    "content-type": "image/jpeg",
    "x-analysis-test-token": testCode,
    "x-client-request-id": requestId,
  });
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) headers.delete(key);
    else headers.set(key, value);
  }
  return new Request(`${configuration.supabaseUrl}/functions/v1/analyze-waste`, {
    method: "POST", headers, body, signal,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}
function payload(result: unknown) {
  return {
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(result) }] } }],
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}
interface HarnessOptions {
  config?: Partial<ServerConfig>;
  authResponse?: (request: RequestInit | undefined) => Promise<Response>;
  geminiResponse?: () => Promise<Response>;
  result?: unknown;
  findError?: boolean;
  saveError?: boolean;
  existing?: StoredAnalysis;
}
function harness(options: HarnessOptions = {}) {
  const calls = { auth: 0, gemini: 0, find: 0, save: 0 };
  const owners: string[] = [];
  const savedResults: WasteAnalysis[] = [];
  const store: AnalysisStore = {
    async find(verifiedUserId, clientRequestId) {
      calls.find++;
      assert.equal(clientRequestId, requestId);
      assert.ok([userA, userB].includes(verifiedUserId));
      if (options.findError) throw new Error("private database detail");
      return options.existing ?? null;
    },
    async save(verifiedUserId, clientRequestId, result, model) {
      calls.save++;
      assert.equal(clientRequestId, requestId);
      owners.push(verifiedUserId);
      savedResults.push(result);
      if (options.saveError) throw new Error("private database detail");
      return {
        id: verifiedUserId === userB ? analysisIdB : analysisIdA,
        result, model, schemaVersion: 1, status: "saved",
      };
    },
  };
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === configuration.supabaseUrl && url.pathname === "/auth/v1/user") {
      calls.auth++;
      if (options.authResponse) return options.authResponse(init);
      const bearer = new Headers(init?.headers).get("authorization");
      return Response.json({ id: bearer === `Bearer ${bearerB}` ? userB : userA, role: "authenticated" });
    }
    if (url.origin === "https://generativelanguage.googleapis.com") {
      calls.gemini++;
      return options.geminiResponse
        ? options.geminiResponse()
        : Response.json(payload(options.result ?? valid));
    }
    assert.fail("Unexpected network destination in isolated handler test");
  };
  return {
    calls, owners, savedResults,
    handler: createHandler({ ...configuration, ...options.config }, transport, () => now, { store }),
  };
}
async function errorCode(response: Response): Promise<string> {
  return (await response.json()).error.code;
}

test("Handler: geçerli JWT doğrulanır, başarılı Gemini sonucu doğrulanmış kullanıcıya kaydedilir", async () => {
  const run = harness();
  const response = await run.handler(incoming());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    result: valid, persistence: { status: "saved", id: analysisIdA },
  });
  assert.deepEqual(run.calls, { auth: 1, gemini: 1, find: 1, save: 1 });
  assert.deepEqual(run.owners, [userA]);
});

test("Handler: eksik veya bozuk JWT HTTP401 döndürür, Gemini ve depo çağrılmaz", async () => {
  for (const authorization of [null, "Bearer malformed", "Bearer one.two", "Basic unit"]) {
    const run = harness();
    const response = await run.handler(incoming({ authorization }));
    assert.equal(response.status, 401);
    assert.equal(await errorCode(response), "USER_UNAUTHORIZED");
    assert.deepEqual(run.calls, { auth: 0, gemini: 0, find: 0, save: 0 });
  }
});

test("Handler: süresi dolmuş veya yanlış imzalı JWT Auth tarafından reddedilince HTTP401 döner", async () => {
  for (const detail of ["JWT expired", "invalid signature"]) {
    const run = harness({ authResponse: async () => Response.json({ msg: detail }, { status: 401 }) });
    const response = await run.handler(incoming());
    assert.equal(response.status, 401);
    assert.equal(await errorCode(response), "USER_UNAUTHORIZED");
    assert.deepEqual(run.calls, { auth: 1, gemini: 0, find: 0, save: 0 });
  }
});

test("Handler: Auth kesintisinde fail-closed HTTP503, Gemini veya kayıt isteği yok", async () => {
  const run = harness({ authResponse: async () => Response.json({}, { status: 503 }) });
  const response = await run.handler(incoming());
  assert.equal(response.status, 503);
  assert.equal(await errorCode(response), "AUTH_UNAVAILABLE");
  assert.deepEqual(run.calls, { auth: 1, gemini: 0, find: 0, save: 0 });
});

test("Handler: kullanıcı taklidi başlıkları kayıt sahipliğini değiştiremez", async () => {
  const run = harness();
  const response = await run.handler(incoming({ "x-user-id": userB, user_id: userB }));
  assert.equal(response.status, 200);
  assert.deepEqual(run.owners, [userA]);
});

test("Handler: değiştirilmiş kullanıcı/analiz JSON'u fotoğraf veya kayıt olarak kabul edilmez", async () => {
  const run = harness();
  const response = await run.handler(incoming({ "content-type": "application/json" },
    JSON.stringify({ user_id: userB, result: valid })));
  assert.equal(response.status, 400);
  assert.equal(await errorCode(response), "INVALID_PHOTO");
  assert.equal(run.calls.gemini, 0);
  assert.equal(run.calls.save, 0);
});

test("Handler: atık bulunmayan sonuç görüntülenebilir fakat kaydedilmez", async () => {
  const run = harness({ result: noWaste });
  const response = await run.handler(incoming());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result: noWaste, persistence: { status: "not_saved" } });
  assert.equal(run.calls.save, 0);
});

test("Handler: başarısız Gemini HTTP yanıtları hiçbir analiz kaydı oluşturmaz", async () => {
  for (const [upstreamStatus, expectedStatus, code] of [
    [500, 502, "SERVICE_ERROR"], [429, 429, "QUOTA_EXCEEDED"], [403, 502, "INVALID_API_KEY"],
  ] as const) {
    const run = harness({ geminiResponse: async () => Response.json({}, { status: upstreamStatus }) });
    const response = await run.handler(incoming());
    assert.equal(response.status, expectedStatus);
    assert.equal(await errorCode(response), code);
    assert.equal(run.calls.save, 0);
  }
});

test("Handler: geçersiz kategori veya eksik Gemini JSON alanı kaydedilmez", async () => {
  for (const result of [{ ...valid, category: "Unknown" }, { ...valid, description: undefined }]) {
    const run = harness({ result });
    const response = await run.handler(incoming());
    assert.equal(response.status, 502);
    assert.equal(await errorCode(response), "INVALID_RESPONSE");
    assert.equal(run.calls.save, 0);
  }
});

test("Handler: bozuk Gemini JSON metni başarı veya kayıt olarak raporlanmaz", async () => {
  const run = harness({ geminiResponse: async () => Response.json({
    candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not-json" }] } }],
  }) });
  const response = await run.handler(incoming());
  assert.equal(response.status, 502);
  assert.equal(await errorCode(response), "INVALID_RESPONSE");
  assert.equal(run.calls.save, 0);
});

test("Handler: kayıt hatası başarılı analiz sonucunu gizlemez ve kayıt başarılı denmez", async () => {
  const run = harness({ saveError: true });
  const response = await run.handler(incoming());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result: valid, persistence: { status: "failed" } });
  assert.equal(run.calls.save, 1);
});

test("Handler: DB bağlantı kesintisinde doğrulanmış analiz sonucu ve failed kayıt durumu korunur", async () => {
  const run = harness({ findError: true, saveError: true });
  const response = await run.handler(incoming());
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { result: valid, persistence: { status: "failed" } });
  assert.doesNotMatch(text, /private database|unit-server-only|unit-gemini/);
});

test("Handler: geçici duplicate arama hatası daha sonra başarılı kaydı engellemez", async () => {
  const run = harness({ findError: true });
  const response = await run.handler(incoming());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).persistence.status, "saved");
  assert.equal(run.calls.save, 1);
});

test("Handler: aynı istek kimliğinin özgün kaydı varsa Gemini tekrar çağrılmaz", async () => {
  const original = { ...valid, wasteName: "Önceki kayıt" };
  const run = harness({ existing: { id: analysisIdA, result: original, model: "gemini-original", schemaVersion: 1 } });
  const response = await run.handler(incoming());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    result: original, persistence: { status: "duplicate", id: analysisIdA },
  });
  assert.equal(run.calls.gemini, 0);
  assert.equal(run.calls.save, 0);
});

test("Handler: aynı kullanıcı ve istek için eşzamanlı çift gönderim tek Gemini/kayıt işlemini paylaşır", async () => {
  const started = deferred();
  const finish = deferred();
  const run = harness({ geminiResponse: async () => {
    started.resolve();
    await finish.promise;
    return Response.json(payload(valid));
  } });
  const first = run.handler(incoming());
  await started.promise;
  const secondBodyRead = deferred();
  const secondBody = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(jpeg());
      controller.close();
      secondBodyRead.resolve();
    },
  }, { highWaterMark: 0 });
  const second = run.handler(incoming({}, secondBody));
  await secondBodyRead.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  finish.resolve();
  const responses = await Promise.all([first, second]);
  for (const response of responses) assert.equal(response.status, 200);
  const results = await Promise.all(responses.map((response) => response.json()));
  assert.deepEqual(results.map((outcome) => outcome.persistence.status).sort(), ["duplicate", "saved"]);
  assert.deepEqual(results.map((outcome) => outcome.result), [valid, valid]);
  assert.equal(run.calls.gemini, 1);
  assert.equal(run.calls.save, 1);
});

test("Handler: farklı kullanıcıların aynı client_request_id değeri farklı sahipliklerle işlenir", async () => {
  const run = harness();
  const one = await run.handler(incoming());
  const two = await run.handler(incoming({ authorization: `Bearer ${bearerB}` }));
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  assert.deepEqual(run.owners, [userA, userB]);
  assert.equal((await one.json()).persistence.id, analysisIdA);
  assert.equal((await two.json()).persistence.id, analysisIdB);
  assert.equal(run.calls.gemini, 2);
});

test("Handler: eksik veya geçersiz istek kimliği HTTP400; Gemini ve kayıt çağrılmaz", async () => {
  for (const id of [null, "invalid", `${requestId}&user_id=${userB}`]) {
    const run = harness();
    const response = await run.handler(incoming({ "x-client-request-id": id }));
    assert.equal(response.status, 400);
    assert.equal(await errorCode(response), "INVALID_REQUEST_ID");
    assert.equal(run.calls.gemini, 0);
    assert.equal(run.calls.save, 0);
  }
});

test("Handler: analiz kapalıyken JWT yoksa da HTTP503 ve hiçbir alt servis isteği yok", async () => {
  const run = harness({ config: { enabled: false } });
  const response = await run.handler(incoming({ authorization: null }));
  assert.equal(response.status, 503);
  assert.equal(await errorCode(response), "SERVICE_DISABLED");
  assert.deepEqual(run.calls, { auth: 0, gemini: 0, find: 0, save: 0 });
});

test("Handler: süreli test kodu veya public anahtar olmadan JWT alt servise taşınmaz", async () => {
  for (const changes of [
    { "x-analysis-test-token": null }, { "x-analysis-test-token": "wrong" }, { apikey: "wrong" },
  ]) {
    const run = harness();
    const response = await run.handler(incoming(changes));
    assert.equal(response.status, 403);
    assert.deepEqual(run.calls, { auth: 0, gemini: 0, find: 0, save: 0 });
  }
});

test("Handler: test süresi dolduğunda veya origin izinsizse Auth/Gemini/kayıt çağrılmaz", async () => {
  const expired = harness({ config: { testExpiresAt: new Date(now - 1).toISOString() } });
  const deniedOrigin = harness();
  for (const [run, request, expectedStatus] of [
    [expired, incoming(), 503], [deniedOrigin, incoming({ origin: "https://other.example" }), 403],
  ] as const) {
    const response = await run.handler(request);
    assert.equal(response.status, expectedStatus);
    assert.deepEqual(run.calls, { auth: 0, gemini: 0, find: 0, save: 0 });
  }
});

test("Handler: varsayılan eksik proje yapılandırması Auth/Gemini erişimini kapalı tutar", async () => {
  const run = harness({ config: { supabaseUrl: undefined } });
  const response = await run.handler(incoming());
  assert.equal(response.status, 503);
  assert.equal(await errorCode(response), "AUTH_UNAVAILABLE");
  assert.deepEqual(run.calls, { auth: 0, gemini: 0, find: 0, save: 0 });
});

test("Handler: iki aktif Auth doğrulaması varken üçüncü istek doğrulamaya gitmeden sınırlanır", async () => {
  const started = deferred();
  const finish = deferred();
  let pending = 0;
  const run = harness({ authResponse: async () => {
    pending++;
    if (pending === 2) started.resolve();
    if (pending <= 2) await finish.promise;
    return Response.json({ id: userA, role: "authenticated" });
  } });
  const first = run.handler(incoming());
  const second = run.handler(incoming());
  await started.promise;
  let third: Response;
  try {
    third = await run.handler(incoming());
  } finally {
    finish.resolve();
  }
  await Promise.all([first, second]);
  assert.equal(third.status, 429);
  assert.equal(await errorCode(third), "RATE_LIMITED");
  assert.equal(run.calls.auth, 2);
});

test("Handler: iptal edilen isteğin doğrulaması başarısız olur ve yeni kayıt başlamaz", async () => {
  const controller = new AbortController();
  controller.abort();
  const run = harness();
  const response = await run.handler(incoming({}, jpeg().slice().buffer, controller.signal));
  assert.equal(response.status, 503);
  assert.equal(await errorCode(response), "AUTH_UNAVAILABLE");
  assert.deepEqual(run.calls, { auth: 0, gemini: 0, find: 0, save: 0 });
});
