import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateStatistics,
  createStatisticsDataService,
  STATISTICS_COLUMNS,
  STATISTICS_PAGE_SIZE,
  StatisticsError,
  statisticsErrorMessage,
  type StatisticsDataPort,
  type StatisticsQuery,
  type StatisticsRecord,
} from "../src/services/statisticsData.ts";
import type { HistoryAuthPort } from "../src/services/historyData.ts";
import { CATEGORIES, type WasteCategory } from "../supabase/functions/_shared/analysis.ts";

// Synthetic fixtures only; these tests do not contact Supabase or Gemini.
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-18T21:30:00Z"); // Monday 00:30 in Istanbul.
const CREATED = "2026-10-18T21:10:00.123456Z";
const identifier = (index = 1) => `33333333-3333-4333-8333-${index.toString(16).padStart(12, "0")}`;
const signal = () => new AbortController().signal;
const code = (expected: string) => (reason: unknown) => reason instanceof StatisticsError && reason.code === expected;
function record(index = 1, category: WasteCategory = "Plastik", createdAt = CREATED): StatisticsRecord {
  return { id: identifier(index), createdAt, category };
}
function row(index = 1, category: WasteCategory = "Plastik", createdAt = CREATED) {
  return { id: identifier(index), user_id: USER, created_at: createdAt, category };
}
type Row = ReturnType<typeof row>;
type Session = NonNullable<Awaited<ReturnType<HistoryAuthPort["getSession"]>>["data"]["session"]>;
const session = (change: Partial<Session> = {}): Session => ({
  access_token: "synthetic-statistics-jwt-never-real", expires_at: NOW / 1000 + 3600,
  user: { id: USER }, ...change,
});
function fixture(initial: Row[] = [row()], cap = STATISTICS_PAGE_SIZE) {
  let current: Session | null = session();
  let time = NOW;
  let unsubscribed = 0;
  let records = [...initial];
  const commands: StatisticsQuery[] = [];
  const callbacks = new Set<(event: string, value: Session | null) => void>();
  const auth: HistoryAuthPort = {
    async getSession() { return { data: { session: current }, error: null }; },
    onAuthStateChange(callback) {
      callbacks.add(callback);
      return { data: { subscription: { unsubscribe() { callbacks.delete(callback); unsubscribed++; } } } };
    },
  };
  const canonical = (value: string) => value.replace("+00:00", "Z");
  const port: StatisticsDataPort = {
    configured: true, auth, now: () => time, online: () => true,
    async query(command) {
      commands.push(command);
      const sorted = [...records].sort((a, b) => {
        const aTime = canonical(a.created_at), bTime = canonical(b.created_at);
        if (aTime !== bTime) return aTime > bTime ? -1 : 1;
        return a.id === b.id ? 0 : a.id > b.id ? -1 : 1;
      });
      if (command.kind === "count") {
        const count = sorted.filter((item) => canonical(item.created_at) < command.highWater.createdAt ||
          (canonical(item.created_at) === command.highWater.createdAt && item.id <= command.highWater.id)).length;
        return { data: null, error: null, count, status: 200 };
      }
      const remaining = sorted.filter((item) => !command.cursor || canonical(item.created_at) < command.cursor.createdAt ||
        (canonical(item.created_at) === command.cursor.createdAt && item.id < command.cursor.id));
      return { data: remaining.slice(0, Math.min(cap, command.limit)), error: null, count: remaining.length, status: 200 };
    },
  };
  return {
    port, auth, commands, service: createStatisticsDataService(port),
    setRecords(value: Row[]) { records = value; },
    setNow(value: number) { time = value; },
    setSession(value: Session | null) { current = value; },
    emit(event: string, value: Session | null) { current = value; callbacks.forEach((callback) => callback(event, value)); },
    get unsubscribed() { return unsubscribed; }, get listeners() { return callbacks.size; },
  };
}

