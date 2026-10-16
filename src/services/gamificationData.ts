import { UUID_PATTERN } from "../../supabase/functions/_shared/analysis.ts";
import type { HistoryAuthPort } from "./historyData.ts";

export const LEVELS = [
  { level: 1, title: "Doğa Meraklısı", floor: 0 },
  { level: 2, title: "Geri Dönüşüm Çırağı", floor: 100 },
  { level: 3, title: "Çevre Dostu", floor: 250 },
  { level: 4, title: "Eko Kaşif", floor: 500 },
  { level: 5, title: "Yeşil Öncü", floor: 1000 },
  { level: 6, title: "Doğa Koruyucusu", floor: 1750 },
  { level: 7, title: "Sürdürülebilirlik Elçisi", floor: 2750 },
  { level: 8, title: "Çevre Şampiyonu", floor: 4000 },
] as const;
export const BADGES = ["first_recognition", "category_explorer", "green_pioneer"] as const;
export type BadgeId = typeof BADGES[number];
export const ARENA_PAGE_SIZE = 20;
export interface ProfilePreferences { nickname: string | null; arenaOptIn: boolean }
export interface GameProfile extends ProfilePreferences {
  version: 1;
  totalXp: number;
  level: number;
  levelTitle: string;
  levelFloor: number;
  nextLevelXp: number | null;
  remainingXp: number;
  progress: number;
  rank: number | null;
  badges: BadgeId[];
  awardedAnalyses: number;
  dailySlotsUsed: number;
}
export type GamificationProfile = GameProfile;
export interface ArenaEntry {
  rank: number;
  nickname: string;
  totalXp: number;
  level: number;
  levelTitle: string;
  isMe: boolean;
}
export interface GameArena {
  version: 1;
  podium: ArenaEntry[];
  entries: ArenaEntry[];
  myRank: number | null;
  offset: number;
  nextOffset: number | null;
  totalParticipants: number;
  fetchedAt: string;
}
export interface GamificationService {
  getProfile(userId: string, signal: AbortSignal): Promise<GameProfile>;
  saveProfile(userId: string, preferences: ProfilePreferences, signal: AbortSignal): Promise<GameProfile>;
  listArena(userId: string, offset: number, signal: AbortSignal): Promise<GameArena>;
}

const MESSAGES = {
  UNAUTHORIZED: "Oturumun doğrulanamadı veya değişti. Yeniden giriş yap.",
  NOT_CONFIGURED: "Profil ve Eko Arena bağlantısı henüz yapılandırılmadı.",
  NOT_DEPLOYED: "Profil ve Eko Arena altyapısı henüz canlıya alınmadı. Şu anda puan veya sıralama gösterilemiyor.",
  INVALID_DATA: "Profil veya sıralama verileri doğrulanamadı. Yenileyip tekrar dene.",
  INVALID_NICKNAME: "Takma ad 3–24 karakter olmalı; harfle başlamalı, yalnız Türkçe/Latin harfleri, rakam ve alt çizgi içermelidir.",
  NICKNAME_TAKEN: "Bu takma ad kullanılamıyor. Farklı bir takma ad seç.",
  INVALID_PAGE: "Liderlik sayfası geçersiz. Listeyi yenile.",
  NETWORK_ERROR: "Profil hizmetine ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.",
  SERVICE_ERROR: "Profil işlemi tamamlanamadı. Bir süre sonra tekrar dene.",
  CANCELLED: "Profil veya sıralama isteği iptal edildi.",
  BUSY: "Profil kaydı sürüyor. Tamamlandıktan sonra tekrar dene.",
  TIMEOUT: "Profil işlemi zaman aşımına uğradı. Yenileyerek durumu kontrol et.",
} as const;
export type GamificationErrorCode = keyof typeof MESSAGES;
export class GamificationError extends Error {
  readonly code: GamificationErrorCode;
  constructor(code: GamificationErrorCode) {
    super(MESSAGES[code]);
    this.name = "GamificationError";
    this.code = code;
  }
}
export function gamificationErrorMessage(reason: unknown): string {
  return reason instanceof GamificationError ? MESSAGES[reason.code] : MESSAGES.SERVICE_ERROR;
}
const invalid = (): never => { throw new GamificationError("INVALID_DATA"); };
function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || fields.some((field) => !Object.hasOwn(row, field))) return invalid();
  return row;
}
function integer(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) return invalid();
  return value;
}
function optionalRank(value: unknown): number | null { return value === null ? null : integer(value, 1); }

