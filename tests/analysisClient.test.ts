import { test } from "node:test";
import assert from "node:assert/strict";
import { requestAuthenticatedAnalysis } from "../src/services/analysisRequest.ts";
import type { AnalysisAuthPort } from "../src/services/analysisRequest.ts";
import { AnalysisError } from "../supabase/functions/_shared/analysis.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";
const RECORD = "44444444-4444-4444-8444-444444444444";
const valid = {
  success: true, wasteName: "Test plastik şişe", category: "Plastik",
  description: "Yalnız otomatik test örneği.", sortingInstruction: "Ayrı topla.",
  recyclingAdvice: "Yerel kuralları kontrol et.", safetyWarning: null,
  objectCount: "single", uncertain: false, hazardous: false,
};
const jpeg = () => new Blob([new Uint8Array([
  255, 216, 255, 192, 0, 11, 8, 0, 100, 0, 100, 1, 1, 17, 0,
  255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 0, 255, 217,
])], { type: "image/jpeg" });
const result = (persistence: unknown = { status: "saved", id: RECORD }) =>
  Response.json({ result: valid, persistence });
const code = (expected: string) => (reason: unknown) =>
  reason instanceof AnalysisError && reason.code === expected;
type Session = NonNullable<Awaited<ReturnType<AnalysisAuthPort["getSession"]>>["data"]["session"]>;
const session = (change: Partial<Session> = {}): Session => ({
  access_token: "unit-test-user-jwt-never-real", expires_at: 2000,
  user: { id: USER }, ...change,
});
function fixture() {
  let current: Session | null = session();
  let callback: ((event: string, current: Session | null) => void) | undefined;
  let unsubscribed = 0, calls = 0;
  const auth: AnalysisAuthPort = {
    async getSession() { return { data: { session: current }, error: null }; },
    onAuthStateChange(listener) {
      callback = listener;
      return { data: { subscription: { unsubscribe() { unsubscribed++; callback = undefined; } } } };
    },
  };
  const dependencies = {
    accessMode: "test" as "test" | "authenticated",
    auth: auth as AnalysisAuthPort | null,
    configuration: { url: "https://test-project.supabase.co", key: "test-public-key" } as { url: string; key: string } | null,
    online: true,
    nowSeconds: () => 1000,
    transport: (async () => { calls++; return result(); }) as typeof fetch,
  };
  return {
    dependencies, auth,
    setSession(value: Session | null) { current = value; },
    emit(event: string, value: Session | null) { current = value; callback?.(event, value); },
    get calls() { return calls; }, get unsubscribed() { return unsubscribed; },
    send(photo = jpeg(), signal = new AbortController().signal, token = " test-only-code ", id = REQUEST) {
      return requestAuthenticatedAnalysis(dependencies, photo, signal, token, id, USER);
    },
  };
}

test("Normal analiz istemcisi kod istemez ve test başlığı göndermez; JWT korunur", async () => {
  const f = fixture(); f.dependencies.accessMode = "authenticated";
  f.dependencies.transport = async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.has("x-analysis-test-token"),false);
    assert.equal(headers.get("Authorization"),"Bearer unit-test-user-jwt-never-real");
    return result();
  };
  assert.equal((await f.send(jpeg(),new AbortController().signal,"")).persistence.status,"saved");
});

test("Analiz istemcisi SDK JWT ve UUID başlıklarını gönderir; kullanıcı kimliği gövdeye yazılmaz", async () => {
  const f = fixture(), photo = jpeg(); let calls = 0;
  f.dependencies.transport = async (url, init) => {
    calls++;
    assert.equal(String(url), "https://test-project.supabase.co/functions/v1/analyze-waste");
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer unit-test-user-jwt-never-real");
    assert.equal(headers.get("apikey"), "test-public-key");
    assert.equal(headers.get("x-client-request-id"), REQUEST);
    assert.equal(headers.get("x-analysis-test-token"), "test-only-code");
    assert.equal(headers.get("Content-Type"), "image/jpeg");
    assert.ok(![...headers.values()].some(value => value.includes(USER)));
    assert.equal(init?.body, photo);
    return result();
  };
  const outcome = await f.send(photo);
  assert.equal(outcome.result.wasteName, valid.wasteName);
  assert.deepEqual(outcome.persistence, { status: "saved", id: RECORD });
  assert.equal(calls, 1); assert.equal(f.unsubscribed, 1);
});