test("Boş istatistik sekiz gerçek kategori, sıfır sayılar ve boş lider listesi üretir", () => {
  const summary = calculateStatistics([], NOW);
  assert.equal(summary.totalAnalyses, 0);
  assert.equal(summary.distinctCategories, 0);
  assert.equal(summary.topCount, 0);
  assert.deepEqual(summary.topCategories, []);
  assert.deepEqual(summary.categories.map((item) => item.category), [...CATEGORIES]);
  assert.ok(summary.categories.every((item) => item.count === 0 && item.percentage === 0));
  assert.equal(summary.daily.length, 14); assert.equal(summary.weekly.length, 8);
  assert.ok([...summary.daily, ...summary.weekly].every((item) => item.count === 0));
});

test("Tek plastik kaydı toplam bir, bir kategori ve yüzde yüz plastik olarak hesaplanır", () => {
  const summary = calculateStatistics([record()], NOW);
  assert.equal(summary.totalAnalyses, 1); assert.equal(summary.distinctCategories, 1);
  assert.deepEqual(summary.topCategories, ["Plastik"]); assert.equal(summary.topCount, 1);
  assert.deepEqual(summary.categories[0], { category: "Plastik", count: 1, percentage: 100 });
  assert.equal(summary.daily.at(-1)?.count, 1); assert.equal(summary.weekly.at(-1)?.count, 1);
  assert.equal(summary.timeZone, "Europe/Istanbul");
  assert.equal(summary.calculatedAt, "2026-10-18T21:30:00.000Z");
});

test("Aynı kategoriden farklı kayıtlar ve kategori çeşitliliği doğru sayılır", () => {
  const summary = calculateStatistics([record(1), record(2), record(3, "Cam"), record(4, "Metal")], NOW);
  assert.equal(summary.totalAnalyses, 4); assert.equal(summary.distinctCategories, 3);
  assert.equal(summary.categories[0].count, 2); assert.equal(summary.categories[0].percentage, 50);
  assert.equal(summary.categories[1].percentage, 25); assert.equal(summary.topCount, 2);
  assert.deepEqual(summary.topCategories, ["Plastik"]);
});

test("Yüzdeler tam oran olarak hesaplanır; yuvarlama veri katmanında bilgi kaybettirmez", () => {
  const summary = calculateStatistics([record(1), record(2, "Cam"), record(3, "Metal")], NOW);
  assert.ok(Math.abs(summary.categories[0].percentage - 100 / 3) < 1e-12);
  assert.ok(Math.abs(summary.categories.reduce((sum, item) => sum + item.percentage, 0) - 100) < 1e-10);
});

test("Eşit en sık kategorilerden biri rastgele seçilmez; tüm liderler sözleşme sırasındadır", () => {
  const summary = calculateStatistics([record(1, "Cam"), record(2), record(3, "Cam"), record(4)], NOW);
  assert.deepEqual(summary.topCategories, ["Plastik", "Cam"]); assert.equal(summary.topCount, 2);
  const all = calculateStatistics(CATEGORIES.map((category, index) => record(index + 1, category)), NOW);
  assert.deepEqual(all.topCategories, [...CATEGORIES]); assert.equal(all.distinctCategories, 8);
});

test("Aynı kayıt ID'si iki kez toplamı artırmak yerine güvenli hata üretir", () => {
  assert.throws(() => calculateStatistics([record(), record()], NOW), code("INVALID_DATA"));
});

test("UTC Pazar 21:00 sınırı İstanbul'da Pazartesi gününe ve yeni haftaya geçer", () => {
  const summary = calculateStatistics([
    record(1, "Plastik", "2026-10-18T20:59:59.999999Z"),
    record(2, "Cam", "2026-10-18T21:00:00.000000Z"),
  ], NOW);
  assert.equal(summary.daily.at(-2)?.date, "2026-10-18");
  assert.equal(summary.daily.at(-2)?.count, 1);
  assert.equal(summary.daily.at(-1)?.date, "2026-10-19");
  assert.equal(summary.daily.at(-1)?.count, 1);
  assert.equal(summary.weekly.at(-2)?.startDate, "2026-10-12");
  assert.equal(summary.weekly.at(-2)?.count, 1);
  assert.equal(summary.weekly.at(-1)?.startDate, "2026-10-19");
  assert.equal(summary.weekly.at(-1)?.endDate, "2026-10-25");
  assert.equal(summary.weekly.at(-1)?.count, 1);
});

