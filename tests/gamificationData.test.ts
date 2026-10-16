import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGamificationDataService, GamificationError, GAMIFICATION_TIMEOUT_MS,
  getLevelProgress, normalizeNickname, nicknameKey, parseGameProfile, parseGameArena,
  validateProfilePreferences, validateArenaOffset, gamificationErrorMessage,
  type GameProfile, type GameArena, type ArenaEntry, type GamificationDataPort, type GamificationRpcResult,
} from "../src/services/gamificationData.ts";
import type { HistoryAuthPort } from "../src/services/historyData.ts";

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const signal = () => new AbortController().signal;
const code = (value: string) => (reason: unknown) => reason instanceof GamificationError && reason.code === value;
function profile(totalXp = 200, nickname: string | null = "Isik", arenaOptIn = false): GameProfile {
  const awardedAnalyses = totalXp ? Math.ceil(totalXp / 300) : 0;
  return { version: 1, nickname, arenaOptIn, totalXp, ...getLevelProgress(totalXp), rank: arenaOptIn ? 1 : null,
    badges: totalXp >= 1000 ? ["first_recognition", "green_pioneer"] : totalXp ? ["first_recognition"] : [],
    awardedAnalyses, dailySlotsUsed: Math.min(3, awardedAnalyses) };
}
function arena(total = 24, offset = 0, myRank: number | null = 2): GameArena {
  const all: ArenaEntry[] = Array.from({ length: total }, (_value, index) => {
    const rank = index + 1, totalXp = (total - rank) * 50, projection = getLevelProgress(totalXp);
    return { rank, nickname: `User${rank.toString().padStart(3, "0")}`, totalXp,
      level: projection.level, levelTitle: projection.levelTitle, isMe: rank === myRank };
  });
  return { version: 1, podium: all.slice(0, 3), entries: all.slice(offset, offset + 20),
    myRank, offset, nextOffset: offset + 20 < total ? offset + 20 : null, totalParticipants: total,
    fetchedAt: "2026-10-16T12:00:00.000001Z" };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
type Session = NonNullable<Awaited<ReturnType<HistoryAuthPort["getSession"]>>["data"]["session"]>;
function harness(overrides: Partial<GamificationDataPort> = {}) {
  let session: Session | null = { access_token: "unit-only-not-a-real-token", expires_at: 4600, user: { id: userA } };
  const listeners = new Set<Parameters<HistoryAuthPort["onAuthStateChange"]>[0]>();
  const calls = { rpc: 0, subscribe: 0, unsubscribe: 0 };
  const commands: unknown[] = [];
  const service = createGamificationDataService({
    configured: true, nowSeconds: () => 1000,
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange(callback) {
        calls.subscribe++; listeners.add(callback);
        return { data: { subscription: { unsubscribe() { calls.unsubscribe++; listeners.delete(callback); } } } };
      },
    },
    async rpc(command, requestSignal) {
      calls.rpc++; commands.push(command);
      if (overrides.rpc) return overrides.rpc(command, requestSignal);
      return { error: null, data: command.kind === "arena" ? arena(24, command.offset) : command.kind === "save"
        ? profile(200, command.preferences.nickname, command.preferences.arenaOptIn) : profile() };
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "rpc")),
  });
  return {
    service, calls, commands,
    setSession(value: Session | null) { session = value; },
    emit(event: string, value: Session | null) { for (const callback of listeners) callback(event, value); },
  };
}

test("Oyunlaştırma: seviye eşiklerinin altı/eşiti/üstü ve en yüksek seviye tutarlıdır", () => {
  const thresholds = [0, 100, 250, 500, 1000, 1750, 2750, 4000];
  thresholds.forEach((floor, index) => {
    assert.equal(getLevelProgress(floor).level, index + 1);
    assert.equal(getLevelProgress(floor + 1).level, index + 1);
    if (index) assert.equal(getLevelProgress(floor - 1).level, index);
  });
  assert.deepEqual(getLevelProgress(200), { level: 2, levelTitle: "Geri Dönüşüm Çırağı", levelFloor: 100,
    nextLevelXp: 250, remainingXp: 50, progress: 66.67 });
  for (const xp of [4000, 8000]) assert.deepEqual(getLevelProgress(xp), {
    level: 8, levelTitle: "Çevre Şampiyonu", levelFloor: 4000, nextLevelXp: null, remainingXp: 0, progress: 100,
  });
  for (const xp of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => getLevelProgress(xp), code("INVALID_DATA"));
});

