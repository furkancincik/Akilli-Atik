import {
  applySafetyRules,
  parseAnalysis,
  UUID_PATTERN,
  type WasteAnalysis,
} from "../../supabase/functions/_shared/analysis.ts";

export interface HistoryRecord {
  id: string;
  createdAt: string;
  analysis: WasteAnalysis;
  model: string;
  schemaVersion: 1;
}
export interface HistoryCursor { createdAt: string; id: string }
export interface HistoryPageResult { items: HistoryRecord[]; nextCursor: HistoryCursor | null }
export interface HistoryService {
  list(userId: string, cursor: HistoryCursor | null, signal: AbortSignal): Promise<HistoryPageResult>;
  get(userId: string, id: string, signal: AbortSignal): Promise<HistoryRecord>;
  remove(userId: string, id: string, signal: AbortSignal): Promise<void>;
}

const HISTORY_MESSAGES = {
  UNAUTHORIZED: "Oturumun doğrulanamadı veya değişti. Yeniden giriş yap.",
  NOT_CONFIGURED: "Analiz geçmişi bağlantısı henüz yapılandırılmadı.",
  INVALID_CURSOR: "Geçmiş sayfası bilgisi geçersiz. Listeyi yenile.",
  INVALID_RECORD: "Analiz kaydı doğrulanamadı. Listeyi yenileyip tekrar dene.",
  NOT_FOUND: "Bu analiz kaydı bulunamadı veya erişimine açık değil.",
  NETWORK_ERROR: "Analiz geçmişine ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.",
  CANCELLED: "Geçmiş isteği iptal edildi.",
  SERVICE_ERROR: "Analiz geçmişi şu anda yüklenemiyor. Bir süre sonra tekrar dene.",
} as const;
export type HistoryErrorCode = keyof typeof HISTORY_MESSAGES;
export class HistoryError extends Error {
  readonly code: HistoryErrorCode;
  constructor(code: HistoryErrorCode) {
    super(HISTORY_MESSAGES[code]);
    this.name = "HistoryError";
    this.code = code;
  }
}
export function historyErrorMessage(error: unknown): string {
  return error instanceof HistoryError ? HISTORY_MESSAGES[error.code] : HISTORY_MESSAGES.SERVICE_ERROR;
}

export const HISTORY_PAGE_SIZE = 12;
export const HISTORY_COLUMNS = [
  "id", "user_id", "client_request_id", "created_at", "waste_name", "category",
  "description", "sorting_instruction", "recycling_advice", "safety_warning",
  "object_count", "uncertain", "hazardous", "model", "schema_version",
] as const;

interface HistorySession {
  access_token: string;
  expires_at?: number;
  user: { id: string; is_anonymous?: boolean };
}
export interface HistoryAuthPort {
  getSession(): Promise<{ data: { session: HistorySession | null }; error: unknown }>;
  onAuthStateChange(callback: (event: string, session: HistorySession | null) => void): {
    data: { subscription: { unsubscribe(): void } };
  };
}
export type HistoryQuery =
  | { kind: "list"; userId: string; cursor: HistoryCursor | null; limit: number }
  | { kind: "get"; userId: string; id: string }
  | { kind: "remove"; userId: string; id: string };
export interface HistoryQueryResult { data: unknown; error: unknown; status?: number }
export interface HistoryDataPort {
  configured: boolean;
  auth: HistoryAuthPort | null;
  query(command: HistoryQuery, signal: AbortSignal): Promise<HistoryQueryResult>;
  online?: () => boolean;
  nowSeconds?: () => number;
}

function uuid(value: unknown, code: HistoryErrorCode): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new HistoryError(code);
  return value.toLowerCase();
}