test("Günlük pencere son 14 günü kapsar, daha eski kayıt toplamdan düşmez", () => {
  const summary = calculateStatistics([
    record(1, "Plastik", "2026-10-05T20:59:59.999999Z"),
    record(2, "Cam", "2026-10-05T21:00:00Z"),
  ], NOW);
  assert.equal(summary.totalAnalyses, 2);
  assert.equal(summary.daily[0].date, "2026-10-06");
  assert.equal(summary.daily[0].count, 1);
  assert.equal(summary.daily.reduce((sum, item) => sum + item.count, 0), 1);
});

test("Sekiz haftalık pencere Pazartesi başlangıçlıdır ve eski kayıt yalnız genel toplamda kalır", () => {
  const summary = calculateStatistics([
    record(1, "Plastik", "2026-08-30T20:59:59.999999Z"),
    record(2, "Cam", "2026-08-30T21:00:00Z"),
  ], NOW);
  assert.equal(summary.weekly[0].startDate, "2026-08-31");
  assert.equal(summary.weekly[0].endDate, "2026-09-06");
  assert.equal(summary.weekly[0].count, 1); assert.equal(summary.totalAnalyses, 2);
  assert.equal(summary.weekly.reduce((sum, item) => sum + item.count, 0), 1);
});

test("Yıl ve artık yıl gün sınırları takvim günü olarak hesaplanır", () => {
  const newYear = calculateStatistics([record(1, "Cam", "2025-12-28T21:00:00Z")], Date.parse("2026-01-01T00:30:00Z"));
  assert.equal(newYear.weekly.at(-1)?.startDate, "2025-12-29");
  assert.equal(newYear.weekly.at(-1)?.count, 1);
  const leap = calculateStatistics([record(1, "Cam", "2024-02-29T20:00:00Z")], Date.parse("2024-02-29T22:00:00Z"));
  assert.equal(leap.daily.at(-1)?.date, "2024-03-01");
  assert.equal(leap.daily.at(-2)?.date, "2024-02-29");
  assert.equal(leap.daily.at(-2)?.count, 1);
});

test("Geçersiz kategori, tarih, UUID, fazla alan ve hesaplama zamanı reddedilir", () => {
  for (const invalid of [
    { ...record(), category: "Unknown" }, { ...record(), id: "invalid" },
    { ...record(), createdAt: "2026-02-30T10:00:00Z" }, { ...record(), createdAt: "2026-10-19" },
    { ...record(), createdAt: "2026-10-19T00:00:00.1234567Z" }, { ...record(), secret: "never-show" },
  ]) assert.throws(() => calculateStatistics([invalid as StatisticsRecord], NOW), code("INVALID_DATA"));
  assert.throws(() => calculateStatistics([], Number.NaN), code("INVALID_DATA"));
});

test("Boş servis yanıtı tek sayfada, HEAD veya kısmi gösterim olmadan sonuçlanır", async () => {
  const f = fixture([]);
  assert.equal((await f.service.load(USER, signal())).totalAnalyses, 0);
  assert.deepEqual(f.commands, [{ kind: "page", userId: USER, cursor: null, limit: 500 }]);
  assert.equal(f.unsubscribed, 1);
});

test("Servis yalnız dört alanlık veriyi sayar ve yüksek su işaretini final sayıma taşır", async () => {
  const f = fixture();
  const summary = await f.service.load(USER, signal());
  assert.equal(summary.totalAnalyses, 1);
  assert.deepEqual([...STATISTICS_COLUMNS], ["id", "user_id", "created_at", "category"]);
  assert.deepEqual(f.commands, [
    { kind: "page", userId: USER, cursor: null, limit: 500 },
    { kind: "count", userId: USER, highWater: { createdAt: CREATED, id: identifier() } },
  ]);
  assert.doesNotMatch(JSON.stringify(summary), /synthetic-statistics|user_id|client_request_id|base64/);
  assert.equal(f.unsubscribed, 1);
});

