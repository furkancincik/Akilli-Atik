import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHistoryDataService,
  HISTORY_COLUMNS,
  HISTORY_PAGE_SIZE,
  HistoryError,
  historyErrorMessage,
  type HistoryAuthPort,
  type HistoryDataPort,
  type HistoryQuery,
  type HistoryQueryResult,
} from "../src/services/historyData.ts";
import { HAZARDOUS_WARNING } from "../supabase/functions/_shared/analysis.ts";

// Synthetic data only; no production user, live database or Gemini call.
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";
const id = (number = 1) => `44444444-4444-4444-8444-${number.toString(16).padStart(12, "0")}`;
const timestamp = "2026-10-16T10:20:30.123456+00:00";
const canonical = "2026-10-16T10:20:30.123456Z";
function row(number = 1, change: Record<string, unknown> = {}) {
  return {
    id: id(number), user_id: USER, client_request_id: REQUEST, created_at: timestamp,
    waste_name: "Test plastik şişe", category: "Plastik", description: "Sentetik test kaydı.",
    sorting_instruction: "Ayrı topla.", recycling_advice: "Yerel kuralları kontrol et.",
    safety_warning: null, object_count: "single", uncertain: false, hazardous: false,
    model: "gemini-test-model", schema_version: 1, ...change,
  };
}
type Session = NonNullable<Awaited<ReturnType<HistoryAuthPort["getSession"]>>["data"]["session"]>;
const session = (change: Partial<Session> = {}): Session => ({
  access_token: "synthetic-token-never-persisted", expires_at: 2000, user: { id: USER }, ...change,
});
const code = (expected: string) => (reason: unknown) => reason instanceof HistoryError && reason.code === expected;
const signal = () => new AbortController().signal;

function fixture() {
  let current: Session | null = session();
  let unsubscribed = 0;
  const commands: HistoryQuery[] = [];
  const callbacks = new Set<(event: string, session: Session | null) => void>();
  const auth: HistoryAuthPort = {
    async getSession() { return { data: { session: current }, error: null }; },
    onAuthStateChange(callback) {
      callbacks.add(callback);
      return { data: { subscription: { unsubscribe() { callbacks.delete(callback); unsubscribed++; } } } };
    },
  };
  const port: HistoryDataPort = {
    configured: true, auth, online: () => true, nowSeconds: () => 1000,
    async query(command) {
      commands.push(command);
      return { data: command.kind === "remove" ? [{ id: command.id }] : [row()], error: null, status: 200 };
    },
  };
  return {
    port, auth, commands, service: createHistoryDataService(port),
    setSession(value: Session | null) { current = value; },
    emit(event: string, value: Session | null) { current = value; callbacks.forEach((callback) => callback(event, value)); },
    get unsubscribed() { return unsubscribed; }, get listeners() { return callbacks.size; },
    respond(data: unknown, error: unknown = null, status = 200) {
      port.query = async (command) => { commands.push(command); return { data, error, status }; };
    },
  };
}

test("Geçmiş listesi yalnız beklenen kullanıcıyı, 12+1 sınırını ve güvenli kayıt modelini kullanır", async () => {
  const f = fixture();
  const page = await f.service.list(USER, null, signal());
  assert.deepEqual(f.commands, [{ kind: "list", userId: USER, cursor: null, limit: 13 }]);
  assert.equal(page.items.length, 1);
  assert.equal(page.nextCursor, null);
  assert.deepEqual(Object.keys(page.items[0]).sort(), ["analysis", "createdAt", "id", "model", "schemaVersion"].sort());
  assert.equal(page.items[0].createdAt, canonical);
  assert.equal(page.items[0].analysis.category, "Plastik");
  assert.doesNotMatch(JSON.stringify(page), /synthetic-token|user_id|client_request_id|base64/);
  assert.equal(HISTORY_COLUMNS.length, 15);
  assert.equal(f.unsubscribed, 1);
});

test("Boş geçmiş boş liste ve null cursor döndürür", async () => {
  const f = fixture(); f.respond([]);
  assert.deepEqual(await f.service.list(USER, null, signal()), { items: [], nextCursor: null });
});

test("Keyset sayfalama 13. kaydı saklamaz ve son görünen kaydı cursor yapar", async () => {
  const f = fixture();
  f.respond(Array.from({ length: 13 }, (_, index) => row(20 - index)));
  const page = await f.service.list(USER, null, signal());
  assert.equal(HISTORY_PAGE_SIZE, 12);
  assert.equal(page.items.length, 12);
  assert.deepEqual(page.nextCursor, { createdAt: canonical, id: id(9) });
  assert.equal(page.items.at(-1)?.id, id(9));
  f.respond([row(8)]);
  const next = await f.service.list(USER, page.nextCursor, signal());
  assert.equal(next.items[0].id, id(8));
  assert.deepEqual(f.commands.at(-1), { kind: "list", userId: USER, cursor: page.nextCursor, limit: 13 });
  assert.equal(next.nextCursor, null);
});