/** Display normalization only; the database repeats validation and uniqueness. */
export function normalizeNickname(value: string): string {
  if (typeof value !== "string") throw new GamificationError("INVALID_NICKNAME");
  const nickname = value.trim().normalize("NFC");
  if (!/^[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü0-9_]{2,23}$/u.test(nickname))
    throw new GamificationError("INVALID_NICKNAME");
  return nickname;
}
export function nicknameKey(value: string): string {
  return normalizeNickname(value).replace(/[Çç]/g, "c").replace(/[Ğğ]/g, "g")
    .replace(/[İIı]/g, "i").replace(/[Öö]/g, "o").replace(/[Şş]/g, "s")
    .replace(/[Üü]/g, "u").toLowerCase();
}
function outputNickname(value: unknown): string {
  if (typeof value !== "string") return invalid();
  try { if (normalizeNickname(value) !== value) return invalid(); }
  catch { return invalid(); }
  return value;
}
export function validateProfilePreferences(value: unknown): ProfilePreferences {
  try {
    const input = object(value, ["nickname", "arenaOptIn"]);
    if (typeof input.arenaOptIn !== "boolean") throw new GamificationError("INVALID_NICKNAME");
    const nickname = input.nickname === null || (typeof input.nickname === "string" && !input.nickname.trim())
      ? null : normalizeNickname(input.nickname as string);
    if (input.arenaOptIn && nickname === null) throw new GamificationError("INVALID_NICKNAME");
    return { nickname, arenaOptIn: input.arenaOptIn };
  } catch (reason) {
    if (reason instanceof GamificationError && reason.code === "INVALID_NICKNAME") throw reason;
    throw new GamificationError("INVALID_NICKNAME");
  }
}
/** Projection verifies a server total; it never awards or writes XP. */
export function getLevelProgress(value: number) {
  const totalXp = integer(value);
  let index = 0;
  while (index + 1 < LEVELS.length && totalXp >= LEVELS[index + 1].floor) index++;
  const current = LEVELS[index];
  const next = LEVELS[index + 1];
  return {
    level: current.level, levelTitle: current.title, levelFloor: current.floor,
    nextLevelXp: next?.floor ?? null,
    remainingXp: next ? next.floor - totalXp : 0,
    progress: next ? Math.round((totalXp - current.floor) / (next.floor - current.floor) * 10_000) / 100 : 100,
  };
}
const PROFILE_FIELDS = ["version", "nickname", "arenaOptIn", "totalXp", "level", "levelTitle", "levelFloor",
  "nextLevelXp", "remainingXp", "progress", "rank", "badges", "awardedAnalyses", "dailySlotsUsed"];
export function parseGameProfile(value: unknown): GameProfile {
  try {
    const row = object(value, PROFILE_FIELDS);
    if (row.version !== 1 || typeof row.arenaOptIn !== "boolean") return invalid();
    const nickname = row.nickname === null ? null : outputNickname(row.nickname);
    const totalXp = integer(row.totalXp);
    const projection = getLevelProgress(totalXp);
    for (const [key, expected] of Object.entries(projection)) if (row[key] !== expected) return invalid();
    const rank = optionalRank(row.rank);
    if ((row.arenaOptIn && (nickname === null || rank === null)) || (!row.arenaOptIn && rank !== null)) return invalid();
    const awardedAnalyses = integer(row.awardedAnalyses);
    const dailySlotsUsed = integer(row.dailySlotsUsed);
    if (dailySlotsUsed > 3 || (awardedAnalyses === 0 ? totalXp !== 0 :
      totalXp < awardedAnalyses * 50 || totalXp > awardedAnalyses * 300) || totalXp % 25 !== 0) return invalid();
    if (!Array.isArray(row.badges) || row.badges.some((badge) => !BADGES.includes(badge)) || new Set(row.badges).size !== row.badges.length)
      return invalid();
    const badges = row.badges as BadgeId[];
    if (badges.includes("first_recognition") !== (awardedAnalyses > 0) ||
      badges.includes("green_pioneer") !== (totalXp >= 1000) ||
      (badges.includes("category_explorer") && awardedAnalyses < 3)) return invalid();
    return { version: 1, nickname, arenaOptIn: row.arenaOptIn, totalXp, ...projection,
      rank, badges: [...badges], awardedAnalyses, dailySlotsUsed };
  } catch { return invalid(); }
}