/** Preserve PostgreSQL microseconds; JS Date.toISOString() alone loses keyset precision. */
function timestamp(value: unknown, code: HistoryErrorCode): string {
  if (typeof value !== "string") throw new HistoryError(code);
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
  if (!match) throw new HistoryError(code);
  const date = new Date(`${match[1]}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== match[1])
    throw new HistoryError(code);
  return `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}Z`;
}
function cursorValue(cursor: HistoryCursor | null): HistoryCursor | null {
  if (cursor === null) return null;
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) ||
    Object.keys(cursor).some((key) => !["createdAt", "id"].includes(key)))
    throw new HistoryError("INVALID_CURSOR");
  return { createdAt: timestamp(cursor.createdAt, "INVALID_CURSOR"), id: uuid(cursor.id, "INVALID_CURSOR") };
}
function parseRow(value: unknown, expectedUserId: string, expectedId?: string): HistoryRecord {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length !== HISTORY_COLUMNS.length ||
      HISTORY_COLUMNS.some((column) => !Object.hasOwn(row, column)) ||
      uuid(row.user_id, "INVALID_RECORD") !== expectedUserId || row.schema_version !== 1)
      throw new Error();
    const id = uuid(row.id, "INVALID_RECORD");
    if (expectedId && id !== expectedId) throw new Error();
    uuid(row.client_request_id, "INVALID_RECORD");
    const createdAt = timestamp(row.created_at, "INVALID_RECORD");
    if (typeof row.model !== "string" || row.model.length > 120 || !/^gemini-[a-z0-9.-]+$/.test(row.model))
      throw new Error();
    const analysis = applySafetyRules(parseAnalysis({
      success: true, wasteName: row.waste_name, category: row.category,
      description: row.description, sortingInstruction: row.sorting_instruction,
      recyclingAdvice: row.recycling_advice, safetyWarning: row.safety_warning,
      objectCount: row.object_count, uncertain: row.uncertain, hazardous: row.hazardous,
    }));
    return { id, createdAt, analysis, model: row.model, schemaVersion: 1 };
  } catch { throw new HistoryError("INVALID_RECORD"); }
}
function queryError(error: unknown, status?: number): HistoryError {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (status === 401 || status === 403 || ["42501", "PGRST301", "PGRST303"].includes(String(code)))
    return new HistoryError("UNAUTHORIZED");
  if (status === 0 || (typeof status === "number" && status >= 500)) return new HistoryError("NETWORK_ERROR");
  return new HistoryError("SERVICE_ERROR");
}
function rows(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new HistoryError("INVALID_RECORD");
  return value;
}
function isBefore(record: Pick<HistoryRecord, "createdAt" | "id">, previous: HistoryCursor): boolean {
  return record.createdAt < previous.createdAt ||
    (record.createdAt === previous.createdAt && record.id < previous.id);
}

/** Pure service core. The SDK adapter owns credentials; this port never receives a token. */
export function createHistoryDataService(port: HistoryDataPort): HistoryService {
  async function run<T>(
    userValue: string,
    signal: AbortSignal,
    commandFor: (userId: string) => HistoryQuery,
    convert: (data: unknown, userId: string) => T,
  ): Promise<T> {
    if (!port.configured) throw new HistoryError("NOT_CONFIGURED");
    if (!port.auth) throw new HistoryError("UNAUTHORIZED");
    const userId = uuid(userValue, "UNAUTHORIZED");
    const command = commandFor(userId);
    const auth = port.auth;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    let identityLost = false;
    let subscription: { unsubscribe(): void } | undefined;
    const assertActive = () => {
      if (identityLost) throw new HistoryError("UNAUTHORIZED");
      if (controller.signal.aborted) throw new HistoryError("CANCELLED");
    };
    const currentSession = async () => {
      let response: Awaited<ReturnType<HistoryAuthPort["getSession"]>>;
      try { response = await auth.getSession(); }
      catch { throw new HistoryError("UNAUTHORIZED"); }
      assertActive();
      const session = response.data?.session;
      const expiry = session?.expires_at;
      if (response.error || !session || typeof session.access_token !== "string" || !session.access_token ||
        session.user.is_anonymous === true ||
        uuid(session.user.id, "UNAUTHORIZED") !== userId || !Number.isFinite(expiry) ||
        !expiry || expiry <= (port.nowSeconds?.() ?? Date.now() / 1000))
        throw new HistoryError("UNAUTHORIZED");
    };
    try {
      subscription = auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || event === "PASSWORD_RECOVERY" ||
          (session === null && event !== "INITIAL_SESSION") ||
          (session !== null && session.user.id.toLowerCase() !== userId)) {
          identityLost = true;
          controller.abort();
        }
      }).data.subscription;
      assertActive();
      await currentSession();
      if (port.online?.() === false) throw new HistoryError("NETWORK_ERROR");
      const result = await port.query(command, controller.signal);
      // Transport cancellation is best effort; stale data is rejected even if ignored.
      assertActive();
      await currentSession();
      if (result.error) throw queryError(result.error, result.status);
      return convert(result.data, userId);
    } catch (error) {
      assertActive();
      if (error instanceof HistoryError) throw error;
      throw new HistoryError("NETWORK_ERROR");
    } finally {
      subscription?.unsubscribe();
      signal.removeEventListener("abort", abort);
    }
  }
  return {
    list(userId, cursor, signal) {
      const checkedCursor = cursorValue(cursor);
      return run(userId, signal,
        (owner) => ({ kind: "list", userId: owner, cursor: checkedCursor, limit: HISTORY_PAGE_SIZE + 1 }),
        (data, owner) => {
          const records = rows(data, HISTORY_PAGE_SIZE + 1).map((value) => parseRow(value, owner));
          const seen = new Set<string>();
          let previous = checkedCursor;
          for (const record of records) {
            if (seen.has(record.id) || (previous && !isBefore(record, previous)))
              throw new HistoryError("INVALID_RECORD");
            seen.add(record.id);
            previous = { createdAt: record.createdAt, id: record.id };
          }
          const items = records.slice(0, HISTORY_PAGE_SIZE);
          const last = items.at(-1);
          return { items, nextCursor: records.length > HISTORY_PAGE_SIZE && last
            ? { createdAt: last.createdAt, id: last.id } : null };
        });
    },
    get(userId, id, signal) {
      return run(userId, signal,
        (owner) => ({ kind: "get", userId: owner, id: uuid(id, "NOT_FOUND") }),
        (data, owner) => {
          const found = rows(data, 1);
          if (!found.length) throw new HistoryError("NOT_FOUND");
          return parseRow(found[0], owner, uuid(id, "NOT_FOUND"));
        });
    },
    remove(userId, id, signal) {
      return run(userId, signal,
        (owner) => ({ kind: "remove", userId: owner, id: uuid(id, "NOT_FOUND") }),
        (data) => {
          const deleted = rows(data, 1);
          if (!deleted.length) throw new HistoryError("NOT_FOUND");
          const row = deleted[0];
          if (!row || typeof row !== "object" || Array.isArray(row) ||
            Object.keys(row).length !== 1 || !("id" in row) || uuid(row.id, "INVALID_RECORD") !== uuid(id, "NOT_FOUND"))
            throw new HistoryError("INVALID_RECORD");
        });
    },
  };
}
