import { test } from "node:test";
import assert from "node:assert/strict";
import { createStatisticsController } from "../src/services/statisticsController.ts";
import { calculateStatistics, StatisticsError, type StatisticsSummary } from "../src/services/statisticsData.ts";

const userA = "00000000-0000-4000-8000-000000000001";
const userB = "00000000-0000-4000-8000-000000000002";
function summary(count: number) {
  return calculateStatistics(Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`,
    category: "Plastik" as const, createdAt: "2026-10-16T00:00:00Z",
  })), Date.parse("2026-10-16T12:00:00Z"));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

test("İstatistik controller: misafir sorgu başlatmaz", async () => {
  let calls = 0;
  const controller = createStatisticsController({ load: async () => { calls++; return summary(1); } }, "");
  await controller.start(); await controller.reload();
  assert.equal(calls, 0);
  assert.deepEqual(controller.getSnapshot(), { summary: null, loading: false, error: null });
  controller.dispose();
});

test("İstatistik controller: tam sonuç yüklenir ve paralel yenilemeler tek istekte birleşir", async () => {
  const response = deferred<StatisticsSummary>(); let calls = 0;
  const controller = createStatisticsController({ load: async (owner) => {
    calls++; assert.equal(owner, userA); return response.promise;
  } }, userA);
  const first = controller.start(); const second = controller.reload(); const third = controller.start();
  assert.equal(first, second); assert.equal(first, third);
  assert.equal(controller.getSnapshot().loading, true);
  await Promise.resolve(); assert.equal(calls, 1);
  response.resolve(summary(5)); await first;
  assert.equal(controller.getSnapshot().summary?.totalAnalyses, 5);
  assert.equal(controller.getSnapshot().loading, false);
  controller.dispose();
});

test("İstatistik controller: eklenen ve silinen kayıtlar yenilemede doğru sayılır", async () => {
  let count = 1;
  const controller = createStatisticsController({ load: async () => summary(count) }, userA);
  await controller.start(); assert.equal(controller.getSnapshot().summary?.totalAnalyses, 1);
  count = 2; await controller.reload(); assert.equal(controller.getSnapshot().summary?.totalAnalyses, 2);
  count = 1; await controller.reload(); assert.equal(controller.getSnapshot().summary?.totalAnalyses, 1);
  count = 0; await controller.reload(); assert.equal(controller.getSnapshot().summary?.totalAnalyses, 0);
  controller.dispose();
});

test("İstatistik controller: yükleme bildiriminden gelen yenileme de tek istekte birleşir", async () => {
  let calls = 0;
  const controller = createStatisticsController({ load: async () => { calls++; return summary(1); } }, userA);
  const unsubscribe = controller.subscribe(() => {
    if (controller.getSnapshot().loading) void controller.reload();
  });
  await controller.start();
  assert.equal(calls, 1);
  unsubscribe(); controller.dispose();
});

test("İstatistik controller: ağ hatasında eski veya kısmi toplam görünmez, tekrar deneme çalışır", async () => {
  let failed = false;
  const controller = createStatisticsController({ load: async () => {
    if (failed) throw new StatisticsError("NETWORK_ERROR");
    return summary(3);
  } }, userA);
  await controller.start(); failed = true;
  const refresh = controller.reload();
  assert.equal(controller.getSnapshot().summary, null);
  await refresh;
  assert.equal(controller.getSnapshot().summary, null);
  assert.match(controller.getSnapshot().error ?? "", /İnternet/);
  failed = false; await controller.reload();
  assert.equal(controller.getSnapshot().summary?.totalAnalyses, 3);
  assert.equal(controller.getSnapshot().error, null);
  controller.dispose();
});

test("İstatistik controller: JWT yetki kaybında önceki sayılar temizlenir", async () => {
  let unauthorized = false;
  const controller = createStatisticsController({ load: async () => {
    if (unauthorized) throw new StatisticsError("UNAUTHORIZED");
    return summary(1);
  } }, userA);
  await controller.start(); unauthorized = true; await controller.reload();
  assert.equal(controller.getSnapshot().summary, null);
  assert.match(controller.getSnapshot().error ?? "", /Yeniden giriş/);
  controller.dispose();
});

test("İstatistik controller: çıkış isteği iptal eder ve geç yanıt eski sayıları getiremez", async () => {
  const response = deferred<StatisticsSummary>(); let signal: AbortSignal | undefined;
  const controller = createStatisticsController({ load: async (_owner, active) => {
    signal = active; return response.promise;
  } }, userA);
  const pending = controller.start(); await Promise.resolve(); controller.dispose();
  assert.equal(signal?.aborted, true);
  response.resolve(summary(4)); await pending;
  assert.deepEqual(controller.getSnapshot(), { summary: null, loading: false, error: null });
});

test("İstatistik controller: A hesabının gecikmiş yanıtı B hesabının verisini etkileyemez", async () => {
  const response = deferred<StatisticsSummary>();
  const a = createStatisticsController({ load: async () => response.promise }, userA);
  const pending = a.start(); await Promise.resolve(); a.dispose();
  const b = createStatisticsController({ load: async (owner) => {
    assert.equal(owner, userB); return summary(2);
  } }, userB);
  await b.start(); response.resolve(summary(99)); await pending;
  assert.equal(a.getSnapshot().summary, null);
  assert.equal(b.getSnapshot().summary?.totalAnalyses, 2); b.dispose();
});

test("İstatistik controller: aynı scope StrictMode yeniden başlayınca eski nesil sonucu yoksayılır", async () => {
  const oldResponse = deferred<StatisticsSummary>(); let calls = 0;
  const controller = createStatisticsController({ load: async () => ++calls === 1 ? oldResponse.promise : summary(2) }, userA);
  const old = controller.start(); await Promise.resolve(); controller.dispose(); await controller.start();
  oldResponse.resolve(summary(90)); await old;
  assert.equal(controller.getSnapshot().summary?.totalAnalyses, 2); controller.dispose();
});

test("İstatistik controller: ilk microtask öncesi kapanan scope ağa çıkmaz", async () => {
  let calls = 0;
  const controller = createStatisticsController({ load: async () => { calls++; return summary(1); } }, userA);
  const pending = controller.start(); controller.dispose(); await pending;
  assert.equal(calls, 0);
});

test("İstatistik controller: senkron servis hatası yenileme kilidini açık bırakmaz", async () => {
  let throws = true;
  const controller = createStatisticsController({ load: () => {
    if (throws) throw new StatisticsError("NETWORK_ERROR");
    return Promise.resolve(summary(1));
  } }, userA);
  await controller.start(); assert.equal(controller.getSnapshot().summary, null);
  throws = false; await controller.reload();
  assert.equal(controller.getSnapshot().summary?.totalAnalyses, 1); controller.dispose();
});
