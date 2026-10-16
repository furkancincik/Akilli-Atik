import {
  applySafetyRules,
  parseAnalysis,
  type WasteAnalysis,
} from "../_shared/analysis.ts";
import { readLimitedBody } from "../_shared/image.ts";

/** Yalnız Edge Function içinden kullanılır. Bu modül istemci paketine eklenmez. */
export interface AnalysisStoreConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  timeoutMs?: number;
}

export interface StoredAnalysis {
  id: string;
  result: WasteAnalysis;
  model: string;
  schemaVersion: 1;
}

export interface SaveAnalysisOutcome extends StoredAnalysis {
  status: "saved" | "duplicate";
}

export interface AnalysisStore {
  find(verifiedUserId: string, clientRequestId: string): Promise<StoredAnalysis | null>;
  save(
    verifiedUserId: string,
    clientRequestId: string,
    validatedResult: WasteAnalysis,
    model: string,
  ): Promise<SaveAnalysisOutcome>;
}

/** Ayrıntılı PostgREST hataları veya sunucu anahtarları dışarı taşınmaz. */
export class StorageUnavailableError extends Error {
  constructor() {
    super("Analiz kaydı şu anda saklanamıyor.");
    this.name = "StorageUnavailableError";
  }
}

export class StorageValidationError extends Error {
  constructor() {
    super("Analiz kaydı doğrulanamadı.");
    this.name = "StorageValidationError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLUMNS = [
  "id", "user_id", "client_request_id", "waste_name", "category", "description",
  "sorting_instruction", "recycling_advice", "safety_warning", "object_count",
  "uncertain", "hazardous", "model", "schema_version",
] as const;
const MAX_RESPONSE_BYTES = 32 * 1024;
const PROJECT_ORIGIN = "https://nyoxbwandadakfagoner.supabase.co";

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value))
    throw new StorageValidationError();
  return value.toLowerCase();
}

function modelName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 120 ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    throw new StorageValidationError();
  return value.trim();
}

function successfulAnalysis(value: unknown): WasteAnalysis {
  try {
    const result = parseAnalysis(applySafetyRules(parseAnalysis(value)));
    if (!result.success) throw new StorageValidationError();
    return result;
  } catch {
    throw new StorageValidationError();
  }
}

function storedRow(value: unknown, userId: string, requestId: string): StoredAnalysis {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new StorageValidationError();
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).length !== COLUMNS.length ||
      COLUMNS.some((column) => !Object.hasOwn(row, column)) ||
      uuid(row.user_id) !== userId || uuid(row.client_request_id) !== requestId ||
      row.schema_version !== 1
    ) throw new StorageValidationError();
    return {
      id: uuid(row.id),
      model: modelName(row.model),
      schemaVersion: 1,
      result: successfulAnalysis({
        success: true,
        wasteName: row.waste_name,
        category: row.category,
        description: row.description,
        sortingInstruction: row.sorting_instruction,
        recyclingAdvice: row.recycling_advice,
        safetyWarning: row.safety_warning,
        objectCount: row.object_count,
        uncertain: row.uncertain,
        hazardous: row.hazardous,
      }),
    };
  } catch {
    // Corrupt/unexpected rows are infrastructure failures, never successful saves.
    throw new StorageUnavailableError();
  }
}

/**
 * Hizmet rolü RLS'yi atlar: kullanıcı kimliği yalnız doğrulanmış JWT'den gelmelidir.
 * Her okuma iki kimlikle sınırlandırılır. İstemci JSON'u doğrudan kaydedilmez.
 */
export function createAnalysisStore(
  config: AnalysisStoreConfig,
  transport: typeof fetch = fetch,
): AnalysisStore {
  let endpoint: URL;
  try {
    const base = new URL(config.supabaseUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
    if (
      !(base.origin === PROJECT_ORIGIN || (local && ["http:", "https:"].includes(base.protocol))) ||
      base.username || base.password || base.search || base.hash ||
      !["", "/"].includes(base.pathname) ||
      typeof config.serviceRoleKey !== "string" || !config.serviceRoleKey.trim() ||
      /[\r\n]/.test(config.serviceRoleKey)
    ) throw new StorageUnavailableError();
    endpoint = new URL("/rest/v1/waste_analyses", base.origin);
  } catch {
    throw new StorageUnavailableError();
  }
  const timeoutMs = config.timeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 15000)
    throw new StorageUnavailableError();

  async function request(url: URL, method: "GET" | "POST", body?: object) {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new StorageUnavailableError());
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        (async () => {
          const response = await transport(url, {
            method,
            redirect: "error",
            headers: {
              apikey: config.serviceRoleKey,
              Authorization: `Bearer ${config.serviceRoleKey}`,
              Accept: "application/json",
              ...(body ? { "Content-Type": "application/json", Prefer: "return=representation" } : {}),
            },
            signal: abort.signal,
            ...(body ? { body: JSON.stringify(body) } : {}),
          });
          const bytes = await readLimitedBody(response.body, MAX_RESPONSE_BYTES, "INVALID_RESPONSE", abort.signal);
          const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
          return { status: response.status, ok: response.ok, data };
        })(),
        timedOut,
      ]);
    } catch {
      throw new StorageUnavailableError();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async function find(verifiedUserId: string, clientRequestId: string): Promise<StoredAnalysis | null> {
    const userId = uuid(verifiedUserId);
    const requestId = uuid(clientRequestId);
    const url = new URL(endpoint);
    url.searchParams.set("select", COLUMNS.join(","));
    url.searchParams.set("user_id", `eq.${userId}`);
    url.searchParams.set("client_request_id", `eq.${requestId}`);
    url.searchParams.set("limit", "2");
    const response = await request(url, "GET");
    if (!response.ok || !Array.isArray(response.data) || response.data.length > 1)
      throw new StorageUnavailableError();
    return response.data.length === 0 ? null : storedRow(response.data[0], userId, requestId);
  }

  async function save(
    verifiedUserId: string,
    clientRequestId: string,
    validatedResult: WasteAnalysis,
    model: string,
  ): Promise<SaveAnalysisOutcome> {
    const userId = uuid(verifiedUserId);
    const requestId = uuid(clientRequestId);
    const result = successfulAnalysis(validatedResult);
    const checkedModel = modelName(model);
    const url = new URL(endpoint);
    url.searchParams.set("select", COLUMNS.join(","));
    const response = await request(url, "POST", {
      user_id: userId,
      client_request_id: requestId,
      waste_name: result.wasteName,
      category: result.category,
      description: result.description,
      sorting_instruction: result.sortingInstruction,
      recycling_advice: result.recyclingAdvice,
      safety_warning: result.safetyWarning,
      object_count: result.objectCount,
      uncertain: result.uncertain,
      hazardous: result.hazardous,
      model: checkedModel,
      schema_version: 1,
    });
    if (response.status === 409 && response.data && typeof response.data === "object" &&
      !Array.isArray(response.data) && (response.data as Record<string, unknown>).code === "23505") {
      const original = await find(userId, requestId);
      if (!original) throw new StorageUnavailableError();
      return { ...original, status: "duplicate" };
    }
    if (!response.ok || !Array.isArray(response.data) || response.data.length !== 1)
      throw new StorageUnavailableError();
    return { ...storedRow(response.data[0], userId, requestId), status: "saved" };
  }

  return { find, save };
}