test("Oturumsuz, süresi dolmuş, farklı kullanıcı ve anonim Auth oturumu analiz gönderemez", async () => {
  for (const current of [
    null, session({ expires_at: 999 }), session({ expires_at: undefined }),
    session({ expires_at: Number.POSITIVE_INFINITY }), session({ access_token: "" }),
    session({ user: { id: OTHER } }), session({ user: { id: USER, is_anonymous: true } }),
  ]) {
    const f = fixture(); f.setSession(current);
    await assert.rejects(f.send(), code("USER_UNAUTHORIZED"));
    assert.equal(f.calls, 0); assert.equal(f.unsubscribed, 1);
  }
});

test("SDK oturum hatası veya reddedilen oturum okuması ham ayrıntı göstermeden reddedilir", async () => {
  for (const rejected of [false, true]) {
    const f = fixture();
    f.auth.getSession = async () => {
      if (rejected) throw new Error("private-provider-detail");
      return { data: { session: session() }, error: { message: "private-provider-detail" } };
    };
    await assert.rejects(f.send(), reason => code("USER_UNAUTHORIZED")(reason) && !(reason as Error).message.includes("private-provider-detail"));
    assert.equal(f.calls, 0);
  }
});

test("Offline, eksik proje ve SDK, boş test kodu ve geçersiz UUID ağ isteği oluşturmaz", async () => {
  for (const [change, expected] of [
    [{ online: false }, "OFFLINE"], [{ configuration: null }, "NOT_CONFIGURED"],
    [{ auth: null }, "USER_UNAUTHORIZED"],
  ] as const) {
    const f = fixture(); Object.assign(f.dependencies, change);
    await assert.rejects(f.send(), code(expected)); assert.equal(f.calls, 0);
  }
  const f = fixture();
  await assert.rejects(f.send(jpeg(), new AbortController().signal, ""), code("TEST_ACCESS_REQUIRED"));
  await assert.rejects(f.send(jpeg(), new AbortController().signal, "code", "not-a-uuid"), code("INVALID_REQUEST_ID"));
  assert.equal(f.calls, 0);
});

test("JPEG türü, gerçek yapısı ve boyutu istemcide denetlenir", async () => {
  for (const photo of [
    new Blob([], { type: "image/jpeg" }), new Blob(["not-jpeg"], { type: "image/jpeg" }),
    new Blob(["png"], { type: "image/png" }),
    new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/jpeg" }),
  ]) {
    const f = fixture(); await assert.rejects(f.send(photo), code("INVALID_PHOTO"));
    assert.equal(f.calls, 0);
  }
});

test("Fotoğraf hazırlanırken çıkış veya hesap değişimi önceki kullanıcı adına istek göndermez", async () => {
  for (const event of ["SIGNED_OUT", "SIGNED_IN", "PASSWORD_RECOVERY"]) {
    const f = fixture(), photo = jpeg(), original = photo.arrayBuffer.bind(photo);
    photo.arrayBuffer = async () => {
      f.emit(event, event === "SIGNED_OUT" ? null : session({ user: { id: OTHER } }));
      return original();
    };
    await assert.rejects(f.send(photo), code("USER_UNAUTHORIZED"));
    assert.equal(f.calls, 0); assert.equal(f.unsubscribed, 1);
  }
});

test("Yanıt beklenirken çıkış, abortu yok sayan taşıyıcının sonucunu da engeller", async () => {
  const f = fixture(); let aborted = false;
  f.dependencies.transport = async (_, init) => {
    init?.signal?.addEventListener("abort", () => { aborted = true; });
    f.emit("SIGNED_OUT", null);
    return result();
  };
  await assert.rejects(f.send(), code("USER_UNAUTHORIZED"));
  assert.equal(aborted, true); assert.equal(f.unsubscribed, 1);
});

