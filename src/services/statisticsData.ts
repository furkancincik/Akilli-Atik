import { CATEGORIES, UUID_PATTERN, type WasteCategory } from "../../supabase/functions/_shared/analysis.ts";
import type { HistoryAuthPort } from "./historyData.ts";

export interface StatisticsRecord { id: string; createdAt: string; category: WasteCategory }
export interface StatisticsCursor { createdAt: string; id: string }
export interface CategoryStatistic { category: WasteCategory; count: number; percentage: number }
export interface DailyStatistic { date: string; count: number }
export interface WeeklyStatistic { startDate: string; endDate: string; count: number }
export interface StatisticsSummary {
  totalAnalyses: number;
  distinctCategories: number;
  categories: CategoryStatistic[];
  topCategories: WasteCategory[];
  topCount: number;
  daily: DailyStatistic[];
  weekly: WeeklyStatistic[];
  timeZone: "Europe/Istanbul";
  calculatedAt: string;
}
export interface StatisticsService {
  load(userId: string, signal: AbortSignal): Promise<StatisticsSummary>;
}
const MESSAGES = {
  UNAUTHORIZED: "Oturumun doğrulanamadı veya değişti. Yeniden giriş yap.",
  NOT_CONFIGURED: "İstatistik bağlantısı henüz yapılandırılmadı.",
  INVALID_DATA: "İstatistik verileri doğrulanamadı. Yenileyip tekrar dene.",
  DATA_CHANGED: "Analiz kayıtları okunurken değişti veya eksiksiz okunamadı. İstatistikleri yenile.",
  NETWORK_ERROR: "İstatistiklere ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.",
  CANCELLED: "İstatistik isteği iptal edildi.",
  SERVICE_ERROR: "İstatistikler şu anda yüklenemiyor. Bir süre sonra tekrar dene.",
} as const;
export type StatisticsErrorCode = keyof typeof MESSAGES;
export class StatisticsError extends Error {
  readonly code: StatisticsErrorCode;
  constructor(code: StatisticsErrorCode) {
    super(MESSAGES[code]);
    this.name = "StatisticsError";
    this.code = code;
  }
}
export function statisticsErrorMessage(error: unknown): string {
  return error instanceof StatisticsError ? MESSAGES[error.code] : MESSAGES.SERVICE_ERROR;
}

export const STATISTICS_PAGE_SIZE = 500;
export const STATISTICS_COLUMNS = ["id", "user_id", "created_at", "category"] as const;
export type StatisticsQuery =
  | { kind: "page"; userId: string; cursor: StatisticsCursor | null; limit: number }
  | { kind: "count"; userId: string; highWater: StatisticsCursor };
export interface StatisticsQueryResult { data: unknown; error: unknown; count: number | null; status?: number }
export interface StatisticsDataPort {
  configured: boolean;
  auth: HistoryAuthPort | null;
  query(command: StatisticsQuery, signal: AbortSignal): Promise<StatisticsQueryResult>;
  online?: () => boolean;
  now?: () => number;
}

