import { test } from "node:test";
import assert from "node:assert/strict";
import { createGamificationController } from "../src/services/gamificationController.ts";
import { GamificationError, gamificationErrorMessage, getLevelProgress,
  type GameProfile, type GameArena, type GamificationService } from "../src/services/gamificationData.ts";

// These fixtures never reach the app's real SDK or database.
const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
function profile(nickname = "Isik", arenaOptIn = false): GameProfile {
  return { version: 1, nickname, arenaOptIn, totalXp: 200, ...getLevelProgress(200), rank: arenaOptIn ? 1 : null,
    badges: ["first_recognition"], awardedAnalyses: 1, dailySlotsUsed: 1 };
}
function arena(offset = 0): GameArena {
  return { version: 1, podium: [], entries: [], myRank: null, offset, nextOffset: null, totalParticipants: 0,
    fetchedAt: "2026-10-16T12:00:00.000000Z" };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}
const flush = () => Promise.resolve();
function service(overrides: Partial<GamificationService> = {}): GamificationService {
  return {
    getProfile: async () => profile(),
    saveProfile: async (_user, preferences) => profile(preferences.nickname ?? "", preferences.arenaOptIn),
    listArena: async (_user, offset) => arena(offset),
    ...overrides,
  };
}

test("Oyunlaştırma controller: profil yüklenirken puan uydurmaz, doğrulanmış yanıtı bekler", async () => {
  const pending = deferred<GameProfile>();
  let calls = 0;
  const controller = createGamificationController(service({ getProfile: async (user) => {
    assert.equal(user, userA); calls++; return pending.promise;
  } }), userA, "profile");
  const first = controller.start();
  const second = controller.start();
  assert.equal(controller.getSnapshot().profile, null);
  assert.equal(controller.getSnapshot().loading, true);
  pending.resolve(profile());
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(controller.getSnapshot().profile, profile());
  assert.equal(controller.getSnapshot().arena, null);
  controller.dispose();
});

test("Oyunlaştırma controller: eksik canlı RPC sıfır XP yerine açık altyapı hatası gösterir", async () => {
  const controller = createGamificationController(service({ getProfile: async () => { throw new GamificationError("NOT_DEPLOYED"); } }), userA, "profile");
  await controller.start();
  assert.equal(controller.getSnapshot().profile, null);
  assert.equal(controller.getSnapshot().loading, false);
  assert.equal(controller.getSnapshot().error, gamificationErrorMessage(new GamificationError("NOT_DEPLOYED")));
  controller.dispose();
});

test("Oyunlaştırma controller: art arda odak/yenileme istekleri birleşir", async () => {
  const pending = deferred<GameProfile>();
  let calls = 0;
  const controller = createGamificationController(service({ getProfile: async () => { calls++; return pending.promise; } }), userA, "profile");
  const first = controller.start();
  const other = controller.reload();
  pending.resolve(profile());
  await Promise.all([first, other]);
  assert.equal(calls, 1);
  controller.dispose();
});

test("Oyunlaştırma controller: arena sayfaları değiştirilir, yenileme ilk sayfaya döner", async () => {
  const offsets: number[] = [];
  const controller = createGamificationController(service({ listArena: async (user, offset) => {
    assert.equal(user, userA); offsets.push(offset); return arena(offset);
  } }), userA, "arena");
  await controller.start();
  await controller.loadPage(20);
  assert.equal(controller.getSnapshot().arena?.offset, 20);
  await controller.reload();
  assert.equal(controller.getSnapshot().arena?.offset, 0);
  assert.deepEqual(offsets, [0, 20, 0]);
  controller.dispose();
});

test("Oyunlaştırma controller: geç eski arena sayfası yeni sayfanın üzerine yazamaz", async () => {
  const first = deferred<GameArena>();
  const latest = deferred<GameArena>();
  const signals: AbortSignal[] = [];
  const controller = createGamificationController(service({ listArena: async (_user, offset, signal) => {
    signals.push(signal); return offset === 0 ? first.promise : latest.promise;
  } }), userA, "arena");
  const initial = controller.start(); await flush();
  const next = controller.loadPage(20); await flush();
  latest.resolve(arena(20)); await next;
  first.resolve(arena(0)); await initial;
  assert.equal(signals[0].aborted, true);
  assert.equal(controller.getSnapshot().arena?.offset, 20);
  controller.dispose();
});

test("Oyunlaştırma controller: hesap değişimi eski profil yanıtını ve belleği bırakmaz", async () => {
  const pending = deferred<GameProfile>();
  let signal: AbortSignal | undefined;
  const previous = createGamificationController(service({ getProfile: async (_user, abort) => { signal = abort; return pending.promise; } }), userA, "profile");
  const reading = previous.start(); await flush();
  previous.dispose();
  const next = createGamificationController(service({ getProfile: async (user) => {
    assert.equal(user, userB); return profile("Baska");
  } }), userB, "profile");
  assert.equal(next.getSnapshot().profile, null);
  await next.start();
  pending.resolve(profile()); await reading;
  assert.equal(signal?.aborted, true);
  assert.equal(previous.getSnapshot().profile, null);
  assert.equal(next.getSnapshot().profile?.nickname, "Baska");
  next.dispose();
});

test("Oyunlaştırma controller: StrictMode temizleme/yeniden başlatma geç yanıtı reddeder", async () => {
  const pending = deferred<GameProfile>();
  let calls = 0;
  const controller = createGamificationController(service({ getProfile: async () => ++calls === 1 ? pending.promise : profile("Yenisi") }), userA, "profile");
  const initial = controller.start(); await flush();
  controller.dispose();
  await controller.start();
  pending.resolve(profile("Eskisi")); await initial;
  assert.equal(controller.getSnapshot().profile?.nickname, "Yenisi");
  controller.dispose();
});

