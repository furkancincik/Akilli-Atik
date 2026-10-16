import {
  AnalysisError,
  UUID_PATTERN,
  applySafetyRules,
  edgeError,
  parseAnalysis,
  parseAnalysisOutcome,
  record,
} from "../../supabase/functions/_shared/analysis.ts";
import type { AnalysisOutcome } from "../../supabase/functions/_shared/analysis.ts";
import {
  MAX_ANALYSIS_BYTES,
  readLimitedBody,
  validateAnalysisImage,
} from "../../supabase/functions/_shared/image.ts";

interface AnalysisSession {
  access_token: string;
  expires_at?: number;
  user: { id: string; is_anonymous?: boolean };
}
export interface AnalysisAuthPort {
  getSession(): Promise<{
    data: { session: AnalysisSession | null };
    error: unknown;
  }>;
  onAuthStateChange(
    callback: (event: string, session: AnalysisSession | null) => void,
  ): { data: { subscription: { unsubscribe(): void } } };
}
interface AnalysisRequestDependencies {
  accessMode?: "test" | "authenticated";
  auth: AnalysisAuthPort | null;
  configuration: { url: string; key: string } | null;
  online: boolean;
  transport?: typeof fetch;
  nowSeconds?: () => number;
}

/** Only SDK-owned sessions supply a bearer token; the local user ID is never sent. */
export async function requestAuthenticatedAnalysis(
  dependencies: AnalysisRequestDependencies,
  photo: Blob,
  signal: AbortSignal,
  testToken: string,
  clientRequestId: string,
  expectedUserId: string,
): Promise<AnalysisOutcome> {
  if (!dependencies.online) throw new AnalysisError("OFFLINE");
  const config = dependencies.configuration;
  if (!config) throw new AnalysisError("NOT_CONFIGURED");
  if (!dependencies.auth || !expectedUserId)
    throw new AnalysisError("USER_UNAUTHORIZED");
  if (dependencies.accessMode !== "authenticated" && !testToken.trim())
    throw new AnalysisError("TEST_ACCESS_REQUIRED");
  if (!UUID_PATTERN.test(clientRequestId)) throw new AnalysisError("INVALID_REQUEST_ID");
  if (photo.type !== "image/jpeg" || !photo.size || photo.size > MAX_ANALYSIS_BYTES)
    throw new AnalysisError("INVALID_PHOTO");

  const auth = dependencies.auth;
  const now = dependencies.nowSeconds ?? (() => Date.now() / 1000);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  let identityLost = false;
  // Synchronous listener: never call an SDK method from inside its auth lock.
  const { data: { subscription } } = auth.onAuthStateChange((event, session) => {
    if (
      event === "SIGNED_OUT" || event === "PASSWORD_RECOVERY" ||
      (session === null && event !== "INITIAL_SESSION") ||
      (session !== null && session.user.id !== expectedUserId)
    ) {
      identityLost = true;
      controller.abort();
    }
  });
  const assertActive = () => {
    if (identityLost) throw new AnalysisError("USER_UNAUTHORIZED");
    if (controller.signal.aborted) throw new AnalysisError("CANCELLED");
  };
  const readCurrentSession = async () => {
    let response: Awaited<ReturnType<AnalysisAuthPort["getSession"]>>;
    try {
      response = await auth.getSession();
    } catch {
      throw new AnalysisError("USER_UNAUTHORIZED");
    }
    assertActive();
    const { data, error } = response;
    const session = data.session;
    if (
      error || !session || session.user.id !== expectedUserId ||
      session.user.is_anonymous === true || !session.access_token ||
      !Number.isFinite(session.expires_at) || !session.expires_at || session.expires_at <= now()
    ) throw new AnalysisError("USER_UNAUTHORIZED");
    return session;
  };
  try {
    assertActive();
    validateAnalysisImage(new Uint8Array(await photo.arrayBuffer()));
    assertActive();
    const session = await readCurrentSession();
    // No asynchronous work between the final identity check and issuing fetch.
    const response = await (dependencies.transport ?? fetch)(
      `${config.url}/functions/v1/analyze-waste`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "image/jpeg",
          apikey: config.key,
          Authorization: `Bearer ${session.access_token}`,
          ...(dependencies.accessMode !== "authenticated" ? { "x-analysis-test-token": testToken.trim() } : {}),
          "x-client-request-id": clientRequestId,
        },
        body: photo,
      },
    );
    assertActive();
    let payload: unknown = null;
    try {
      const raw = await readLimitedBody(response.body, 64000, "INVALID_RESPONSE", controller.signal);
      payload = JSON.parse(new TextDecoder().decode(raw));
    } catch (reason) {
      assertActive();
      if (response.ok) throw new AnalysisError("INVALID_RESPONSE");
      if (reason instanceof AnalysisError && reason.code === "TIMEOUT") throw reason;
    }
    assertActive();
    if (!response.ok) throw edgeError(payload, response.status);
    // Validate the AI contract independently. Untrusted save metadata cannot
    // erase a valid result, and must never be presented as a successful save.
    const result = applySafetyRules(parseAnalysis(record(payload).result));
    let outcome: AnalysisOutcome;
    try {
      outcome = { ...parseAnalysisOutcome(payload), result };
    } catch {
      outcome = { result, persistence: { status: result.success ? "failed" : "not_saved" } };
    }
    // A stale result must not reach the next account, even if transport ignored abort.
    await readCurrentSession();
    return outcome;
  } catch (reason) {
    assertActive();
    throw reason;
  } finally {
    subscription.unsubscribe();
    signal.removeEventListener("abort", abort);
  }
}