test("Büyük veri 1000 kayıt sınırını aşar ve 500'lük keyset sayfalarda eksiksiz hesaplanır", async () => {
  const f = fixture(Array.from({ length: 1501 }, (_, index) => row(index + 1, CATEGORIES[index % 8])));
  const summary = await f.service.load(USER, signal());
  assert.equal(summary.totalAnalyses, 1501);
  assert.equal(summary.categories.reduce((sum, item) => sum + item.count, 0), 1501);
  assert.equal(f.commands.filter((command) => command.kind === "page").length, 4);
  assert.equal(f.commands.at(-1)?.kind, "count");
  assert.deepEqual(f.commands[1], { kind: "page", userId: USER, cursor: { createdAt: CREATED, id: identifier(1002) }, limit: 500 });
});

test("Sunucu 500'den kısa sayfa döndürse de exact count tamamlanana kadar ilerlenir", async () => {
  const f = fixture(Array.from({ length: 1001 }, (_, index) => row(index + 1)), 137);
  assert.equal((await f.service.load(USER, signal())).totalAnalyses, 1001);
  assert.equal(f.commands.filter((command) => command.kind === "page").length, 8);
});

test("Tam 500 ve 1000 sınırında gereksiz boş sayfa çağrısı yapılmaz", async () => {
  for (const size of [500, 1000]) {
    const f = fixture(Array.from({ length: size }, (_, index) => row(index + 1)));
    assert.equal((await f.service.load(USER, signal())).totalAnalyses, size);
    assert.equal(f.commands.length, size / 500 + 1);
  }
});

test("Mikro-saniye cursor'u milisaniyeye kesilmez", async () => {
  const f = fixture([
    row(1, "Plastik", "2026-10-18T21:10:00.123457Z"),
    row(2, "Cam", "2026-10-18T21:10:00.123456Z"),
  ], 1);
  assert.equal((await f.service.load(USER, signal())).totalAnalyses, 2);
  assert.deepEqual(f.commands[1], { kind: "page", userId: USER,
    cursor: { createdAt: "2026-10-18T21:10:00.123457Z", id: identifier(1) }, limit: 500 });
});

test("Yeni baş kayıt final yüksek su sayımına eklenmez; tarama uzamaz", async () => {
  const f = fixture([row(1)]);
  const original = f.port.query;
  f.port.query = async (command, querySignal) => {
    if (command.kind === "count") f.setRecords([row(1), row(2, "Cam", "2026-10-18T21:20:00.123456Z")]);
    return original(command, querySignal);
  };
  assert.equal((await f.service.load(USER, signal())).totalAnalyses, 1);
});

test("Final yüksek su sayımı farklıysa hiçbir tamamlanmış özet dönmez", async () => {
  for (const finalCount of [0, 2]) {
    const f = fixture(); const original = f.port.query;
    f.port.query = async (command, querySignal) => command.kind === "count"
      ? { data: null, error: null, count: finalCount } : original(command, querySignal);
    await assert.rejects(f.service.load(USER, signal()), code("DATA_CHANGED"));
  }
});

test("Sayfalar arasında silme veya eski tarihe ekleme kalan sayı değişimini yakalar", async () => {
  for (const changed of [[row(1)], [row(0), row(1), row(2)]]) {
    const f = fixture([row(1), row(2)], 1); const original = f.port.query;
    let pages = 0;
    f.port.query = async (command, querySignal) => {
      if (command.kind === "page" && ++pages === 2) f.setRecords(changed);
      return original(command, querySignal);
    };
    await assert.rejects(f.service.load(USER, signal()), code("DATA_CHANGED"));
  }
});

test("Tekrar kayıt, sıra bozukluğu ve ilerlemeyen cursor güvenli hata üretir", async () => {
  for (const data of [[row(1), row(1)], [row(1), row(2)]]) {
    const f = fixture(); f.port.query = async () => ({ data, error: null, count: 2 });
    await assert.rejects(f.service.load(USER, signal()), code("DATA_CHANGED"));
  }
  const f = fixture(); f.port.query = async () => ({ data: [], error: null, count: 1 });
  await assert.rejects(f.service.load(USER, signal()), code("DATA_CHANGED"));
});

