import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnalysisQuota, type Admission } from "../supabase/functions/analyze-waste/quota.ts";
import { createHandler } from "../supabase/functions/analyze-waste/handler.ts";
import { AnalysisError, type WasteAnalysis } from "../supabase/functions/_shared/analysis.ts";
import { createUserAnalysisDeadline } from "../supabase/functions/analyze-waste/deadline.ts";

const user = "a1000000-0000-4000-8000-000000000001";
const requestId = "a1000000-0000-4000-8000-000000000002";
const leaseId = "a1000000-0000-4000-8000-000000000003";
const config = { supabaseUrl: "https://nyoxbwandadakfagoner.supabase.co", serviceRoleKey: "unit-only-server-key" };
const bytes = new Uint8Array([255,216,255,192,0,11,8,0,100,0,100,1,1,17,0,255,218,0,8,1,1,0,0,63,0,0,255,217]);
const result: WasteAnalysis = {
  success: true, wasteName: "Test şişesi", category: "Plastik", description: "Sentetik test.",
  sortingInstruction: "Ayrı topla.", recyclingAdvice: "Yerel kuralları doğrula.",
  safetyWarning: null, objectCount: "single", uncertain: false, hazardous: false,
};
const isError = (code: string) => (error: unknown) => error instanceof AnalysisError && error.code === code;

test("Normal istek süresi 90 saniyede kapanır; süreli pilot penceresini değiştirmez", () => {
  let time = Date.parse("2026-10-17T08:00:00Z");
  const deadline = createUserAnalysisDeadline(() => time);
  try {
    time += 89_999; deadline.assertOpen();
    time++; assert.throws(() => deadline.assertOpen(), isError("SERVICE_DISABLED"));
  } finally { deadline.dispose(); }
});

