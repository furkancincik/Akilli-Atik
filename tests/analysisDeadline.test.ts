import { test } from "node:test";
import assert from "node:assert/strict";
import { AnalysisError, type WasteAnalysis } from "../supabase/functions/_shared/analysis.ts";
import { createAnalysisDeadline, MAX_ANALYSIS_WINDOW_MS } from "../supabase/functions/analyze-waste/deadline.ts";
import { analyzeWithGemini } from "../supabase/functions/analyze-waste/gemini.ts";
import { createHandler, type HandlerDependencies, type ServerConfig } from "../supabase/functions/analyze-waste/handler.ts";

// Local synthetic fixtures only. No real account, photo, token or network call.
const base = Date.parse("2026-10-16T12:00:00Z");
const owner = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";
const rowId = "00000000-0000-4000-8000-000000000003";
const token = "unit-only-deadline-code-at-least-32-characters";
const valid: WasteAnalysis = {
  success: true, wasteName: "Plastik şişe", category: "Plastik",
  description: "Boş plastik şişe.", sortingInstruction: "Ayrı topla.",
  recyclingAdvice: "Yerel kabul kurallarını doğrula.", safetyWarning: null,
  objectCount: "single", uncertain: false, hazardous: false,
};
const jpeg = () => new Uint8Array([
  255, 216, 255, 192, 0, 11, 8, 3, 32, 6, 64, 1, 1, 17, 0,
  255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 0, 255, 217,
]);
const payload = () => ({
  candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(valid) }] } }],
});
const disabled = (reason: unknown) => reason instanceof AnalysisError && reason.code === "SERVICE_DISABLED";
function incoming() {
  return new Request("https://nyoxbwandadakfagoner.supabase.co/functions/v1/analyze-waste", {
    method: "POST",
    headers: {
      apikey: "unit-public-key", authorization: "Bearer unit.jwt.fixture",
      "content-type": "image/jpeg", "x-analysis-test-token": token,
      "x-client-request-id": requestId, origin: "http://localhost:5173",
    },
    body: jpeg().buffer,
  });
}
function harness(options: {
  expiresAt?: string;
  verify?: () => Promise<Readonly<{ id: string }>>;
  find?: () => Promise<null>;
  analyze?: HandlerDependencies["analyze"];
  save?: () => Promise<void>;
  transport?: typeof fetch;
} = {}) {
  let time = base;
  const calls = { auth: 0, lookup: 0, gemini: 0, save: 0 };
  const config: ServerConfig = {
    enabled: true, apiKey: "unit-provider-key", publicKeys: ["unit-public-key"],
    allowedOrigins: ["http://localhost:5173"], testToken: token,
    testExpiresAt: options.expiresAt ?? new Date(base + 1_000).toISOString(),
  };
  const dependencies: HandlerDependencies = {
    async verifyUser() {
      calls.auth++;
      return options.verify ? options.verify() : { id: owner };
    },
    store: {
      async find() {
        calls.lookup++;
        return options.find ? options.find() : null;
      },
      async save(_user, _request, result, model) {
        calls.save++;
        await options.save?.();
        return { id: rowId, result, model, schemaVersion: 1, status: "saved" };
      },
    },
    ...(options.analyze ? { analyze: options.analyze } : {}),
  };
  const transport: typeof fetch = async (input, init) => {
    calls.gemini++;
    return options.transport ? options.transport(input, init) : Response.json(payload());
  };
  return {
    calls,
    expire() { time = base + 1_000; },
    handler: createHandler(config, transport, () => time, dependencies),
  };
}
async function assertDisabled(response: Response) {
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "SERVICE_DISABLED");
}

test("Kesin test süresi: eksik, geçersiz, geçmiş ve on dakikadan uzun pencere kapalıdır", () => {
  for (const expiry of [undefined, "invalid", new Date(base).toISOString(),
    new Date(base - 1).toISOString(), new Date(base + MAX_ANALYSIS_WINDOW_MS + 1).toISOString()])
    assert.throws(() => createAnalysisDeadline(expiry, () => base), disabled);
  const deadline = createAnalysisDeadline(new Date(base + MAX_ANALYSIS_WINDOW_MS).toISOString(), () => base);
  assert.doesNotThrow(deadline.assertOpen);
  deadline.dispose();
});

test("Kesin test süresi: yerel zaman ilerlediğinde ve isolate yeniden kurulduğunda kapalı kalır", () => {
  let time = base;
  const expiry = new Date(base + 1_000).toISOString();
  const deadline = createAnalysisDeadline(expiry, () => time);
  time += 1_000;
  assert.throws(deadline.assertOpen, disabled);
  assert.throws(() => createAnalysisDeadline(expiry, () => time), disabled);
  deadline.dispose();
});