function uuid(value: unknown, code: StatisticsErrorCode): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new StatisticsError(code);
  return value.toLowerCase();
}
function timestamp(value: unknown): string {
  if (typeof value !== "string") throw new StatisticsError("INVALID_DATA");
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
  if (!match) throw new StatisticsError("INVALID_DATA");
  const date = new Date(`${match[1]}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== match[1])
    throw new StatisticsError("INVALID_DATA");
  return `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}Z`;
}
function category(value: unknown): WasteCategory {
  if (!CATEGORIES.includes(value as WasteCategory)) throw new StatisticsError("INVALID_DATA");
  return value as WasteCategory;
}
function parseRecord(value: unknown, owner?: string): StatisticsRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StatisticsError("INVALID_DATA");
  const row = value as Record<string, unknown>;
  const fields = owner ? STATISTICS_COLUMNS : ["id", "createdAt", "category"];
  if (Object.keys(row).length !== fields.length || fields.some((key) => !Object.hasOwn(row, key)))
    throw new StatisticsError("INVALID_DATA");
  if (owner && uuid(row.user_id, "INVALID_DATA") !== owner) throw new StatisticsError("INVALID_DATA");
  return {
    id: uuid(row.id, "INVALID_DATA"),
    createdAt: timestamp(owner ? row.created_at : row.createdAt),
    category: category(row.category),
  };
}
function before(record: StatisticsCursor, previous: StatisticsCursor): boolean {
  return record.createdAt < previous.createdAt ||
    (record.createdAt === previous.createdAt && record.id < previous.id);
}

const istanbulDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
  calendar: "gregory", numberingSystem: "latn",
});
function localDay(time: number): string {
  const parts = istanbulDay.formatToParts(time);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function offsetDay(day: string, amount: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10);
}
function monday(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return offsetDay(day, -((weekday + 6) % 7));
}
function accumulator(now: number) {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new StatisticsError("INVALID_DATA");
  const today = localDay(now);
  const week = monday(today);
  const daily: DailyStatistic[] = Array.from({ length: 14 }, (_, index) => ({ date: offsetDay(today, index - 13), count: 0 }));
  const weekly: WeeklyStatistic[] = Array.from({ length: 8 }, (_, index) => {
    const startDate = offsetDay(week, (index - 7) * 7);
    return { startDate, endDate: offsetDay(startDate, 6), count: 0 };
  });
  const days = new Map(daily.map((item) => [item.date, item]));
  const weeks = new Map(weekly.map((item) => [item.startDate, item]));
  const counts = new Map<WasteCategory, number>(CATEGORIES.map((name) => [name, 0]));
  let total = 0;
  return {
    add(record: StatisticsRecord) {
      total++;
      counts.set(record.category, (counts.get(record.category) ?? 0) + 1);
      const day = localDay(Date.parse(record.createdAt));
      const dailyItem = days.get(day);
      if (dailyItem) dailyItem.count++;
      const weeklyItem = weeks.get(monday(day));
      if (weeklyItem) weeklyItem.count++;
    },
    finish(): StatisticsSummary {
      const categories = CATEGORIES.map((name) => ({
        category: name, count: counts.get(name) ?? 0,
        percentage: total ? ((counts.get(name) ?? 0) / total) * 100 : 0,
      }));
      const topCount = Math.max(...categories.map((item) => item.count));
      return {
        totalAnalyses: total,
        distinctCategories: categories.filter((item) => item.count > 0).length,
        categories,
        topCategories: topCount ? categories.filter((item) => item.count === topCount).map((item) => item.category) : [],
        topCount, daily, weekly, timeZone: "Europe/Istanbul", calculatedAt: new Date(now).toISOString(),
      };
    },
  };
}

/** Synthetic callers can use the same calculation without SDK, browser or network. */
export function calculateStatistics(records: readonly StatisticsRecord[], now = Date.now()): StatisticsSummary {
  if (!Array.isArray(records)) throw new StatisticsError("INVALID_DATA");
  const result = accumulator(now);
  const seen = new Set<string>();
  for (const value of records) {
    const record = parseRecord(value);
    if (seen.has(record.id)) throw new StatisticsError("INVALID_DATA");
    seen.add(record.id);
    result.add(record);
  }
  return result.finish();
}

function providerError(error: unknown, status?: number): StatisticsError {
  const value = error && typeof error === "object" && "code" in error ? error.code : null;
  if (status === 401 || status === 403 || ["42501", "PGRST301", "PGRST303"].includes(String(value)))
    return new StatisticsError("UNAUTHORIZED");
  if (status === 0 || (typeof status === "number" && status >= 500)) return new StatisticsError("NETWORK_ERROR");
  return new StatisticsError("SERVICE_ERROR");
}
function exactCount(count: unknown): number {
  if (!Number.isSafeInteger(count) || (count as number) < 0) throw new StatisticsError("INVALID_DATA");
  return count as number;
}

/** Read-only complete scan. Only an authenticated, validated final summary is returned. */
export function createStatisticsDataService(port: StatisticsDataPort): StatisticsService {
  return {
    async load(userValue, signal) {
      if (!port.configured) throw new StatisticsError("NOT_CONFIGURED");
      if (!port.auth) throw new StatisticsError("UNAUTHORIZED");
      const userId = uuid(userValue, "UNAUTHORIZED");
      const auth = port.auth;
      const now = port.now ?? Date.now;
      const result = accumulator(now());
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) controller.abort();
      let identityLost = false;
      let subscription: { unsubscribe(): void } | undefined;
      const assertActive = () => {
        if (identityLost) throw new StatisticsError("UNAUTHORIZED");
        if (controller.signal.aborted) throw new StatisticsError("CANCELLED");
      };
      const session = async () => {
        let response: Awaited<ReturnType<HistoryAuthPort["getSession"]>>;
        try { response = await auth.getSession(); }
        catch { throw new StatisticsError("UNAUTHORIZED"); }
        assertActive();
        const current = response.data?.session;
        const expiry = current?.expires_at;
        if (response.error || !current || typeof current.access_token !== "string" || !current.access_token ||
          current.user.is_anonymous === true || uuid(current.user.id, "UNAUTHORIZED") !== userId ||
          !Number.isFinite(expiry) || !expiry || expiry <= now() / 1000)
          throw new StatisticsError("UNAUTHORIZED");
      };
      const query = async (command: StatisticsQuery): Promise<StatisticsQueryResult> => {
        assertActive();
        await session();
        if (port.online?.() === false) throw new StatisticsError("NETWORK_ERROR");
        const response = await port.query(command, controller.signal);
        assertActive();
        await session();
        if (response.error || (typeof response.status === "number" && response.status >= 400))
          throw providerError(response.error, response.status);
        return response;
      };
      try {
        subscription = auth.onAuthStateChange((event, current) => {
          if (event === "SIGNED_OUT" || event === "PASSWORD_RECOVERY" ||
            (current === null && event !== "INITIAL_SESSION") ||
            (current !== null && current.user.id.toLowerCase() !== userId)) {
            identityLost = true;
            controller.abort();
          }
        }).data.subscription;
        let cursor: StatisticsCursor | null = null;
        let highWater: StatisticsCursor | null = null;
        let initialCount: number | null = null;
        let scanned = 0;
        const seen = new Set<string>();
        do {
          const response = await query({ kind: "page", userId, cursor, limit: STATISTICS_PAGE_SIZE });
          const remaining = exactCount(response.count);
          if (initialCount === null) initialCount = remaining;
          if (scanned + remaining !== initialCount) throw new StatisticsError("DATA_CHANGED");
          if (!Array.isArray(response.data) || response.data.length > STATISTICS_PAGE_SIZE || response.data.length > remaining)
            throw new StatisticsError("INVALID_DATA");
          if (!response.data.length) {
            if (scanned !== initialCount) throw new StatisticsError("DATA_CHANGED");
            break;
          }
          for (const value of response.data) {
            const record = parseRecord(value, userId);
            if (seen.has(record.id) || (cursor && !before(record, cursor))) throw new StatisticsError("DATA_CHANGED");
            seen.add(record.id);
            cursor = { createdAt: record.createdAt, id: record.id };
            highWater ??= cursor;
            result.add(record);
            scanned++;
          }
          if (scanned > initialCount) throw new StatisticsError("DATA_CHANGED");
          // A server may cap a page below 500. Continue until the exact initial
          // count is collected, never infer completeness from a short response.
        } while (scanned < initialCount);
        if (highWater) {
          const final = await query({ kind: "count", userId, highWater });
          if (exactCount(final.count) !== initialCount || scanned !== initialCount)
            throw new StatisticsError("DATA_CHANGED");
        }
        assertActive();
        return result.finish();
      } catch (error) {
        assertActive();
        if (error instanceof StatisticsError) throw error;
        throw new StatisticsError("NETWORK_ERROR");
      } finally {
        subscription?.unsubscribe();
        signal.removeEventListener("abort", abort);
      }
    },
  };
}
