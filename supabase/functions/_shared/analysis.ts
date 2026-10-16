export const CATEGORIES = [
  "Plastik",
  "Cam",
  "Kâğıt/Karton",
  "Metal",
  "Organik",
  "Elektronik",
  "Pil",
  "Diğer",
] as const;
export type WasteCategory = (typeof CATEGORIES)[number];
export interface WasteAnalysis {
  success: boolean;
  wasteName: string | null;
  category: WasteCategory | null;
  description: string;
  sortingInstruction: string;
  recyclingAdvice: string;
  safetyWarning: string | null;
  objectCount: "none" | "single" | "multiple";
  uncertain: boolean;
  hazardous: boolean;
}

export type AnalysisPersistence =
  | { status: "saved" | "duplicate"; id: string }
  | { status: "failed" | "not_saved" };
export interface AnalysisOutcome {
  result: WasteAnalysis;
  persistence: AnalysisPersistence;
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ERROR_MESSAGES = {
  QUOTA_UNAVAILABLE: "Güvenli kullanım sınırı doğrulanamadı. Analiz başlatılmadı; daha sonra tekrar dene.",
  REQUEST_ALREADY_USED: "Bu istek daha önce işlendi veya işleniyor. Geçmişini kontrol et; otomatik olarak yeni analiz başlatılmadı.",
  TEST_ACCESS_REQUIRED:
    "Canlı test erişim kodu eksik, geçersiz veya süresi dolmuş. Geçerli test kodunu girip yeniden dene.",
  NOT_CONFIGURED:
    "Analiz hizmeti henüz yapılandırılmadı. Supabase bağlantısının tamamlanması gerekiyor.",
  SERVICE_DISABLED:
    "Analiz hizmeti henüz etkinleştirilmedi. Kurulumun tamamlanması gerekiyor.",
  MISSING_API_KEY:
    "Analiz sunucusunda Gemini API anahtarı eksik. Sunucu yapılandırması tamamlanmalı.",
  INVALID_API_KEY:
    "Gemini erişim ayarları geçersiz. Sunucu API anahtarı ve erişim izinleri kontrol edilmeli.",
  UNAUTHORIZED:
    "Analiz hizmetine erişim doğrulanamadı. Uygulamanın bağlantı ayarları kontrol edilmeli.",
  USER_UNAUTHORIZED:
    "Oturumun doğrulanamadı veya süresi doldu. Yeniden giriş yapıp tekrar dene.",
  AUTH_UNAVAILABLE:
    "Oturum doğrulama hizmetine ulaşılamadı. Bir süre sonra tekrar dene.",
  INVALID_REQUEST_ID:
    "Analiz istek kimliği geçersiz. Fotoğrafı yeniden seçip tekrar dene.",
  OFFLINE: "İnternet bağlantısı yok. Bağlantını kontrol edip yeniden dene.",
  NETWORK_ERROR:
    "Analiz hizmetine ulaşılamadı. İnternet bağlantını kontrol edip yeniden dene.",
  QUOTA_EXCEEDED: "Gemini kullanım kotası doldu. Daha sonra tekrar dene.",
  RATE_LIMITED:
    "Çok fazla analiz isteği gönderildi. Bir süre bekleyip tekrar dene.",
  TIMEOUT: "Analiz zaman aşımına uğradı. Daha sonra yeniden dene.",
  INVALID_PHOTO:
    "Fotoğraf geçersiz veya fazla büyük. Yeni bir fotoğraf seçip tekrar dene.",
  INVALID_RESPONSE:
    "Yapay zekâ yanıtı doğrulanamadı. Yeniden analiz edebilir veya farklı bir fotoğraf seçebilirsin.",
  SERVICE_ERROR:
    "Yapay zekâ hizmeti şu anda yanıt veremiyor. Daha sonra tekrar dene.",
  ORIGIN_DENIED: "Bu uygulama adresi için analiz erişimi yapılandırılmadı.",
  METHOD_NOT_ALLOWED: "Analiz isteği desteklenmiyor.",
  CANCELLED: "Analiz iptal edildi.",
} as const;
export type AnalysisErrorCode = keyof typeof ERROR_MESSAGES;
export class AnalysisError extends Error {
  readonly code: AnalysisErrorCode;
  constructor(code: AnalysisErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "AnalysisError";
    this.code = code;
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AnalysisError("INVALID_RESPONSE");
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number, allowEmpty = false): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (!allowEmpty && !value.trim())
  )
    throw new AnalysisError("INVALID_RESPONSE");
  return value.trim();
}
export function parseAnalysis(value: unknown): WasteAnalysis {
  let parsed: unknown = value;
  if (typeof value === "string") {
    if (value.length > 16000) throw new AnalysisError("INVALID_RESPONSE");
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new AnalysisError("INVALID_RESPONSE");
    }
  }
  const data = record(parsed);
  const fields = [
    "success",
    "wasteName",
    "category",
    "description",
    "sortingInstruction",
    "recyclingAdvice",
    "safetyWarning",
    "objectCount",
    "uncertain",
    "hazardous",
  ];
  if (
    fields.some((key) => !(key in data)) ||
    Object.keys(data).some((key) => !fields.includes(key))
  )
    throw new AnalysisError("INVALID_RESPONSE");
  if (
    typeof data.success !== "boolean" ||
    typeof data.uncertain !== "boolean" ||
    typeof data.hazardous !== "boolean"
  )
    throw new AnalysisError("INVALID_RESPONSE");
  if (!["none", "single", "multiple"].includes(String(data.objectCount)))
    throw new AnalysisError("INVALID_RESPONSE");
  const category = data.category;
  if (category !== null && !CATEGORIES.includes(category as WasteCategory))
    throw new AnalysisError("INVALID_RESPONSE");
  const result: WasteAnalysis = {
    success: data.success,
    wasteName: data.wasteName === null ? null : text(data.wasteName, 120),
    category: category as WasteCategory | null,
    description: text(data.description, 1200),
    sortingInstruction: text(data.sortingInstruction, 1600, !data.success),
    recyclingAdvice: text(data.recyclingAdvice, 1600, !data.success),
    safetyWarning:
      data.safetyWarning === null ? null : text(data.safetyWarning, 1200),
    objectCount: data.objectCount as WasteAnalysis["objectCount"],
    uncertain: data.uncertain,
    hazardous: data.hazardous,
  };
  if (result.success) {
    if (!result.wasteName || !result.category || result.objectCount === "none")
      throw new AnalysisError("INVALID_RESPONSE");
  } else if (
    result.wasteName !== null ||
    result.category !== null ||
    result.objectCount !== "none" ||
    result.sortingInstruction ||
    result.recyclingAdvice ||
    result.hazardous
  ) {
    throw new AnalysisError("INVALID_RESPONSE");
  }
  return result;
}