test("Oyunlaştırma: Türkçe/NFC takma ad normalizasyonu SQL anahtarıyla uyumludur", () => {
  assert.equal(normalizeNickname("  Işık_21  "), "Işık_21");
  assert.equal(normalizeNickname("I\u0307pek"), "İpek");
  assert.equal(nicknameKey("Işık"), nicknameKey("ISIK"));
  assert.equal(nicknameKey("ÇĞİÖŞÜçğıöşü"), "cgiosucgiosu");
  for (const nickname of ["ab", "1abc", "a".repeat(25), "Ad Soyad", "<Ad>", "a@b", "a.b", "a-b", "A\u200Bb", "A\u202Eb", "A😀bc", "Ábc"])
    assert.throws(() => normalizeNickname(nickname), code("INVALID_NICKNAME"));
});

test("Oyunlaştırma: tercihler yalnız takma ad ve açık boolean katılım kabul eder", () => {
  assert.deepEqual(validateProfilePreferences({ nickname: "  I\u0307pek ", arenaOptIn: true }), { nickname: "İpek", arenaOptIn: true });
  assert.deepEqual(validateProfilePreferences({ nickname: "", arenaOptIn: false }), { nickname: null, arenaOptIn: false });
  for (const value of [{ nickname: null, arenaOptIn: true }, { nickname: "Isik", arenaOptIn: "true" },
    { nickname: "Isik", arenaOptIn: false, totalXp: 9999 }, null])
    assert.throws(() => validateProfilePreferences(value), code("INVALID_NICKNAME"));
});

test("Oyunlaştırma: sunucunun doğruladığı boş profil ile eksik altyapı aynı değildir", () => {
  assert.deepEqual(parseGameProfile(profile(0, null)), profile(0, null));
  for (const value of [null, {}, [], { ...profile(), totalXp: undefined }])
    assert.throws(() => parseGameProfile(value), code("INVALID_DATA"));
});

test("Oyunlaştırma: profil DTO'su fazladan kimlik alanı, yanlış seviye ve ilerlemeyi reddeder", () => {
  for (const change of [{ user_id: userA }, { email: "private@example.invalid" }, { progress: 66.66 },
    { level: 3 }, { levelTitle: "Yanlış" }, { remainingXp: 0 }, { nextLevelXp: 500 }, { version: 2 },
    { nickname: " Isik" }, { arenaOptIn: true, rank: null }, { rank: 1 }])
    assert.throws(() => parseGameProfile({ ...profile(), ...change }), code("INVALID_DATA"));
});

test("Oyunlaştırma: rozet, puanlı kayıt ve kullanılan günlük slot tutarlılığı doğrulanır", () => {
  assert.deepEqual(parseGameProfile(profile(1000)).badges, ["first_recognition", "green_pioneer"]);
  for (const change of [{ awardedAnalyses: 0 }, { dailySlotsUsed: 4 }, { badges: [] },
    { badges: ["first_recognition", "first_recognition"] }, { badges: ["first_recognition", "category_explorer"] },
    { badges: ["first_recognition", "green_pioneer"] }, { totalXp: 201 }])
    assert.throws(() => parseGameProfile({ ...profile(), ...change }), code("INVALID_DATA"));
  // Slots already consumed by deleted analyses may exceed active award count.
  assert.equal(parseGameProfile({ ...profile(0, null), dailySlotsUsed: 3 }).dailySlotsUsed, 3);
});

test("Oyunlaştırma: arena sıfır/tek/çok katılımcı ve sonraki sayfayı doğru doğrular", () => {
  for (const value of [arena(0, 0, null), arena(1, 0, 1), arena(), arena(24, 20)])
    assert.deepEqual(parseGameArena(value, value.offset), value);
  for (const offset of [-1, 1, 19, 21, 0.5, Infinity, 2_147_483_660])
    assert.throws(() => validateArenaOffset(offset), code("INVALID_PAGE"));
});

test("Oyunlaştırma: arena özel alan, yanlış sıra/sayfa ve isMe uyuşmazlığını reddeder", () => {
  for (const value of [
    { ...arena(), user_id: userA }, { ...arena(), nextOffset: null }, { ...arena(), offset: 20 },
    { ...arena(), myRank: 0 }, { ...arena(), totalParticipants: 1 }, { ...arena(), fetchedAt: "2026-02-30T00:00:00Z" },
    { ...arena(), entries: arena().entries.map((entry, index) => index ? entry : { ...entry, email: "hidden@example.invalid" }) },
    { ...arena(), podium: arena().podium.map((entry, index) => index === 1 ? { ...entry, isMe: false } : entry) },
    { ...arena(), entries: arena().entries.map((entry, index) => index === 4 ? { ...entry, rank: 99 } : entry) },
  ]) assert.throws(() => parseGameArena(value, 0), code("INVALID_DATA"));
});

