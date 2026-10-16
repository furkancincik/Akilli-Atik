import { test } from "node:test";
import assert from "node:assert/strict";
import { createHistoryController } from "../src/services/historyController.ts";
import { HistoryError, historyErrorMessage, type HistoryPageResult, type HistoryRecord, type HistoryService } from "../src/services/historyData.ts";

// Isolated fixtures only; the controller has no SDK or remote transport.
const userA = "00000000-0000-4000-8000-000000000001";
const userB = "00000000-0000-4000-8000-000000000002";
function record(number: number, createdAt = "2026-10-16T12:00:00.000001Z"): HistoryRecord {
  return {
    id: `00000000-0000-4000-8000-${number.toString().padStart(12, "0")}`,
    createdAt, model: "gemini-unit-model", schemaVersion: 1,
    analysis: {
      success: true, wasteName: `Test atığı ${number}`, category: "Plastik",
      description: "Yalnız otomatik test verisi.", sortingInstruction: "Ayrı topla.",
      recyclingAdvice: "Yerel kabul kurallarını doğrula.", safetyWarning: null,
      objectCount: "single", uncertain: false, hazardous: false,
    },
  };
}
function page(items: HistoryRecord[], hasMore = false): HistoryPageResult {
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? { id: last.id, createdAt: last.createdAt } : null };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}
function service(overrides: Partial<HistoryService> = {}): HistoryService {
  return {
    list: async () => page([]),
    get: async () => { throw new HistoryError("NOT_FOUND"); },
    remove: async () => {},
    ...overrides,
  };
}

test("Geçmiş controller: boş liste ve tekrarlanan start tek istekle tamamlanır", async () => {
  let calls = 0;
  const pending = deferred<HistoryPageResult>();
  const controller = createHistoryController(service({ list: async (user, cursor) => {
    calls++;
    assert.equal(user, userA);
    assert.equal(cursor, null);
    return pending.promise;
  } }), userA);
  const first = controller.start();
  const second = controller.start();
  assert.equal(controller.getSnapshot().loading, true);
  pending.resolve(page([]));
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(controller.getSnapshot().items, []);
  assert.equal(controller.getSnapshot().loading, false);
  assert.equal(controller.getSnapshot().error, null);
  controller.dispose();
});

test("Geçmiş controller: eşit milisaniyedeki mikrosaniyeler ve UUID bağı kararlı DESC sıralanır", async () => {
  const one = record(1, "2026-10-16T12:00:00.000002Z");
  const two = record(2, "2026-10-16T12:00:00.000001Z");
  const three = record(3, "2026-10-16T12:00:00.000002Z");
  const controller = createHistoryController(service({ list: async () => page([two, one, three, one]) }), userA);
  await controller.start();
  assert.deepEqual(controller.getSnapshot().items.map((item) => item.id), [three.id, one.id, two.id]);
  controller.dispose();
});

test("Geçmiş controller: daha fazla yükleme doğru cursor kullanır, çakışan UUID'leri bir kez gösterir", async () => {
  const first = record(4);
  const second = record(3);
  const third = record(2);
  let calls = 0;
  const controller = createHistoryController(service({ list: async (user, cursor) => {
    assert.equal(user, userA);
    if (++calls === 1) return page([first, second], true);
    assert.deepEqual(cursor, { id: second.id, createdAt: second.createdAt });
    return page([second, third]);
  } }), userA);
  await controller.start();
  await controller.loadMore();
  assert.deepEqual(controller.getSnapshot().items.map((item) => item.id), [first.id, second.id, third.id]);
  assert.equal(controller.getSnapshot().nextCursor, null);
  await controller.loadMore();
  assert.equal(calls, 2);
  controller.dispose();
});

test("Geçmiş controller: çift daha-fazla isteği kilitlenir", async () => {
  const pending = deferred<HistoryPageResult>();
  let calls = 0;
  const controller = createHistoryController(service({ list: async () => ++calls === 1 ? page([record(3)], true) : pending.promise }), userA);
  await controller.start();
  const first = controller.loadMore();
  await controller.loadMore();
  assert.equal(calls, 2);
  pending.resolve(page([record(2)]));
  await first;
  assert.equal(controller.getSnapshot().loadingMore, false);
  controller.dispose();
});