/** Validate analysis and persistence independently; never infer that a save succeeded. */
export function parseAnalysisOutcome(value: unknown): AnalysisOutcome {
  const data = record(value);
  if (Object.keys(data).some((key) => !["result", "persistence"].includes(key)))
    throw new AnalysisError("INVALID_RESPONSE");
  const result = parseAnalysis(data.result);
  const persistence = record(data.persistence);
  const saved = persistence.status === "saved" || persistence.status === "duplicate";
  if (saved) {
    if (!result.success || typeof persistence.id !== "string" || !UUID_PATTERN.test(persistence.id) ||
      Object.keys(persistence).some((key) => !["status", "id"].includes(key)))
      throw new AnalysisError("INVALID_RESPONSE");
    return { result, persistence: { status: persistence.status as "saved" | "duplicate", id: persistence.id } };
  }
  if ((persistence.status !== "failed" && persistence.status !== "not_saved") ||
    Object.keys(persistence).some((key) => key !== "status") ||
    (result.success ? persistence.status !== "failed" : persistence.status !== "not_saved"))
    throw new AnalysisError("INVALID_RESPONSE");
  return { result, persistence: { status: persistence.status } };
}

export const HAZARDOUS_SORTING =
  "Evsel çöpe veya normal geri dönüşüm kutusuna atma. Diğer atıklardan ayrı tut; belediyenin ya da yetkili kuruluşun bu atık için belirlediği toplama noktasına teslim et.";