function parseEntry(value: unknown): ArenaEntry {
  const row = object(value, ["rank", "nickname", "totalXp", "level", "levelTitle", "isMe"]);
  const rank = integer(row.rank, 1);
  const nickname = outputNickname(row.nickname);
  const totalXp = integer(row.totalXp);
  const projection = getLevelProgress(totalXp);
  if (row.level !== projection.level || row.levelTitle !== projection.levelTitle || typeof row.isMe !== "boolean" || totalXp % 25 !== 0)
    return invalid();
  return { rank, nickname, totalXp, level: projection.level, levelTitle: projection.levelTitle, isMe: row.isMe };
}
export function validateArenaOffset(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 2_147_483_640 || value % ARENA_PAGE_SIZE)
    throw new GamificationError("INVALID_PAGE");
  return value;
}
function utcTimestamp(value: unknown): string {
  if (typeof value !== "string") return invalid();
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
  if (!match) return invalid();
  const date = new Date(`${match[1]}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== match[1]) return invalid();
  return `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}Z`;
}
export function parseGameArena(value: unknown, expectedOffset: number): GameArena {
  try {
    const row = object(value, ["version", "podium", "entries", "myRank", "offset", "nextOffset", "totalParticipants", "fetchedAt"]);
    if (row.version !== 1 || row.offset !== expectedOffset) return invalid();
    const offset = validateArenaOffset(row.offset);
    const totalParticipants = integer(row.totalParticipants);
    const myRank = optionalRank(row.myRank);
    if (myRank !== null && myRank > totalParticipants) return invalid();
    if (!Array.isArray(row.podium) || !Array.isArray(row.entries) ||
      row.podium.length !== Math.min(3, totalParticipants) ||
      row.entries.length !== Math.min(ARENA_PAGE_SIZE, Math.max(0, totalParticipants - offset))) return invalid();
    const podium = row.podium.map(parseEntry);
    const entries = row.entries.map(parseEntry);
    const positions = new Map<number, ArenaEntry>();
    const nicknames = new Map<string, number>();
    for (const [array, start] of [[podium, 1], [entries, offset + 1]] as const) {
      for (let index = 0; index < array.length; index++) {
        const entry = array[index];
        if (entry.rank !== start + index || entry.isMe !== (entry.rank === myRank)) return invalid();
        const previous = array[index - 1];
        if (previous && (previous.totalXp < entry.totalXp ||
          (previous.totalXp === entry.totalXp && nicknameKey(previous.nickname) >= nicknameKey(entry.nickname)))) return invalid();
        const seen = positions.get(entry.rank);
        if (seen && JSON.stringify(seen) !== JSON.stringify(entry)) return invalid();
        const nickname = nicknameKey(entry.nickname);
        if (nicknames.has(nickname) && nicknames.get(nickname) !== entry.rank) return invalid();
        positions.set(entry.rank, entry);
        nicknames.set(nickname, entry.rank);
      }
    }
    const visible = [...positions.values()].sort((a, b) => a.rank - b.rank);
    for (let index = 1; index < visible.length; index++) {
      const previous = visible[index - 1], entry = visible[index];
      if (previous.totalXp < entry.totalXp ||
        (previous.totalXp === entry.totalXp && nicknameKey(previous.nickname) >= nicknameKey(entry.nickname))) return invalid();
    }
    const nextOffset = offset + entries.length < totalParticipants ? offset + ARENA_PAGE_SIZE : null;
    if (row.nextOffset !== nextOffset) return invalid();
    return { version: 1, podium, entries, myRank, offset, nextOffset, totalParticipants, fetchedAt: utcTimestamp(row.fetchedAt) };
  } catch { return invalid(); }
}

export type GamificationCommand = { kind: "profile" } | { kind: "save"; preferences: ProfilePreferences } | { kind: "arena"; offset: number };
export interface GamificationRpcResult { data: unknown; error: unknown; status?: number }
export interface GamificationDataPort {
  configured: boolean;
  auth: HistoryAuthPort | null;
  rpc(command: GamificationCommand, signal: AbortSignal): Promise<GamificationRpcResult>;
  online?: () => boolean;
  nowSeconds?: () => number;
}
export const GAMIFICATION_TIMEOUT_MS = 15_000;
function rpcError(error: unknown, status: number | undefined, command: GamificationCommand): GamificationError {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (["PGRST202", "PGRST205", "42883", "42P01"].includes(code)) return new GamificationError("NOT_DEPLOYED");
  if (status === 401 || status === 403 || ["28000", "42501", "PGRST301", "PGRST303"].includes(code)) return new GamificationError("UNAUTHORIZED");
  if (command.kind === "save" && code === "23505") return new GamificationError("NICKNAME_TAKEN");
  if (code === "22023") return new GamificationError(command.kind === "arena" ? "INVALID_PAGE" : "INVALID_NICKNAME");
  if (status === 0 || (status !== undefined && status >= 500)) return new GamificationError("NETWORK_ERROR");
  return new GamificationError("SERVICE_ERROR");
}

/** SDK owns credentials. Only fixed RPC commands cross this injectable port. */
export function createGamificationDataService(port: GamificationDataPort): GamificationService {
  let writing = false;
  let preferencesVersion = 0;
  async function run<T>(userId: string, signal: AbortSignal, command: GamificationCommand, convert: (data: unknown) => T): Promise<T> {
    if (!port.configured) throw new GamificationError("NOT_CONFIGURED");
    const auth = port.auth;
    if (!auth || typeof userId !== "string" || !UUID_PATTERN.test(userId)) throw new GamificationError("UNAUTHORIZED");
    const expectedUser = userId.toLowerCase();
    const version = preferencesVersion;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    let identityLost = false;
    let timedOut = false;
    let subscription: { unsubscribe(): void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const assertActive = () => {
      if (identityLost) throw new GamificationError("UNAUTHORIZED");
      if (timedOut) throw new GamificationError("TIMEOUT");
      if (controller.signal.aborted || (command.kind !== "save" && preferencesVersion !== version)) throw new GamificationError("CANCELLED");
    };
    async function currentSession() {
      let response: Awaited<ReturnType<HistoryAuthPort["getSession"]>>;
      try { response = await auth!.getSession(); } catch { throw new GamificationError("UNAUTHORIZED"); }
      assertActive();
      const session = response.data?.session;
      if (response.error || !session || typeof session.access_token !== "string" || !session.access_token ||
        session.user?.is_anonymous === true || typeof session.user?.id !== "string" || session.user.id.toLowerCase() !== expectedUser ||
        !Number.isFinite(session.expires_at) || !session.expires_at || session.expires_at <= (port.nowSeconds?.() ?? Date.now() / 1000))
        throw new GamificationError("UNAUTHORIZED");
    }
    try {
      subscription = auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || event === "PASSWORD_RECOVERY" || (session === null && event !== "INITIAL_SESSION") ||
          (session !== null && (typeof session.user?.id !== "string" || session.user.id.toLowerCase() !== expectedUser))) {
          identityLost = true;
          controller.abort();
        }
      }).data.subscription;
      assertActive();
      await currentSession();
      if (port.online?.() === false) throw new GamificationError("NETWORK_ERROR");
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new GamificationError("TIMEOUT")); }, GAMIFICATION_TIMEOUT_MS);
      });
      const result = await Promise.race([port.rpc(command, controller.signal), timeout]);
      assertActive();
      await currentSession();
      if (result.error) throw rpcError(result.error, result.status, command);
      return convert(result.data);
    } catch (reason) {
      assertActive();
      if (reason instanceof GamificationError) throw reason;
      throw new GamificationError("NETWORK_ERROR");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      subscription?.unsubscribe();
      signal.removeEventListener("abort", abort);
    }
  }
  return {
    getProfile: (userId, signal) => run(userId, signal, { kind: "profile" }, parseGameProfile),
    listArena(userId, offset, signal) {
      const checked = validateArenaOffset(offset);
      return run(userId, signal, { kind: "arena", offset: checked }, (data) => parseGameArena(data, checked));
    },
    async saveProfile(userId, preferences, signal) {
      if (writing) throw new GamificationError("BUSY");
      const checked = validateProfilePreferences(preferences);
      writing = true;
      preferencesVersion++;
      try {
        return await run(userId, signal, { kind: "save", preferences: checked }, (data) => {
          const profile = parseGameProfile(data);
          if (profile.nickname !== checked.nickname || profile.arenaOptIn !== checked.arenaOptIn) return invalid();
          return profile;
        });
      }
      finally { preferencesVersion++; writing = false; }
    },
  };
}