test("Oyunlaştırma: eşit XP'de kanonik takma ad sırası ve podium/page snapshot tutarlıdır", () => {
  const tied = arena(3, 0, null);
  const rows = ["Alpha", "Beta", "Gamma"].map((nickname, index) => ({ rank: index + 1, nickname, totalXp: 200,
    level: 2, levelTitle: "Geri Dönüşüm Çırağı", isMe: false }));
  tied.podium = rows; tied.entries = rows;
  assert.deepEqual(parseGameArena(tied, 0), tied);
  const swapped = rows.map((row, index) => ({ ...row, nickname: index === 0 ? "Beta" : index === 1 ? "Alpha" : "Gamma" }));
  assert.throws(() => parseGameArena({ ...tied, podium: swapped, entries: swapped }, 0), code("INVALID_DATA"));
  assert.throws(() => parseGameArena({ ...tied, entries: rows.map((row, index) => index ? row : { ...row, totalXp: 250, level: 3, levelTitle: "Çevre Dostu" }) }, 0), code("INVALID_DATA"));
});

test("Oyunlaştırma: profil/arena mevcut oturumla okunur; RPC komutları kullanıcı kimliği taşımaz", async () => {
  const run = harness();
  assert.equal((await run.service.getProfile(userA, signal())).totalXp, 200);
  assert.equal((await run.service.listArena(userA, 20, signal())).offset, 20);
  assert.deepEqual(run.commands, [{ kind: "profile" }, { kind: "arena", offset: 20 }]);
  assert.equal(run.calls.subscribe, 2);
  assert.equal(run.calls.unsubscribe, 2);
});

test("Oyunlaştırma: eksik, süresi dolmuş, anonim veya farklı hesap RPC çağrılmaz", async () => {
  for (const session of [null,
    { access_token: "unit", expires_at: 1000, user: { id: userA } },
    { access_token: "unit", expires_at: 4600, user: { id: userB } },
    { access_token: "unit", expires_at: 4600, user: { id: userA, is_anonymous: true } },
    { access_token: "", expires_at: 4600, user: { id: userA } }]) {
    const run = harness(); run.setSession(session);
    await assert.rejects(run.service.getProfile(userA, signal()), code("UNAUTHORIZED"));
    assert.equal(run.calls.rpc, 0);
    assert.equal(run.calls.unsubscribe, 1);
  }
});

test("Oyunlaştırma: yapılandırma, offline ve önceden iptal edilmiş istek RPC başlatmaz", async () => {
  const aborted = new AbortController(); aborted.abort();
  for (const [overrides, requestSignal, expected] of [
    [{ configured: false }, signal(), "NOT_CONFIGURED"], [{ auth: null }, signal(), "UNAUTHORIZED"],
    [{ online: () => false }, signal(), "NETWORK_ERROR"], [{}, aborted.signal, "CANCELLED"],
  ] as const) {
    const run = harness(overrides);
    await assert.rejects(run.service.getProfile(userA, requestSignal), code(expected));
    assert.equal(run.calls.rpc, 0);
  }
});

test("Oyunlaştırma: canlıya alınmamış RPC sıfır puana çevrilmeden NOT_DEPLOYED döner", async () => {
  const run = harness({ rpc: async () => ({ data: null, error: { code: "PGRST202", details: "private SQL" }, status: 404 }) });
  await assert.rejects(run.service.getProfile(userA, signal()), code("NOT_DEPLOYED"));
  assert.doesNotMatch(gamificationErrorMessage(new GamificationError("NOT_DEPLOYED")), /private SQL/);
});

test("Oyunlaştırma: SQL kimlik/yetki ve takma ad çakışması güvenli Türkçe koda çevrilir", async () => {
  for (const [sqlCode, expected] of [["28000", "UNAUTHORIZED"], ["42501", "UNAUTHORIZED"],
    ["23505", "NICKNAME_TAKEN"], ["22023", "INVALID_NICKNAME"], ["unknown", "SERVICE_ERROR"]]) {
    const run = harness({ rpc: async () => ({ data: null, error: { code: sqlCode, message: "hidden token SQL details" }, status: 400 }) });
    await assert.rejects(run.service.saveProfile(userA, { nickname: "Isik", arenaOptIn: false }, signal()), code(expected));
  }
});