test("Kota RPC yalnız hedef proje ve server anahtarıyla kullanıcı/istek/özet gönderir", async () => {
  let called = 0;
  const quota = createAnalysisQuota(config, async (url, init) => {
    called++;
    assert.equal(String(url), `${config.supabaseUrl}/rest/v1/rpc/reserve_analysis_request`);
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${config.serviceRoleKey}`);
    assert.equal(init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(init?.body)), { p_user_id: user, p_request_id: requestId, p_digest: "a".repeat(64) });
    return Response.json({ status: "admitted", leaseId });
  });
  assert.deepEqual(await quota.reserve(user, requestId, "a".repeat(64)), { status: "admitted", leaseId });
  assert.equal(called, 1);
});
for (const value of [null, [], {}, { status: "admitted" }, { status: "admitted", leaseId: "bad" },
  { status: "limited", quota: 999 }, { status: "unknown" }]) {
  test(`Geçersiz kota RPC yanıtı kapalı kalır: ${JSON.stringify(value)}`, async () => {
    const quota = createAnalysisQuota(config, async () => Response.json(value));
    await assert.rejects(quota.reserve(user, requestId, "a".repeat(64)), isError("QUOTA_UNAVAILABLE"));
  });
}
for (const status of ["duplicate", "limited", "conflict"] as const) {
  test(`Kota RPC ${status} sonucunu doğrular`, async () => {
    const quota = createAnalysisQuota(config, async () => Response.json({ status }));
    assert.deepEqual(await quota.reserve(user, requestId, "a".repeat(64)), { status });
  });
}
test("Kota altyapısı HTTP hatasında Gemini'ye izin vermez", async () => {
  const quota = createAnalysisQuota(config, async () => new Response("private failure", { status: 500 }));
  await assert.rejects(quota.reserve(user, requestId, "a".repeat(64)), isError("QUOTA_UNAVAILABLE"));
});
test("Kota başka Supabase projesine yönlendirilemez", () => {
  assert.throws(() => createAnalysisQuota({ ...config, supabaseUrl: "https://other.supabase.co" }), isError("QUOTA_UNAVAILABLE"));
});
test("Kota geçersiz kimlik veya fotoğraf özetini ağ isteğinden önce reddeder", async () => {
  const quota = createAnalysisQuota(config, async () => { throw Error("must not fetch"); });
  await assert.rejects(quota.reserve("bad", requestId, "a".repeat(64)), isError("INVALID_REQUEST_ID"));
  await assert.rejects(quota.reserve(user, requestId, "bad"), isError("INVALID_REQUEST_ID"));
});

function fixture(admission: Admission = { status: "admitted", leaseId }, options: {
  existing?: boolean; reserveFails?: boolean; finishFails?: boolean; providerFails?: boolean;
  saveFails?: boolean; authenticated?: boolean; enabled?: boolean;
} = {}) {
  const calls = { reserve: 0, finish: 0, analyze: 0, save: 0, auth: 0 };
  const handler = createHandler({ ...config, apiKey: "unit-key", publicKeys: ["unit-public"],
    allowedOrigins: ["http://localhost:5173"], enabled: options.enabled ?? true,
    accessMode: options.authenticated === false ? "test" : "authenticated",
  }, async () => { throw Error("No real network allowed"); }, Date.now, {
    verifyUser: async () => { calls.auth++; return { id: user }; },
    quota: {
      async reserve(owner, id, digest) {
        calls.reserve++; assert.equal(owner, user); assert.equal(id, requestId);
        assert.match(digest, /^[a-f0-9]{64}$/);
        if (options.reserveFails) throw new AnalysisError("QUOTA_UNAVAILABLE");
        return admission;
      },
      async finish(owner, id, lease) {
        calls.finish++; assert.equal(owner,user); assert.equal(id,requestId); assert.equal(lease,leaseId);
        if (options.finishFails) throw Error("private finish error");
      },
    },
    store: {
      async find() { return options.existing ? { id: leaseId, result, model: "unit-model", schemaVersion: 1 } : null; },
      async save() { calls.save++; if (options.saveFails) throw Error(); return { id: leaseId, result, model: "unit-model", schemaVersion: 1, status: "saved" }; },
    },
    analyze: async () => { calls.analyze++; if (options.providerFails) throw new AnalysisError("SERVICE_ERROR"); return result; },
  });
  const send = (headers: Record<string,string> = {}) => handler(new Request(`${config.supabaseUrl}/functions/v1/analyze-waste`, {
    method: "POST", headers: { apikey: "unit-public", authorization: "Bearer unit-user-jwt", origin: "http://localhost:5173",
      "content-type": "image/jpeg", "x-client-request-id": requestId, ...headers }, body: bytes.slice().buffer,
  }));
  return { send, calls };
}
test("Normal kullanıcı kod olmadan JWT/kota sonrası analiz ve kayıt yapar", async () => {
  const f = fixture(); const response = await f.send();
  assert.equal(response.status,200); assert.equal((await response.json()).persistence.status,"saved");
  assert.deepEqual(f.calls,{ reserve:1,finish:1,analyze:1,save:1,auth:1 });
});
for (const [status, expected] of [["limited",429],["conflict",400],["duplicate",409]] as const) {
  test(`Normal akış ${status} durumunda ücretli çağrı yapmaz`, async () => {
    const f = fixture({ status }); assert.equal((await f.send()).status,expected);
    assert.equal(f.calls.analyze,0); assert.equal(f.calls.save,0); assert.equal(f.calls.finish,0);
  });
}
test("Kalıcı duplicate kendi kaydını döndürür; Gemini tekrar çağrılmaz", async () => {
  const f = fixture({ status:"duplicate" },{ existing:true });
  const response = await f.send(); assert.equal(response.status,200);
  assert.equal((await response.json()).persistence.status,"duplicate"); assert.equal(f.calls.analyze,0);
});
test("Kalıcı kota arızasında istek kapalı kalır", async () => {
  const f = fixture(undefined,{ reserveFails:true }); assert.equal((await f.send()).status,503); assert.equal(f.calls.analyze,0);
});
test("Gemini hatası da lease'i bırakır; uygulama otomatik tekrar yapmaz", async () => {
  const f = fixture(undefined,{ providerFails:true }); assert.equal((await f.send()).status,502);
  assert.equal(f.calls.finish,1); assert.equal(f.calls.analyze,1); assert.equal(f.calls.save,0);
});
test("Kayıt hatası geçerli analizden ayrı döner ve lease bırakılır", async () => {
  const f = fixture(undefined,{ saveFails:true }); const response = await f.send();
  assert.equal(response.status,200); assert.equal((await response.json()).persistence.status,"failed"); assert.equal(f.calls.finish,1);
});
test("Finish hatası sonucu bozmaz, kota iadesi veya tekrar çağrı oluşturmaz", async () => {
  const f = fixture(undefined,{ finishFails:true }); assert.equal((await f.send()).status,200);
  assert.equal(f.calls.analyze,1); assert.equal(f.calls.finish,1);
});
test("Varsayılan test modu süresi olmadan normal akışa düşmez", async () => {
  const f = fixture(undefined,{ authenticated:false }); assert.equal((await f.send()).status,503);
  assert.equal(f.calls.analyze,0); assert.equal(f.calls.auth,0);
});
test("Kapalı normal servis ve kötü origin kota veya Gemini çağırmaz", async () => {
  const f = fixture(undefined,{ enabled:false }); assert.equal((await f.send()).status,503);
  assert.equal((await f.send({ origin:"https://evil.invalid" })).status,403);
  assert.equal(f.calls.reserve,0); assert.equal(f.calls.analyze,0);
});