test("Tam 12 kayıt sonraki sayfa varmış gibi gösterilmez", async () => {
  const f = fixture(); f.respond(Array.from({ length: 12 }, (_, index) => row(20 - index)));
  assert.equal((await f.service.list(USER, null, signal())).nextCursor, null);
});

test("UTC zaman doğrulaması mikro-saniyeleri korur, kısa kesri altı haneye tamamlar", async () => {
  for (const [input, expected] of [
    [timestamp, canonical], ["2026-10-16T10:20:30Z", "2026-10-16T10:20:30.000000Z"],
    ["2026-10-16T10:20:30.1Z", "2026-10-16T10:20:30.100000Z"],
  ]) {
    const f = fixture(); f.respond([row(1, { created_at: input })]);
    assert.equal((await f.service.list(USER, null, signal())).items[0].createdAt, expected);
  }
});

test("Cursor geçersiz tarih, UUID ve filtre enjeksiyonunu ağ çağrısından önce reddeder", async () => {
  for (const cursor of [
    { createdAt: "invalid", id: id() }, { createdAt: "2026-02-30T10:20:30Z", id: id() },
    { createdAt: "2026-10-16T10:20:30.1234567Z", id: id() },
    { createdAt: canonical, id: `${id()},user_id.neq.test` },
    { createdAt: `${canonical},id.gt.0`, id: id() },
    { createdAt: canonical, id: "not-uuid" }, { createdAt: canonical, id: id(), token: "unexpected" },
  ]) {
    const f = fixture();
    await assert.rejects(async () => f.service.list(USER, cursor, signal()), code("INVALID_CURSOR"));
    assert.equal(f.commands.length, 0);
  }
});

test("Sayfa sırası, cursor sınırı, tekrar ID ve limit üzerindeki yanıt reddedilir", async () => {
  for (const entries of [
    [row(1), row(2)], [row(1), row(1)],
    Array.from({ length: 14 }, (_, index) => row(20 - index)),
  ]) {
    const f = fixture(); f.respond(entries);
    await assert.rejects(f.service.list(USER, null, signal()), code("INVALID_RECORD"));
  }
  const f = fixture(); f.respond([row(2)]);
  await assert.rejects(f.service.list(USER, { createdAt: canonical, id: id(1) }, signal()), code("INVALID_RECORD"));
});

test("Aynı milisaniye içindeki mikro-saniye sırası cursor kesilmeden doğrulanır", async () => {
  const f = fixture(); f.respond([row(2, { created_at: "2026-10-16T10:20:30.123455Z" })]);
  const page = await f.service.list(USER, { createdAt: canonical, id: id(1) }, signal());
  assert.equal(page.items[0].createdAt, "2026-10-16T10:20:30.123455Z");
});

test("Geçerli detay yalnız kullanıcı ve ID komutu ile yüklenir", async () => {
  const f = fixture();
  assert.equal((await f.service.get(USER, id(), signal())).id, id());
  assert.deepEqual(f.commands, [{ kind: "get", userId: USER, id: id() }]);
});

test("Olmayan veya RLS nedeniyle görünmeyen detay bulunamadı hatasıdır", async () => {
  const f = fixture(); f.respond([]);
  await assert.rejects(f.service.get(USER, id(), signal()), code("NOT_FOUND"));
});

test("Başka kullanıcıya veya istenmeyen ID'ye ait veri görünür modele dönüşmez", async () => {
  for (const invalid of [row(1, { user_id: OTHER }), row(2)]) {
    const f = fixture(); f.respond([invalid]);
    await assert.rejects(f.service.get(USER, id(), signal()), code("INVALID_RECORD"));
  }
  const f = fixture(); f.respond([row(1, { user_id: OTHER })]);
  await assert.rejects(f.service.list(USER, null, signal()), code("INVALID_RECORD"));
});

test("Bozuk kategori, eksik/fazla alan, tarih, model ve şema reddedilir", async () => {
  const missing = row(); delete (missing as Partial<typeof missing>).description;
  for (const invalid of [
    row(1, { category: "Geçersiz" }), missing, row(1, { token: "never-show-this" }),
    row(1, { created_at: "2026-02-30T01:00:00Z" }), row(1, { created_at: "2026-10-16" }),
    row(1, { schema_version: 2 }), row(1, { model: "private-provider-detail" }),
    row(1, { description: "  " }), row(1, { uncertain: "false" }), row(1, { object_count: "none" }),
    row(1, { client_request_id: "invalid" }), row(1, { id: "invalid" }),
  ]) {
    const f = fixture(); f.respond([invalid]);
    await assert.rejects(f.service.list(USER, null, signal()), (error) => {
      assert.ok(code("INVALID_RECORD")(error));
      assert.doesNotMatch((error as Error).message, /never-show-this|private-provider/);
      return true;
    });
  }
});