test("Oyunlaştırma: kayıt yalnız izinli tercihleri yollar ve dönen tercihleri karşılaştırır", async () => {
  const run = harness();
  assert.equal((await run.service.saveProfile(userA, { nickname: " I\u0307pek ", arenaOptIn: true }, signal())).nickname, "İpek");
  assert.deepEqual(run.commands, [{ kind: "save", preferences: { nickname: "İpek", arenaOptIn: true } }]);
  const stale = harness({ rpc: async () => ({ data: profile(), error: null }) });
  await assert.rejects(stale.service.saveProfile(userA, { nickname: "Baska", arenaOptIn: true }, signal()), code("INVALID_DATA"));
});

test("Oyunlaştırma: eşzamanlı profil kayıtları kuyruğa alınmadan BUSY ile reddedilir", async () => {
  const wait = deferred<GamificationRpcResult>();
  const run = harness({ rpc: async () => wait.promise });
  const first = run.service.saveProfile(userA, { nickname: "Isik", arenaOptIn: false }, signal());
  await assert.rejects(run.service.saveProfile(userA, { nickname: "Baska", arenaOptIn: true }, signal()), code("BUSY"));
  await assert.rejects(run.service.saveProfile(userB, { nickname: "Baska", arenaOptIn: true }, signal()), code("BUSY"));
  wait.resolve({ data: profile(), error: null });
  await first;
  assert.equal(run.calls.rpc, 1);
});

test("Oyunlaştırma: çıkış/hesap değişiminde abort'u yok sayan geç RPC yanıtı reddedilir", async () => {
  for (const event of ["SIGNED_OUT", "PASSWORD_RECOVERY", "SIGNED_IN"]) {
    const pending = deferred<GamificationRpcResult>();
    const started = deferred<void>();
    let requestSignal: AbortSignal | undefined;
    const run = harness({ rpc: async (_command, abort) => { requestSignal = abort; started.resolve(); return pending.promise; } });
    const reading = run.service.getProfile(userA, signal());
    await started.promise;
    run.emit(event, event === "SIGNED_IN" ? { access_token: "other", expires_at: 4600, user: { id: userB } } : null);
    pending.resolve({ data: profile(), error: null });
    await assert.rejects(reading, code("UNAUTHORIZED"));
    assert.equal(requestSignal?.aborted, true);
    assert.equal(run.calls.unsubscribe, 1);
  }
});

test("Oyunlaştırma: sessiz oturum değişimi RPC sonrasında tekrar doğrulanır", async () => {
  const run = harness({ rpc: async () => {
    run.setSession({ access_token: "other", expires_at: 4600, user: { id: userB } });
    return { data: profile(), error: null };
  } });
  await assert.rejects(run.service.getProfile(userA, signal()), code("UNAUTHORIZED"));
});

test("Oyunlaştırma: opt-out kaydı önce başlamış arena yanıtını geçersiz kılar", async () => {
  const pending = deferred<GamificationRpcResult>();
  const started = deferred<void>();
  const run = harness({ rpc: async (command) => {
    if (command.kind === "arena") { started.resolve(); return pending.promise; }
    return { data: profile(), error: null };
  } });
  const reading = run.service.listArena(userA, 0, signal());
  await started.promise;
  await run.service.saveProfile(userA, { nickname: "Isik", arenaOptIn: false }, signal());
  pending.resolve({ data: arena(), error: null });
  await assert.rejects(reading, code("CANCELLED"));
});

test("Oyunlaştırma: RPC zaman aşımı kilidi serbest bırakır; ham hata dışarı taşınmaz", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const started = deferred<void>();
  let first = true;
  const run = harness({ rpc: async () => {
    if (first) { first = false; started.resolve(); return new Promise(() => {}); }
    return { data: profile(), error: null };
  } });
  const saving = run.service.saveProfile(userA, { nickname: "Isik", arenaOptIn: false }, signal());
  const check = assert.rejects(saving, code("TIMEOUT"));
  await started.promise;
  t.mock.timers.tick(GAMIFICATION_TIMEOUT_MS);
  await check;
  assert.equal((await run.service.saveProfile(userA, { nickname: "Isik", arenaOptIn: false }, signal())).totalXp, 200);
  assert.equal(gamificationErrorMessage(new Error("private secret")), gamificationErrorMessage(new GamificationError("SERVICE_ERROR")));
});
