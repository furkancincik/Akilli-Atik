import { AnalysisError, ERROR_MESSAGES } from "../_shared/analysis.ts";
import {
  MAX_ANALYSIS_BYTES,
  readLimitedBody,
  validateAnalysisImage,
} from "../_shared/image.ts";
import { analyzeWithGemini, DEFAULT_MODEL } from "./gemini.ts";
import { requireTestAccess } from "./testAccess.ts";

export interface ServerConfig {
  enabled: boolean;
  apiKey: string;
  publicKeys: string[];
  allowedOrigins: string[];
  model?: string;
  testToken?: string;
  testExpiresAt?: string;
}

// Per-isolate safeguards only. Not a durable/distributed quota or user identity.
export function createLimiter(now: () => number = Date.now) {
  let active = 0;
  let hour = 0;
  let total = 0;
  const clients = new Map<string, { minute: number; count: number }>();
  return () => {
    const time = now();
    const currentHour = Math.floor(time / 3600000);
    const currentMinute = Math.floor(time / 60000);
    if (currentHour !== hour) {
      hour = currentHour;
      total = 0;
    }
    return (client: string) => {
      for (const [key, value] of clients)
        if (value.minute !== currentMinute) clients.delete(key);
      const previous = clients.get(client);
      if (
        active >= 2 ||
        total >= 30 ||
        (previous?.count ?? 0) >= 3 ||
        clients.size >= 1000
      )
        throw new AnalysisError("RATE_LIMITED");
      clients.set(client, {
        minute: currentMinute,
        count: (previous?.count ?? 0) + 1,
      });
      total++;
      active++;
      let released = false;
      return () => {
        if (!released) {
          active--;
          released = true;
        }
      };
    };
  };
}
function statusFor(error: AnalysisError): number {
  switch (error.code) {
    case "UNAUTHORIZED":
    case "ORIGIN_DENIED":
    case "TEST_ACCESS_REQUIRED":
      return 403;
    case "INVALID_PHOTO":
      return 400;
    case "RATE_LIMITED":
    case "QUOTA_EXCEEDED":
      return 429;
    case "METHOD_NOT_ALLOWED":
      return 405;
    case "TIMEOUT":
      return 504;
    case "SERVICE_DISABLED":
    case "MISSING_API_KEY":
      return 503;
    default:
      return 502;
  }
}
export function createHandler(
  config: ServerConfig,
  transport: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  const limiter = createLimiter(now);
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("Origin");
    const cors: Record<string, string> = {
      Vary: "Origin",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (origin && config.allowedOrigins.includes(origin)) {
      cors["Access-Control-Allow-Origin"] = origin;
      cors["Access-Control-Allow-Methods"] = "POST, OPTIONS";
      cors["Access-Control-Allow-Headers"] =
        "apikey, content-type, x-analysis-test-token";
    }
    const json = (value: unknown, status: number) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
      });
    let release: (() => void) | undefined;
    try {
      if (origin && !config.allowedOrigins.includes(origin))
        throw new AnalysisError("ORIGIN_DENIED");
      if (request.method === "OPTIONS")
        return new Response(null, { status: 204, headers: cors });
      if (request.method !== "POST")
        throw new AnalysisError("METHOD_NOT_ALLOWED");
      const publicKey = request.headers.get("apikey");
      if (
        !publicKey ||
        !config.publicKeys.length ||
        !config.publicKeys.includes(publicKey)
      )
        throw new AnalysisError("UNAUTHORIZED");
      if (!config.enabled) throw new AnalysisError("SERVICE_DISABLED");
      await requireTestAccess(
        request.headers.get("x-analysis-test-token"),
        config.testToken,
        config.testExpiresAt,
        now(),
      );
      if (!config.apiKey.trim()) throw new AnalysisError("MISSING_API_KEY");
      if (
        request.headers
          .get("Content-Type")
          ?.split(";")[0]
          .trim()
          .toLowerCase() !== "image/jpeg"
      )
        throw new AnalysisError("INVALID_PHOTO");
      const declaredSize = Number(request.headers.get("Content-Length"));
      if (declaredSize > MAX_ANALYSIS_BYTES)
        throw new AnalysisError("INVALID_PHOTO");
      // Forwarded IP is best-effort throttling, not authentication. Unknown peers share a bucket.
      const peer =
        request.headers
          .get("x-forwarded-for")
          ?.split(",")[0]
          .trim()
          .slice(0, 80) || "unknown";
      release = limiter()(peer);
      const readController = new AbortController();
      const readTimer = setTimeout(() => readController.abort(), 10000);
      let bytes: Uint8Array;
      try {
        bytes = await readLimitedBody(
          request.body,
          MAX_ANALYSIS_BYTES,
          "INVALID_PHOTO",
          readController.signal,
        );
      } finally {
        clearTimeout(readTimer);
      }
      validateAnalysisImage(bytes);
      const result = await analyzeWithGemini(
        bytes,
        config.apiKey,
        config.model ?? DEFAULT_MODEL,
        transport,
      );
      return json({ result }, 200);
    } catch (reason) {
      const error =
        reason instanceof AnalysisError
          ? reason
          : new AnalysisError("SERVICE_ERROR");
      // Never echo/log provider responses, images, credentials or exception details.
      return json(
        { error: { code: error.code, message: ERROR_MESSAGES[error.code] } },
        statusFor(error),
      );
    } finally {
      release?.();
    }
  };
}