test("Tehlikeli kayıt talimatları ortak güvenlik kurallarından geçirilir", async () => {
  const f = fixture(); f.respond([row(1, { waste_name: "Lityum pil", category: "Pil", hazardous: false })]);
  const result = await f.service.get(USER, id(), signal());
  assert.equal(result.analysis.hazardous, true);
  assert.equal(result.analysis.safetyWarning, HAZARDOUS_WARNING);
});

test("Eksik/yanlış/anonim/süresi geçmiş SDK oturumunda hiçbir sorgu yapılmaz", async () => {
  for (const value of [
    null, session({ expires_at: 999 }), session({ expires_at: undefined }),
    session({ expires_at: Number.POSITIVE_INFINITY }), session({ access_token: "" }),
    session({ user: { id: OTHER } }), session({ user: { id: USER, is_anonymous: true } }),
  ]) {
    const f = fixture(); f.setSession(value);
    await assert.rejects(f.service.list(USER, null, signal()), code("UNAUTHORIZED"));
    assert.equal(f.commands.length, 0);
    assert.equal(f.unsubscribed, 1);
  }
});

test("Yapılandırma, SDK ve geçersiz kullanıcı kimliği güvenli biçimde reddedilir", async () => {
  const missing = fixture(); missing.port.configured = false;
  await assert.rejects(missing.service.list(USER, null, signal()), code("NOT_CONFIGURED"));
  const noAuth = fixture(); noAuth.port.auth = null;
  await assert.rejects(noAuth.service.list(USER, null, signal()), code("UNAUTHORIZED"));
  const invalid = fixture();
  await assert.rejects(invalid.service.list("not-user-id", null, signal()), code("UNAUTHORIZED"));
  assert.equal(invalid.commands.length, 0);
});

test("SDK oturum hataları ham sağlayıcı bilgisi sızdırmaz", async () => {
  for (const rejected of [true, false]) {
    const f = fixture();
    f.auth.getSession = async () => {
      if (rejected) throw new Error("sensitive-provider-detail");
      return { data: { session: session() }, error: { message: "sensitive-provider-detail" } };
    };
    await assert.rejects(f.service.list(USER, null, signal()), code("UNAUTHORIZED"));
    assert.equal(f.commands.length, 0);
  }
});

test("Ağ yanıtı sırasında hesap değişimi veya çıkış eski sonucu engeller", async () => {
  for (const [event, next] of [
    ["SIGNED_OUT", null], ["SIGNED_IN", session({ user: { id: OTHER } })], ["PASSWORD_RECOVERY", session()],
  ] as const) {
    const f = fixture(); let aborted = false;
    f.port.query = async (_command, querySignal) => {
      querySignal.addEventListener("abort", () => { aborted = true; });
      f.emit(event, next);
      return { data: [row()], error: null };
    };
    await assert.rejects(f.service.list(USER, null, signal()), code("UNAUTHORIZED"));
    assert.equal(aborted, true); assert.equal(f.listeners, 0);
  }
});

test("Yanıt sonrası sessiz hesap değişimi ve oturum sonu veriyi gizler", async () => {
  for (const next of [session({ user: { id: OTHER } }), session({ expires_at: 999 })]) {
    const f = fixture(); let reads = 0;
    f.auth.getSession = async () => ({ data: { session: ++reads === 1 ? session() : next }, error: null });
    await assert.rejects(f.service.get(USER, id(), signal()), code("UNAUTHORIZED"));
    assert.equal(reads, 2);
  }
});

test("Aynı kullanıcının token yenilemesi geçmişi yanlışlıkla iptal etmez", async () => {
  const f = fixture();
  f.port.query = async () => {
    f.emit("TOKEN_REFRESHED", session({ access_token: "renewed-synthetic-only" }));
    return { data: [row()], error: null };
  };
  assert.equal((await f.service.list(USER, null, signal())).items.length, 1);
});

test("Önceden veya taşıma sırasında iptal edilmiş istek sonuç döndüremez", async () => {
  const f = fixture(); const aborted = new AbortController(); aborted.abort();
  await assert.rejects(f.service.list(USER, null, aborted.signal), code("CANCELLED"));
  assert.equal(f.commands.length, 0); assert.equal(f.unsubscribed, 1);
  const late = fixture(); const pending = new AbortController();
  late.port.query = async (_command, querySignal) => {
    pending.abort(); assert.equal(querySignal.aborted, true);
    return { data: [row()], error: null };
  };
  await assert.rejects(late.service.list(USER, null, pending.signal), code("CANCELLED"));
  assert.equal(late.listeners, 0);
});