test("Yanıt sonrası sessiz hesap değişimi veya oturum süresi dolması sonucu gizler", async () => {
  for (const next of [session({ user: { id: OTHER } }), session({ expires_at: 999 })]) {
    const f = fixture(); let reads = 0;
    f.auth.getSession = async () => ({ data: { session: ++reads === 1 ? session() : next }, error: null });
    await assert.rejects(f.send(), code("USER_UNAUTHORIZED"));
    assert.equal(f.calls, 1); assert.equal(reads, 2);
  }
});

test("Aynı kullanıcının JWT yenilemesi analiz sonucunu yanlışlıkla iptal etmez", async () => {
  const f = fixture();
  f.dependencies.transport = async () => {
    f.emit("TOKEN_REFRESHED", session({ access_token: "another-test-token" }));
    return result();
  };
  assert.equal((await f.send()).result.success, true);
});

test("Fotoğraf/ekran iptali ağ isteğini durdurur ve aboneliği temizler", async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(f.send(jpeg(), controller.signal), code("CANCELLED"));
  assert.equal(f.calls, 0); assert.equal(f.unsubscribed, 1);
  const next = fixture(), pending = new AbortController();
  next.dependencies.transport = async (_, init) => {
    pending.abort(); assert.equal(init?.signal?.aborted, true); return result();
  };
  await assert.rejects(next.send(jpeg(), pending.signal), code("CANCELLED"));
  assert.equal(next.unsubscribed, 1);
});

test("Kayıt hatası başarılı AI sonucunu silmez; kullanıcıya bağımsız durum döner", async () => {
  const f = fixture(); f.dependencies.transport = async () => result({ status: "failed" });
  const outcome = await f.send();
  assert.equal(outcome.result.success, true); assert.deepEqual(outcome.persistence, { status: "failed" });
});

test("Bozuk kayıt metaverisi kaydedildi sayılmaz ve doğrulanmış analiz korunur", async () => {
  for (const persistence of [undefined, null, { status: "saved", id: "invalid" }, { status: "unknown" }, { status: "saved", id: RECORD, token: "private" }]) {
    const f = fixture(); f.dependencies.transport = async () => Response.json({ result: valid, persistence });
    const outcome = await f.send();
    assert.equal(outcome.result.wasteName, valid.wasteName);
    assert.deepEqual(outcome.persistence, { status: "failed" });
  }
});

test("İstemci güvenlik kuralları kayıt durumundan bağımsız korunur", async () => {
  const f = fixture();
  f.dependencies.transport = async () => Response.json({ result: { ...valid, category: "Pil", safetyWarning: null }, persistence: { status: "failed" } });
  const outcome = await f.send();
  assert.equal(outcome.result.hazardous, true);
  assert.match(outcome.result.safetyWarning ?? "", /Sökme, delme/);
  assert.deepEqual(outcome.persistence, { status: "failed" });
});

test("Edge hata kodları güvenli Türkçe hataya çevrilir ve geçersiz JSON reddedilir", async () => {
  for (const [status, body, expected] of [
    [401, { error: { code: "USER_UNAUTHORIZED", message: "private-detail" } }, "USER_UNAUTHORIZED"],
    [503, { error: { code: "SERVICE_DISABLED" } }, "SERVICE_DISABLED"],
    [429, { error: { code: "RATE_LIMITED" } }, "RATE_LIMITED"],
  ] as const) {
    const f = fixture(); f.dependencies.transport = async () => Response.json(body, { status });
    await assert.rejects(f.send(), reason => code(expected)(reason) && !(reason as Error).message.includes("private-detail"));
  }
  const f = fixture(); f.dependencies.transport = async () => new Response("invalid-json");
  await assert.rejects(f.send(), code("INVALID_RESPONSE"));
});
