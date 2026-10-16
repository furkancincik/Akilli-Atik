import { AnalysisError } from "../_shared/analysis.ts";

export interface AnalysisAuthConfiguration {
  supabaseUrl: string;
  publicKey: string;
}

export interface VerifiedAnalysisUser {
  readonly id: string;
}

export const AUTH_TIMEOUT_MS = 8000;
const PROJECT_ORIGIN = "https://nyoxbwandadakfagoner.supabase.co";
const MAX_AUTH_RESPONSE_BYTES = 128 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authenticationUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.origin !== PROJECT_ORIGIN ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error();
    return `${url.origin}/auth/v1/user`;
  } catch {
    throw new AnalysisError("AUTH_UNAVAILABLE");
  }
}

async function readAuthUser(response: Response): Promise<unknown> {
  if (!response.body) throw new AnalysisError("AUTH_UNAVAILABLE");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let json = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUTH_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AnalysisError("AUTH_UNAVAILABLE");
      }
      json += decoder.decode(value, { stream: true });
    }
    json += decoder.decode();
    return JSON.parse(json);
  } finally {
    reader.releaseLock();
  }
}

/**
 * Verify the bearer token with this project's Supabase Auth server. No decoded
 * JWT claim or request-body user ID is trusted. The returned owner is immutable.
 * Local sign-out does not necessarily revoke an already issued access JWT;
 * Supabase remains responsible for its expiry and server-side validity.
 */
export async function verifyAnalysisUser(
  request: Request,
  configuration: AnalysisAuthConfiguration,
  transport: typeof fetch = fetch,
): Promise<Readonly<VerifiedAnalysisUser>> {
  const authorization = request.headers.get("authorization");
  if (!authorization || authorization.length > 8192)
    throw new AnalysisError("USER_UNAUTHORIZED");
  // This bounded shape check is only input validation, never JWT verification.
  const bearer = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(
    authorization,
  );
  if (!bearer) throw new AnalysisError("USER_UNAUTHORIZED");

  const url = authenticationUrl(configuration.supabaseUrl);
  if (
    !configuration.publicKey.trim() ||
    configuration.publicKey.length > 8192 ||
    /\s/.test(configuration.publicKey)
  )
    throw new AnalysisError("AUTH_UNAVAILABLE");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) controller.abort();

  try {
    controller.signal.throwIfAborted();
    const response = await transport(url, {
      method: "GET",
      headers: {
        apikey: configuration.publicKey,
        Authorization: `Bearer ${bearer[1]}`,
        Accept: "application/json",
      },
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    if ([401, 403, 422].includes(response.status))
      throw new AnalysisError("USER_UNAUTHORIZED");
    if (response.status !== 200) throw new AnalysisError("AUTH_UNAVAILABLE");

    const user = await readAuthUser(response);
    controller.signal.throwIfAborted();
    if (!user || typeof user !== "object" || Array.isArray(user))
      throw new AnalysisError("AUTH_UNAVAILABLE");
    const verified = user as Record<string, unknown>;
    if (
      typeof verified.id !== "string" ||
      !UUID.test(verified.id) ||
      verified.is_anonymous === true ||
      (verified.role !== undefined && verified.role !== "authenticated")
    )
      throw new AnalysisError("USER_UNAUTHORIZED");
    return Object.freeze({ id: verified.id });
  } catch (error) {
    if (error instanceof AnalysisError) throw error;
    // Raw provider responses and transport errors can contain credentials.
    throw new AnalysisError("AUTH_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
  }
}
