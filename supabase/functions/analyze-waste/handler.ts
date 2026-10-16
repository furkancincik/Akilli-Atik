import { AnalysisError, ERROR_MESSAGES, UUID_PATTERN, type AnalysisOutcome } from "../_shared/analysis.ts";
import {
  MAX_ANALYSIS_BYTES,
  readLimitedBody,
  validateAnalysisImage,
} from "../_shared/image.ts";
import { analyzeWithGemini, DEFAULT_MODEL } from "./gemini.ts";
import { requireTestAccess } from "./testAccess.ts";
import { verifyAnalysisUser, type VerifiedAnalysisUser } from "./authentication.ts";
import { createAnalysisStore, type AnalysisStore } from "./storage.ts";
import { createAnalysisDeadline, createUserAnalysisDeadline, type AnalysisDeadline } from "./deadline.ts";
import { createAnalysisQuota, type AnalysisQuota } from "./quota.ts";

export interface ServerConfig {
  accessMode?: "test" | "authenticated";
  enabled: boolean;
  apiKey: string;
  publicKeys: string[];
  allowedOrigins: string[];
  model?: string;
  testToken?: string;
  testExpiresAt?: string;
  supabaseUrl?: string;
  serviceRoleKey?: string;
}

export interface HandlerDependencies {
  quota?: AnalysisQuota;
  verifyUser?: (request: Request) => Promise<Readonly<VerifiedAnalysisUser>>;
  store?: AnalysisStore;
  analyze?: typeof analyzeWithGemini;
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
    case "USER_UNAUTHORIZED":
      return 401;
    case "UNAUTHORIZED":
    case "ORIGIN_DENIED":
    case "TEST_ACCESS_REQUIRED":
      return 403;
    case "INVALID_PHOTO":
    case "INVALID_REQUEST_ID":
      return 400;
    case "REQUEST_ALREADY_USED":
      return 409;
    case "RATE_LIMITED":
    case "QUOTA_EXCEEDED":
      return 429;
    case "METHOD_NOT_ALLOWED":
      return 405;
    case "TIMEOUT":
      return 504;
    case "SERVICE_DISABLED":
    case "MISSING_API_KEY":
    case "AUTH_UNAVAILABLE":
    case "QUOTA_UNAVAILABLE":
      return 503;
    default:
      return 502;
  }
}
export function createHandler(
  config: ServerConfig,
  transport: typeof fetch = fetch,
  now: () => number = Date.now,
  dependencies: HandlerDependencies = {},
) {
  const limiter = createLimiter(now);
  const verifyUser = dependencies.verifyUser ?? ((request: Request) => verifyAnalysisUser(
    request, { supabaseUrl: config.supabaseUrl ?? "", publicKey: config.publicKeys[0] ?? "" }, transport,
  ));
  const analyze = dependencies.analyze ?? analyzeWithGemini;
  // Bound by the existing two-active-request limiter; no persistent image/result cache.
  // Other isolates can still call Gemini concurrently. UNIQUE only deduplicates rows.
  const inFlight = new Map<string, Promise<AnalysisOutcome>>();
  let store = dependencies.store;
  function analysisStore(): AnalysisStore {
    return store ??= createAnalysisStore({
      supabaseUrl: config.supabaseUrl ?? "", serviceRoleKey: config.serviceRoleKey ?? "",
    }, transport);
  }
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
        "apikey, authorization, content-type, x-analysis-test-token, x-client-request-id";
    }
    const json = (value: unknown, status: number) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
      });
    let release: (() => void) | undefined;
    let deadline: AnalysisDeadline | undefined;
    let reservation: { userId: string; requestId: string; leaseId: string } | undefined;
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
      const normalMode = config.accessMode === "authenticated";
      deadline = normalMode ? createUserAnalysisDeadline(now) : createAnalysisDeadline(config.testExpiresAt, now);
      if (!normalMode) await requireTestAccess(
        request.headers.get("x-analysis-test-token"),
        config.testToken,
        config.testExpiresAt,
        now(),
      );
      // Include Auth verification in the admission limit, not only Gemini calls.
      const peer = request.headers.get("x-forwarded-for")?.split(",")[0].trim().slice(0, 80) || "unknown";
      release = limiter()(peer);
      const user = await verifyUser(request);
      deadline.assertOpen();
      const requestId = request.headers.get("x-client-request-id");
      if (!requestId || !UUID_PATTERN.test(requestId))
        throw new AnalysisError("INVALID_REQUEST_ID");
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
      const readController = new AbortController();
      const readTimer = setTimeout(() => readController.abort(), 10000);
      const abortRead = () => readController.abort();
      deadline.signal.addEventListener("abort", abortRead, { once: true });
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
        deadline.signal.removeEventListener("abort", abortRead);
      }
      deadline.assertOpen();
      validateAnalysisImage(bytes);
      if (request.signal.aborted) throw new AnalysisError("CANCELLED");
      if (normalMode) {
        const quota = dependencies.quota ?? createAnalysisQuota({
          supabaseUrl: config.supabaseUrl ?? "", serviceRoleKey: config.serviceRoleKey ?? "",
        }, transport);
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer)))
          .map((byte) => byte.toString(16).padStart(2, "0")).join("");
        const admission = await quota.reserve(user.id, requestId, digest);
        deadline.assertOpen();
        if (admission.status === "limited") throw new AnalysisError("RATE_LIMITED");
        if (admission.status === "conflict") throw new AnalysisError("INVALID_REQUEST_ID");
        if (admission.status === "duplicate") {
          const previous = await analysisStore().find(user.id, requestId);
          deadline.assertOpen();
          if (!previous) throw new AnalysisError("REQUEST_ALREADY_USED");
          return json({ result: previous.result, persistence: { status: "duplicate", id: previous.id } }, 200);
        }
        reservation = { userId: user.id, requestId, leaseId: admission.leaseId };
      }
      const key = `${user.id.toLowerCase()}:${requestId.toLowerCase()}`;
      const pending = inFlight.get(key);
      if (pending) {
        const outcome = await pending;
        deadline.assertOpen();
        return json({ ...outcome, persistence: outcome.persistence.status === "saved"
          ? { ...outcome.persistence, status: "duplicate" } : outcome.persistence }, 200);
      }
      const operationDeadline = deadline;
      const operation = (async (): Promise<AnalysisOutcome> => {
        let existing;
        try {
          existing = await analysisStore().find(user.id, requestId);
        } catch {
          // A database outage must not hide a subsequently valid Gemini result.
        }
        operationDeadline.assertOpen();
        if (existing) return { result: existing.result, persistence: { status: "duplicate", id: existing.id } };
        const model = config.model ?? DEFAULT_MODEL;
        const result = await analyze(bytes, config.apiKey, model, transport, operationDeadline);
        operationDeadline.assertOpen();
        if (!result.success) return { result, persistence: { status: "not_saved" } };
        if (request.signal.aborted) throw new AnalysisError("CANCELLED");
        // Do not turn an expired execution window into a successful analysis
        // with a failed save. No INSERT may begin after this cutoff.
        operationDeadline.assertOpen();
        try {
          const saved = await analysisStore().save(user.id, requestId, result, model);
          operationDeadline.assertOpen();
          return { result: saved.result, persistence: { status: saved.status, id: saved.id } };
        } catch {
          operationDeadline.assertOpen();
          return { result, persistence: { status: "failed" } };
        }
      })();
      inFlight.set(key, operation);
      try {
        return json(await operation, 200);
      } finally {
        inFlight.delete(key);
      }
    } catch (reason) {
      // Body readers may report TIMEOUT when the hard deadline aborts them.
      // Preserve the stronger closed-service response at the outer boundary.
      let failure = reason;
      if (deadline) {
        try { deadline.assertOpen(); }
        catch { failure = new AnalysisError("SERVICE_DISABLED"); }
      }
      const error =
        failure instanceof AnalysisError
          ? failure
          : new AnalysisError("SERVICE_ERROR");
      // Never echo/log provider responses, images, credentials or exception details.
      return json(
        { error: { code: error.code, message: ERROR_MESSAGES[error.code] } },
        statusFor(error),
      );
    } finally {
      if (reservation) {
        try {
          const quota = dependencies.quota ?? createAnalysisQuota({
            supabaseUrl: config.supabaseUrl ?? "", serviceRoleKey: config.serviceRoleKey ?? "",
          }, transport);
          await quota.finish(reservation.userId, reservation.requestId, reservation.leaseId);
        } catch { /* No refund or retry. The short lease expires, durable budget stays spent. */ }
      }
      deadline?.dispose();
      release?.();
    }
  };
}