test("Geçmiş controller: ters sırada dönen yenilemelerde son istek kazanır", async () => {
  const old = deferred<HistoryPageResult>();
  const latest = deferred<HistoryPageResult>();
  const signals: AbortSignal[] = [];
  const controller = createHistoryController(service({ list: async (_user, _cursor, signal) => {
    signals.push(signal);
    return signals.length === 1 ? old.promise : latest.promise;
  } }), userA);
  const first = controller.start();
  const second = controller.reload();
  latest.resolve(page([record(9)]));
  await second;
  old.resolve(page([record(1)]));
  await first;
  assert.equal(signals[0].aborted, true);
  assert.deepEqual(controller.getSnapshot().items.map((item) => item.id), [record(9).id]);
  controller.dispose();
});

test("Geçmiş controller: yenileme eski sayfalama yanıtını iptal eder ve yeni listeyi korur", async () => {
  const pending = deferred<HistoryPageResult>();
  let calls = 0;
  let moreSignal: AbortSignal | undefined;
  const controller = createHistoryController(service({ list: async (_user, _cursor, signal) => {
    calls++;
    if (calls === 1) return page([record(5)], true);
    if (calls === 2) { moreSignal = signal; return pending.promise; }
    return page([record(10)]);
  } }), userA);
  await controller.start();
  const more = controller.loadMore();
  await controller.reload();
  pending.resolve(page([record(4)]));
  await more;
  assert.equal(moreSignal?.aborted, true);
  assert.deepEqual(controller.getSnapshot().items.map((item) => item.id), [record(10).id]);
  assert.equal(controller.getSnapshot().loadingMore, false);
  controller.dispose();
});

test("Geçmiş controller: sayfa hatası güvenli Türkçe gösterilir, yeniden deneme çalışır", async () => {
  let calls = 0;
  const controller = createHistoryController(service({ list: async () => {
    if (++calls === 1) throw new Error("private SQL server token detail");
    return page([record(1)]);
  } }), userA);
  await controller.start();
  assert.equal(controller.getSnapshot().error, historyErrorMessage(new HistoryError("SERVICE_ERROR")));
  assert.doesNotMatch(controller.getSnapshot().error ?? "", /private|SQL|token/);
  assert.equal(controller.getSnapshot().loading, false);
  await controller.reload();
  assert.equal(controller.getSnapshot().error, null);
  assert.equal(controller.getSnapshot().items.length, 1);
  controller.dispose();
});

test("Geçmiş controller: sayfalama hatası önceki kayıtları korur ve tekrar denenebilir", async () => {
  let calls = 0;
  const controller = createHistoryController(service({ list: async () => {
    calls++;
    if (calls === 1) return page([record(3)], true);
    if (calls === 2) throw new HistoryError("NETWORK_ERROR");
    return page([record(2)]);
  } }), userA);
  await controller.start();
  await controller.loadMore();
  assert.equal(controller.getSnapshot().items.length, 1);
  assert.ok(controller.getSnapshot().nextCursor);
  assert.equal(controller.getSnapshot().loadingMore, false);
  await controller.loadMore();
  assert.equal(controller.getSnapshot().items.length, 2);
  assert.equal(controller.getSnapshot().error, null);
  controller.dispose();
});

test("Geçmiş controller: hesap değişiminde eski liste temizlenir ve geç yanıt yeni hesaba taşınmaz", async () => {
  const old = deferred<HistoryPageResult>();
  let oldSignal: AbortSignal | undefined;
  const oldController = createHistoryController(service({ list: async (_user, _cursor, signal) => {
    oldSignal = signal;
    return old.promise;
  } }), userA);
  const first = oldController.start();
  oldController.dispose();
  const nextController = createHistoryController(service({ list: async (user) => {
    assert.equal(user, userB);
    return page([record(8)]);
  } }), userB);
  assert.deepEqual(nextController.getSnapshot().items, []);
  await nextController.start();
  old.resolve(page([record(1)]));
  await first;
  assert.equal(oldSignal?.aborted, true);
  assert.deepEqual(oldController.getSnapshot().items, []);
  assert.deepEqual(nextController.getSnapshot().items.map((item) => item.id), [record(8).id]);
  nextController.dispose();
});

test("Geçmiş controller: StrictMode temizleme ve yeniden başlatma eski isteği geri getirmez", async () => {
  const stale = deferred<HistoryPageResult>();
  let calls = 0;
  const controller = createHistoryController(service({ list: async () => ++calls === 1 ? stale.promise : page([record(2)]) }), userA);
  const first = controller.start();
  controller.dispose();
  await controller.start();
  stale.resolve(page([record(1)]));
  await first;
  assert.deepEqual(controller.getSnapshot().items.map((item) => item.id), [record(2).id]);
  controller.dispose();
});