test("Oyunlaştırma controller: kayıt hata verirse mevcut profil korunur ve tekrar denenebilir", async () => {
  let saves = 0;
  const controller = createGamificationController(service({ saveProfile: async (_user, preferences) => {
    if (++saves === 1) throw new GamificationError("NICKNAME_TAKEN");
    return profile(preferences.nickname ?? "", preferences.arenaOptIn);
  } }), userA, "profile");
  await controller.start();
  assert.equal(await controller.save({ nickname: "Yeni", arenaOptIn: true }), false);
  assert.equal(controller.getSnapshot().profile?.nickname, "Isik");
  assert.equal(controller.getSnapshot().saving, false);
  assert.equal(controller.getSnapshot().saveError, gamificationErrorMessage(new GamificationError("NICKNAME_TAKEN")));
  assert.equal(await controller.save({ nickname: "Yeni", arenaOptIn: true }), true);
  assert.equal(controller.getSnapshot().profile?.nickname, "Yeni");
  assert.equal(controller.getSnapshot().saveError, null);
  controller.dispose();
});

test("Oyunlaştırma controller: çift kayıt ve kayıt sırasındaki yenileme yeni istek oluşturmaz", async () => {
  const pending = deferred<GameProfile>();
  let saves = 0, reads = 0;
  const controller = createGamificationController(service({ getProfile: async () => { reads++; return profile(); },
    saveProfile: async () => { saves++; return pending.promise; } }), userA, "profile");
  await controller.start();
  const first = controller.save({ nickname: "Yeni", arenaOptIn: true });
  assert.equal(await controller.save({ nickname: "Baska", arenaOptIn: false }), false);
  await controller.reload();
  assert.equal(saves, 1); assert.equal(reads, 1);
  pending.resolve(profile("Yeni", true));
  assert.equal(await first, true);
  assert.equal(controller.getSnapshot().saving, false);
  controller.dispose();
});

test("Oyunlaştırma controller: geç eski hesap kayıt yanıtı başarı mesajı veya yeni hesaba veri taşımaz", async () => {
  const pending = deferred<GameProfile>();
  let signal: AbortSignal | undefined;
  const controller = createGamificationController(service({ saveProfile: async (_user, _preferences, abort) => {
    signal = abort; return pending.promise;
  } }), userA, "profile");
  await controller.start();
  const saving = controller.save({ nickname: "Eski", arenaOptIn: true });
  controller.dispose();
  pending.resolve(profile("Eski", true));
  assert.equal(await saving, false);
  assert.equal(signal?.aborted, true);
  assert.equal(controller.getSnapshot().profile, null);
  assert.equal(controller.getSnapshot().saveError, null);
});

test("Oyunlaştırma controller: yetkisiz kayıt kişisel profili kaldırır ve sayfa/form hatası gösterir", async () => {
  const controller = createGamificationController(service({ saveProfile: async () => { throw new GamificationError("UNAUTHORIZED"); } }), userA, "profile");
  await controller.start();
  assert.equal(await controller.save({ nickname: "Isik", arenaOptIn: false }), false);
  assert.equal(controller.getSnapshot().profile, null);
  assert.equal(controller.getSnapshot().saving, false);
  assert.equal(controller.getSnapshot().error, gamificationErrorMessage(new GamificationError("UNAUTHORIZED")));
  assert.equal(controller.getSnapshot().saveError, controller.getSnapshot().error);
  controller.dispose();
});

test("Oyunlaştırma controller: arena hata/tekrar denemede eski sıralamayı güncelmiş gibi tutmaz", async () => {
  let calls = 0;
  const controller = createGamificationController(service({ listArena: async () => {
    if (++calls === 2) throw new Error("private SQL secret");
    return arena();
  } }), userA, "arena");
  await controller.start();
  await controller.reload();
  assert.equal(controller.getSnapshot().arena, null);
  assert.equal(controller.getSnapshot().error, gamificationErrorMessage(new GamificationError("SERVICE_ERROR")));
  await controller.reload();
  assert.ok(controller.getSnapshot().arena);
  assert.equal(controller.getSnapshot().error, null);
  controller.dispose();
});

test("Oyunlaştırma controller: oturumsuz/disposed/arena scope profil tercihi kaydedemez", async () => {
  let calls = 0;
  const api = service({ saveProfile: async () => { calls++; return profile(); } });
  for (const [user, mode] of [["", "profile"], [userA, "arena"]] as const) {
    const controller = createGamificationController(api, user, mode);
    await controller.start();
    assert.equal(await controller.save({ nickname: "Isik", arenaOptIn: true }), false);
    controller.dispose();
    assert.equal(await controller.save({ nickname: "Isik", arenaOptIn: true }), false);
  }
  assert.equal(calls, 0);
});

test("Oyunlaştırma controller: abonelik temizleme ve dispose profil/arena belleğini boşaltır", async () => {
  const controller = createGamificationController(service(), userA, "profile");
  let events = 0;
  const unsubscribe = controller.subscribe(() => { events++; });
  await controller.start();
  assert.ok(events > 0);
  unsubscribe(); const before = events;
  controller.dispose();
  assert.equal(events, before);
  assert.equal(controller.getSnapshot().profile, null);
  assert.equal(controller.getSnapshot().arena, null);
});