export const HAZARDOUS_WARNING =
  "Sökme, delme, ezme, yakma veya içeriğini boşaltma. Şişmiş, sızdıran ya da hasarlı pil/cihazı kullanma veya şarj etme. Güvenli teslim için yetkili toplama kuruluşuna danış.";
export function applySafetyRules(result: WasteAnalysis): WasteAnalysis {
  if (!result.success) return result;
  const name = (result.wasteName ?? "").toLocaleLowerCase("tr-TR");
  const dangerousName =
    /(?:^|[^\p{L}])pil(?:ler|leri)?(?:[^\p{L}]|$)/u.test(name) ||
    /batarya|akü|elektronik|lityum|kimyasal|boya|solvent|ilaç|tıbbi|şırınga|cıva|ampul|floresan|pestisit|aerosol|telefon|bilgisayar/i.test(
      name,
    );
  if (
    result.hazardous ||
    result.category === "Pil" ||
    result.category === "Elektronik" ||
    dangerousName
  ) {
    return {
      ...result,
      hazardous: true,
      description:
        "Bu nesne özel toplama gerektirebilir. Fotoğraftan içeriği veya güvenli durumu kesin olarak belirlenemez.",
      sortingInstruction: HAZARDOUS_SORTING,
      recyclingAdvice:
        "Pil ve elektronik atık için yetkili ayrı toplama noktalarını; diğer tehlikeli atıklar için belediyenin uygun teslim yöntemini kullan. Yerel kuralları teslim noktasından doğrula.",
      safetyWarning: HAZARDOUS_WARNING,
    };
  }
  return result;
}

export const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    wasteName: { type: ["string", "null"] },
    category: { type: ["string", "null"], enum: [...CATEGORIES, null] },
    description: { type: "string" },
    sortingInstruction: { type: "string" },
    recyclingAdvice: { type: "string" },
    safetyWarning: { type: ["string", "null"] },
    objectCount: { type: "string", enum: ["none", "single", "multiple"] },
    uncertain: { type: "boolean" },
    hazardous: { type: "boolean" },
  },
  required: [
    "success",
    "wasteName",
    "category",
    "description",
    "sortingInstruction",
    "recyclingAdvice",
    "safetyWarning",
    "objectCount",
    "uncertain",
    "hazardous",
  ],
  additionalProperties: false,
};

export function upstreamError(status: number): AnalysisError {
  if (status === 429) return new AnalysisError("QUOTA_EXCEEDED");
  if (status === 401 || status === 403)
    return new AnalysisError("INVALID_API_KEY");
  if (status === 422) return new AnalysisError("INVALID_PHOTO");
  if (status === 408 || status === 504) return new AnalysisError("TIMEOUT");
  return new AnalysisError("SERVICE_ERROR");
}
export function edgeError(value: unknown, status: number): AnalysisError {
  try {
    const code = record(record(value).error).code;
    if (typeof code === "string" && Object.hasOwn(ERROR_MESSAGES, code))
      return new AnalysisError(code as AnalysisErrorCode);
  } catch {
    /* Gateway responses need not use our JSON contract. */
  }
  if (status === 401) return new AnalysisError("USER_UNAUTHORIZED");
  if (status === 403)
    return new AnalysisError("UNAUTHORIZED");
  if (status === 429) return new AnalysisError("RATE_LIMITED");
  if (status === 408 || status === 504) return new AnalysisError("TIMEOUT");
  return new AnalysisError("SERVICE_ERROR");
}