test("Geçmiş controller: oturumsuz veya kapatılmış scope hiçbir okuma/silme başlatmaz", async () => {
  let calls = 0;
  const api = service({ list: async () => { calls++; return page([]); }, remove: async () => { calls++; } });
  const controller = createHistoryController(api, "");
  await controller.start();
  await controller.reload();
  await controller.loadMore();
  assert.equal(await controller.remove(record(1).id), false);
  controller.dispose();
  assert.equal(await controller.remove(record(1).id), false);
  assert.equal(calls, 0);
});

test("Geçmiş controller: süresi dolmuş oturum önceki kayıtları temizler", async () => {
  let calls = 0;
  const controller = createHistoryController(service({ list: async () => {
    if (++calls === 1) return page([record(3)], true);
    throw new HistoryError("UNAUTHORIZED");
  } }), userA);
  await controller.start();
  await controller.loadMore();
  assert.deepEqual(controller.getSnapshot().items, []);
  assert.equal(controller.getSnapshot().detail, null);
  assert.equal(controller.getSnapshot().nextCursor, null);
  assert.equal(controller.getSnapshot().loadingMore, false);
  assert.equal(controller.getSnapshot().error, historyErrorMessage(new HistoryError("UNAUTHORIZED")));
  controller.dispose();
});

test("Geçmiş controller: yetkisiz okuma bekleyen silmeyi iptal eder ve geç başarıyı reddeder", async () => {
  const target = record(7);
  const pending = deferred<void>();
  let calls = 0;
  let deleteSignal: AbortSignal | undefined;
  const controller = createHistoryController(service({
    list: async () => {
      if (++calls === 1) return page([target]);
      throw new HistoryError("UNAUTHORIZED");
    },
    remove: async (_user, _id, signal) => { deleteSignal = signal; await pending.promise; },
  }), userA);
  await controller.start();
  const removing = controller.remove(target.id);
  await controller.reload();
  assert.equal(deleteSignal?.aborted, true);
  assert.deepEqual(controller.getSnapshot().items, []);
  pending.resolve();
  assert.equal(await removing, false);
  assert.deepEqual(controller.getSnapshot().items, []);
  assert.equal(controller.getSnapshot().deletingId, null);
  controller.dispose();
});

test("Geçmiş controller: detay yalnız URL kimliğini sorgular; liste servisi çağrılmaz", async () => {
  const target = record(7);
  let reads = 0;
  const controller = createHistoryController(service({
    list: async () => assert.fail("Detail must not fetch all records"),
    get: async (user, id) => { reads++; assert.equal(user, userA); assert.equal(id, target.id); return target; },
  }), userA, target.id);
  await controller.start();
  assert.deepEqual(controller.getSnapshot().detail, target);
  await controller.loadMore();
  assert.equal(reads, 1);
  controller.dispose();
});

test("Geçmiş controller: bulunamayan detay ve yeni rota eski detay göstermeden yönetilir", async () => {
  const target = record(7);
  const oldController = createHistoryController(service({ get: async () => target }), userA, target.id);
  await oldController.start();
  oldController.dispose();
  const next = createHistoryController(service(), userA, record(8).id);
  assert.equal(next.getSnapshot().detail, null);
  await next.start();
  assert.equal(next.getSnapshot().detail, null);
  assert.equal(next.getSnapshot().error, historyErrorMessage(new HistoryError("NOT_FOUND")));
  assert.equal(next.getSnapshot().loading, false);
  next.dispose();
});

test("Geçmiş controller: ters sırada dönen detay yenilemesinde son istek kazanır", async () => {
  const first = deferred<HistoryRecord>();
  let calls = 0;
  const target = record(7);
  const updated = { ...target, analysis: { ...target.analysis, description: "Yeni doğrulanmış yanıt." } };
  const controller = createHistoryController(service({ get: async () => ++calls === 1 ? first.promise : updated }), userA, target.id);
  const old = controller.start();
  await controller.reload();
  first.resolve(target);
  await old;
  assert.deepEqual(controller.getSnapshot().detail, updated);
  controller.dispose();
});

test("Geçmiş controller: silme başarısızlığı kaydı korur ve ayrı hata gösterir", async () => {
  const target = record(7);
  let calls = 0;
  const controller = createHistoryController(service({ list: async () => page([target]), remove: async () => {
    if (++calls === 1) throw new Error("secret provider detail");
  } }), userA);
  await controller.start();
  assert.equal(await controller.remove(target.id), false);
  assert.deepEqual(controller.getSnapshot().items, [target]);
  assert.equal(controller.getSnapshot().error, null);
  assert.ok(controller.getSnapshot().deleteError);
  assert.doesNotMatch(controller.getSnapshot().deleteError ?? "", /secret|provider/);
  controller.clearDeleteError();
  assert.equal(controller.getSnapshot().deleteError, null);
  assert.equal(await controller.remove(target.id), true);
  assert.deepEqual(controller.getSnapshot().items, []);
  controller.dispose();
});