test("Eksik/bozuk exact count veya sayfa sınırını aşan yanıt kabul edilmez", async () => {
  for (const count of [null, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    const f = fixture(); f.port.query = async () => ({ data: [], error: null, count });
    await assert.rejects(f.service.load(USER, signal()), code("INVALID_DATA"));
  }
  for (const data of [null, {}, [row()], Array.from({ length: 501 }, (_, index) => row(index + 1))]) {
    const f = fixture(); f.port.query = async () => ({ data, error: null, count: Array.isArray(data) && data.length > 500 ? 501 : 0 });
    await assert.rejects(f.service.load(USER, signal()), code("INVALID_DATA"));
  }
});

test("Başka kullanıcı, geçersiz kategori/tarih veya fazla alan veri sızıntısına dönüşmez", async () => {
  for (const invalid of [
    { ...row(), user_id: OTHER }, { ...row(), category: "Invalid" },
    { ...row(), created_at: "2026-02-30T00:00:00Z" }, { ...row(), id: "invalid" },
    { ...row(), user_id: "invalid" }, { ...row(), token: "hidden-provider-token" },
    { id: identifier(), user_id: USER, created_at: CREATED },
  ]) {
    const f = fixture(); f.port.query = async () => ({ data: [invalid], error: null, count: 1 });
    await assert.rejects(f.service.load(USER, signal()), (error) => {
      assert.ok(code("INVALID_DATA")(error)); assert.doesNotMatch((error as Error).message, /hidden-provider-token/); return true;
    });
  }
});

test("İkinci sayfada ağ hatası daha önce sayılan kayıtları sonuç olarak yayımlamaz", async () => {
  const f = fixture([row(1), row(2)], 1); const original = f.port.query;
  let calls = 0;
  f.port.query = async (command, querySignal) => {
    if (++calls === 2) throw new Error("private-network-token-detail");
    return original(command, querySignal);
  };
  await assert.rejects(f.service.load(USER, signal()), code("NETWORK_ERROR"));
  assert.equal(f.listeners, 0);
});

test("Final HEAD hatası da kısmi veya eski istatistik başarı sonucu oluşturmaz", async () => {
  const f = fixture(); const original = f.port.query;
  f.port.query = async (command, querySignal) => command.kind === "count"
    ? { data: null, error: { code: "42501", message: "private-detail" }, count: null, status: 403 }
    : original(command, querySignal);
  await assert.rejects(f.service.load(USER, signal()), code("UNAUTHORIZED"));
});

test("Eksik, süresi dolmuş, anonim veya başka kullanıcı SDK oturumunda sorgu yapılmaz", async () => {
  for (const current of [
    null, session({ expires_at: NOW / 1000 - 1 }), session({ expires_at: undefined }),
    session({ expires_at: Number.POSITIVE_INFINITY }), session({ access_token: "" }),
    session({ user: { id: OTHER } }), session({ user: { id: USER, is_anonymous: true } }),
  ]) {
    const f = fixture(); f.setSession(current);
    await assert.rejects(f.service.load(USER, signal()), code("UNAUTHORIZED"));
    assert.equal(f.commands.length, 0); assert.equal(f.unsubscribed, 1);
  }
});

test("Yapılandırma, SDK ve kullanıcı kimliği yoksa güvenli hata verilir", async () => {
  const missing = fixture(); missing.port.configured = false;
  await assert.rejects(missing.service.load(USER, signal()), code("NOT_CONFIGURED"));
  const noSdk = fixture(); noSdk.port.auth = null;
  await assert.rejects(noSdk.service.load(USER, signal()), code("UNAUTHORIZED"));
  const invalid = fixture();
  await assert.rejects(invalid.service.load("invalid", signal()), code("UNAUTHORIZED"));
  assert.equal(invalid.commands.length, 0);
});

test("Çıkış, parola kurtarma ve hesap değişimi geç gelen veriyi reddeder", async () => {
  for (const [event, current] of [
    ["SIGNED_OUT", null], ["PASSWORD_RECOVERY", session()], ["SIGNED_IN", session({ user: { id: OTHER } })],
  ] as const) {
    const f = fixture(); let aborted = false;
    f.port.query = async (_command, querySignal) => {
      querySignal.addEventListener("abort", () => { aborted = true; });
      f.emit(event, current);
      return { data: [row()], error: null, count: 1 };
    };
    await assert.rejects(f.service.load(USER, signal()), code("UNAUTHORIZED"));
    assert.equal(aborted, true); assert.equal(f.listeners, 0);
  }
});

test("Her sayfa sonrası sessiz kullanıcı değişimi ve oturum süresi yeniden denetlenir", async () => {
  for (const current of [session({ user: { id: OTHER } }), session({ expires_at: NOW / 1000 - 1 })]) {
    const f = fixture(); let reads = 0;
    f.auth.getSession = async () => ({ data: { session: ++reads === 1 ? session() : current }, error: null });
    await assert.rejects(f.service.load(USER, signal()), code("UNAUTHORIZED"));
    assert.equal(f.commands.length, 1); assert.equal(reads, 2);
  }
});

test("Aynı kullanıcı token yenilemesi sonuçları iptal etmez", async () => {
  const f = fixture(); const original = f.port.query;
  f.port.query = async (command, querySignal) => {
    f.emit("TOKEN_REFRESHED", session({ access_token: "renewed-synthetic-only" }));
    return original(command, querySignal);
  };
  assert.equal((await f.service.load(USER, signal())).totalAnalyses, 1);
});

test("Tarama sırasında caller iptali ve iptali yok sayan taşıyıcı sonuç yayımlayamaz", async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.service.load(USER, controller.signal), code("CANCELLED"));
  assert.equal(f.commands.length, 0); assert.equal(f.unsubscribed, 1);
  const late = fixture(); const pending = new AbortController();
  late.port.query = async (_command, querySignal) => {
    pending.abort(); assert.equal(querySignal.aborted, true);
    return { data: [row()], error: null, count: 1 };
  };
  await assert.rejects(late.service.load(USER, pending.signal), code("CANCELLED"));
  assert.equal(late.listeners, 0);
});