test("Kesin test süresi: tamamlanan isteğin zamanlayıcısı temizlenir", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const deadline = createAnalysisDeadline(new Date(base + 1_000).toISOString(), () => base);
  deadline.dispose();
  t.mock.timers.tick(1_000);
  assert.equal(deadline.signal.aborted, false);
});

test("Handler: geçersiz veya on dakikayı aşan pencere hiçbir alt servise gitmeden HTTP503 verir", async () => {
  for (const expiresAt of ["", "invalid", new Date(base).toISOString(),
    new Date(base + MAX_ANALYSIS_WINDOW_MS + 1).toISOString()]) {
    const run = harness({ expiresAt });
    await assertDisabled(await run.handler(incoming()));
    assert.deepEqual(run.calls, { auth: 0, lookup: 0, gemini: 0, save: 0 });
  }
});

test("Handler: Auth sırasında süre biterse kayıt arama, Gemini ve INSERT başlamaz", async () => {
  const run = harness({ verify: async () => { run.expire(); return { id: owner }; } });
  await assertDisabled(await run.handler(incoming()));
  assert.deepEqual(run.calls, { auth: 1, lookup: 0, gemini: 0, save: 0 });
});

test("Handler: kayıt arama sırasında süre biterse Gemini ve INSERT başlamaz", async () => {
  for (const lookupFails of [false, true]) {
    const run = harness({ find: async () => {
      run.expire();
      if (lookupFails) throw new Error("isolated lookup failure");
      return null;
    } });
    await assertDisabled(await run.handler(incoming()));
    assert.deepEqual(run.calls, { auth: 1, lookup: 1, gemini: 0, save: 0 });
  }
});

test("Handler: geçerli Gemini sonucundan sonra süre biterse INSERT başlamaz ve failed durumu üretilmez", async () => {
  const run = harness({ analyze: async () => { run.expire(); return valid; } });
  await assertDisabled(await run.handler(incoming()));
  assert.equal(run.calls.save, 0);
});

test("Handler: başlamış kayıt işlemi geç dönerse veya hata verirse süre sonu yutulmaz", async () => {
  for (const saveFails of [false, true]) {
    const run = harness({ save: async () => {
      run.expire();
      if (saveFails) throw new Error("isolated save failure");
    } });
    await assertDisabled(await run.handler(incoming()));
    assert.equal(run.calls.save, 1);
    // Already dispatched database work cannot be rolled back by this guard.
  }
});

test("Gemini: kesin süre sonu isteği iptal eder ve sağlayıcı zaman aşımından farklı kapalı durum verir", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const deadline = createAnalysisDeadline(new Date(base + 1_000).toISOString(), () => base);
  let providerSignal: AbortSignal | null | undefined;
  const result = analyzeWithGemini(jpeg(), "unit-key", undefined, async (_url, init) => {
    providerSignal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("synthetic abort")), { once: true });
    });
  }, deadline);
  const check = assert.rejects(result, disabled);
  t.mock.timers.tick(1_000);
  await check;
  assert.equal(providerSignal?.aborted, true);
  deadline.dispose();
});

test("Gemini: erken tamamlanmada süre dinleyicisi temizlenir", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const deadline = createAnalysisDeadline(new Date(base + 1_000).toISOString(), () => base);
  const remove = t.mock.method(deadline.signal, "removeEventListener");
  let providerSignal: AbortSignal | null | undefined;
  const result = await analyzeWithGemini(jpeg(), "unit-key", undefined, async (_url, init) => {
    providerSignal = init?.signal;
    return Response.json(payload());
  }, deadline);
  assert.deepEqual(result, valid);
  assert.ok(remove.mock.calls.some((call) => call.arguments[0] === "abort"));
  t.mock.timers.tick(35_000);
  assert.equal(deadline.signal.aborted, true);
  assert.equal(providerSignal?.aborted, false);
  deadline.dispose();
});

test("Handler: Gemini çalışırken kesin süre biterse HTTP503 döner ve INSERT yapılmaz", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let started!: () => void;
  const pending = new Promise<void>((resolve) => { started = resolve; });
  const run = harness({ transport: async (_url, init) => {
    started();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("synthetic abort")), { once: true });
    });
  } });
  const response = run.handler(incoming());
  await pending;
  t.mock.timers.tick(1_000);
  await assertDisabled(await response);
  assert.equal(run.calls.gemini, 1);
  assert.equal(run.calls.save, 0);
});