test("Geçmiş controller: yetkisiz silme kişisel veriyi temizler ve sayfa hatasını da görünür bırakır", async () => {
  const target = record(7);
  const controller = createHistoryController(service({
    get: async () => target,
    remove: async () => { throw new HistoryError("UNAUTHORIZED"); },
  }), userA, target.id);
  await controller.start();
  assert.equal(await controller.remove(target.id), false);
  assert.equal(controller.getSnapshot().detail, null);
  assert.deepEqual(controller.getSnapshot().items, []);
  assert.equal(controller.getSnapshot().error, historyErrorMessage(new HistoryError("UNAUTHORIZED")));
  assert.equal(controller.getSnapshot().deleteError, historyErrorMessage(new HistoryError("UNAUTHORIZED")));
  assert.equal(controller.getSnapshot().deletingId, null);
  controller.dispose();
});

test("Geçmiş controller: çift silme tek DELETE yapar; görünmeyen kimliği silmez", async () => {
  const target = record(7);
  const pending = deferred<void>();
  let calls = 0;
  const controller = createHistoryController(service({ list: async () => page([target]), remove: async (user, id) => {
    calls++; assert.equal(user, userA); assert.equal(id, target.id); await pending.promise;
  } }), userA);
  await controller.start();
  assert.equal(await controller.remove(record(99).id), false);
  const first = controller.remove(target.id);
  assert.equal(controller.getSnapshot().deletingId, target.id);
  assert.equal(await controller.remove(target.id), false);
  pending.resolve();
  assert.equal(await first, true);
  assert.equal(calls, 1);
  assert.equal(controller.getSnapshot().deletingId, null);
  controller.dispose();
});

test("Geçmiş controller: hesap/rota kapandıktan sonra geç silme yanıtı başarılı navigasyon başlatamaz", async () => {
  const target = record(7);
  const pending = deferred<void>();
  let signal: AbortSignal | undefined;
  const controller = createHistoryController(service({ get: async () => target, remove: async (_user, _id, abort) => {
    signal = abort; await pending.promise;
  } }), userA, target.id);
  await controller.start();
  const deleting = controller.remove(target.id);
  controller.dispose();
  pending.resolve();
  assert.equal(await deleting, false);
  assert.equal(signal?.aborted, true);
  assert.equal(controller.getSnapshot().detail, null);
  assert.equal(controller.getSnapshot().deleteError, null);
});

test("Geçmiş controller: başarılı silme bekleyen eski yenilemeyle listede geri belirmez", async () => {
  const target = record(7);
  const stale = deferred<HistoryPageResult>();
  let calls = 0;
  const controller = createHistoryController(service({ list: async () => ++calls === 1 ? page([target]) : stale.promise }), userA);
  await controller.start();
  const refresh = controller.reload();
  assert.equal(await controller.remove(target.id), true);
  stale.resolve(page([target]));
  await refresh;
  assert.deepEqual(controller.getSnapshot().items, []);
  controller.dispose();
});

test("Geçmiş controller: detay silme hatası detay verisini korur, başarı detay verisini temizler", async () => {
  const target = record(7);
  let calls = 0;
  const controller = createHistoryController(service({ get: async () => target, remove: async () => {
    if (++calls === 1) throw new HistoryError("NETWORK_ERROR");
  } }), userA, target.id);
  await controller.start();
  assert.equal(await controller.remove(target.id), false);
  assert.deepEqual(controller.getSnapshot().detail, target);
  assert.equal(await controller.remove(target.id), true);
  assert.equal(controller.getSnapshot().detail, null);
  controller.dispose();
});

test("Geçmiş controller: abonelik temizleme ve dispose kişisel belleği boşaltır", async () => {
  const controller = createHistoryController(service({ list: async () => page([record(1)]) }), userA);
  let notices = 0;
  const unsubscribe = controller.subscribe(() => { notices++; });
  await controller.start();
  assert.ok(notices > 0);
  unsubscribe();
  const previous = notices;
  controller.dispose();
  assert.equal(notices, previous);
  assert.deepEqual(controller.getSnapshot().items, []);
  assert.equal(controller.getSnapshot().detail, null);
});