test("Ağ hatası ve offline durumu gizli ayrıntı göstermeden yönetilir", async () => {
  const offline = fixture(); offline.port.online = () => false;
  await assert.rejects(offline.service.list(USER, null, signal()), code("NETWORK_ERROR"));
  assert.equal(offline.commands.length, 0);
  const failed = fixture(); failed.port.query = async () => { throw new Error("secret-token-provider-error"); };
  await assert.rejects(failed.service.list(USER, null, signal()), (error) => {
    assert.ok(code("NETWORK_ERROR")(error)); assert.doesNotMatch((error as Error).message, /secret-token/); return true;
  });
});

test("HTTP ve PostgreSQL hata ayrıntıları güvenli durum kodlarına çevrilir", async () => {
  for (const [status, providerCode, expected] of [
    [401, "unknown", "UNAUTHORIZED"], [403, "unknown", "UNAUTHORIZED"],
    [400, "42501", "UNAUTHORIZED"], [400, "PGRST301", "UNAUTHORIZED"],
    [0, "unknown", "NETWORK_ERROR"], [503, "unknown", "NETWORK_ERROR"],
    [400, "unknown", "SERVICE_ERROR"],
  ] as const) {
    const f = fixture(); f.respond(null, { code: providerCode, message: "hidden-token-detail" }, status);
    await assert.rejects(f.service.list(USER, null, signal()), code(expected));
  }
});

test("Silme yalnız kullanıcı ve tek kayıt ID'si komutu ile yapılır", async () => {
  const f = fixture();
  assert.equal(await f.service.remove(USER, id(), signal()), undefined);
  assert.deepEqual(f.commands, [{ kind: "remove", userId: USER, id: id() }]);
  assert.equal(f.unsubscribed, 1);
});

test("Silmede görünmeyen kayıt başarı sayılmaz; yanlış veya fazla yanıt reddedilir", async () => {
  const missing = fixture(); missing.respond([]);
  await assert.rejects(missing.service.remove(USER, id(), signal()), code("NOT_FOUND"));
  for (const data of [[{ id: id(2) }], [{ id: id(), user_id: USER }], [{ id: id() }, { id: id(2) }], null]) {
    const f = fixture(); f.respond(data);
    await assert.rejects(f.service.remove(USER, id(), signal()), code("INVALID_RECORD"));
  }
});

test("Başarısız silme, hesap değişimi veya iptal başarı üretmez", async () => {
  const failed = fixture(); failed.respond(null, { code: "42501" }, 403);
  await assert.rejects(failed.service.remove(USER, id(), signal()), code("UNAUTHORIZED"));
  const changed = fixture();
  changed.port.query = async () => {
    changed.emit("SIGNED_OUT", null); return { data: [{ id: id() }], error: null };
  };
  await assert.rejects(changed.service.remove(USER, id(), signal()), code("UNAUTHORIZED"));
  const invalid = fixture();
  await assert.rejects(invalid.service.remove(USER, "invalid", signal()), code("NOT_FOUND"));
  assert.equal(invalid.commands.length, 0);
});

test("Hata metni tanınmayan nesnelerden mesaj veya token aktaramaz", () => {
  assert.match(historyErrorMessage(new HistoryError("NOT_FOUND")), /bulunamadı/);
  assert.equal(historyErrorMessage(new Error("secret-provider-message")), historyErrorMessage(null));
  assert.doesNotMatch(historyErrorMessage({ code: "UNAUTHORIZED", message: "secret-token" }), /secret/);
});

test("Yanıt biçimi kontrol edilir; nesne veya çoklu detay kaydı kabul edilmez", async () => {
  for (const data of [null, {}, row(), [row(), row(2)]]) {
    const f = fixture(); f.respond(data);
    await assert.rejects(f.service.get(USER, id(), signal()), code("INVALID_RECORD"));
  }
});

test("Oturum okunurken iptal ve Auth aboneliği hatası temizlenir", async () => {
  const f = fixture(); const controller = new AbortController();
  f.auth.getSession = async () => { controller.abort(); return { data: { session: session() }, error: null }; };
  await assert.rejects(f.service.list(USER, null, controller.signal), code("CANCELLED"));
  assert.equal(f.listeners, 0); assert.equal(f.commands.length, 0);
  const bad = fixture(); bad.auth.onAuthStateChange = () => { throw new Error("private-auth-error"); };
  await assert.rejects(bad.service.list(USER, null, signal()), code("NETWORK_ERROR"));
});

// Compile-time fixtures ensure the mock API follows the same structured port.
const exampleResponse: HistoryQueryResult = { data: [], error: null };
void exampleResponse;