test("Offline ve SDK oturum hataları ham ayrıntı döndürmez", async () => {
  const offline = fixture(); offline.port.online = () => false;
  await assert.rejects(offline.service.load(USER, signal()), code("NETWORK_ERROR"));
  assert.equal(offline.commands.length, 0);
  for (const throws of [false, true]) {
    const f = fixture();
    f.auth.getSession = async () => {
      if (throws) throw new Error("private-token");
      return { data: { session: session() }, error: { message: "private-token" } };
    };
    await assert.rejects(f.service.load(USER, signal()), code("UNAUTHORIZED"));
  }
});

test("HTTP hata kodları ve bilinmeyen hatalar güvenli Türkçe metne çevrilir", async () => {
  for (const [status, providerCode, expected] of [
    [401, "unknown", "UNAUTHORIZED"], [403, "unknown", "UNAUTHORIZED"],
    [400, "42501", "UNAUTHORIZED"], [400, "PGRST301", "UNAUTHORIZED"],
    [0, "unknown", "NETWORK_ERROR"], [503, "unknown", "NETWORK_ERROR"], [400, "unknown", "SERVICE_ERROR"],
  ] as const) {
    const f = fixture(); f.port.query = async () => ({ data: null, error: { code: providerCode, message: "private-secret" }, count: null, status });
    await assert.rejects(f.service.load(USER, signal()), code(expected));
  }
  assert.match(statisticsErrorMessage(new StatisticsError("DATA_CHANGED")), /yenile/i);
  assert.doesNotMatch(statisticsErrorMessage(new Error("private-secret")), /private-secret/);
});

test("Yeniden yükleme ekleme ve silmeden sonraki gerçek mevcut sayıları yeniden hesaplar", async () => {
  const f = fixture([row(1), row(2, "Cam")]);
  assert.equal((await f.service.load(USER, signal())).totalAnalyses, 2);
  f.setRecords([row(1), row(2, "Cam"), row(3, "Metal")]);
  assert.equal((await f.service.load(USER, signal())).totalAnalyses, 3);
  f.setRecords([row(1)]);
  const remaining = await f.service.load(USER, signal());
  assert.equal(remaining.totalAnalyses, 1); assert.deepEqual(remaining.topCategories, ["Plastik"]);
});
