import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";

export const RECOVERY_PATH = "/parola-yenile";
export const FORGOT_PATH = "/sifremi-unuttum";
export interface RecoveryCallback { code: string; flowId?: string }
export interface RecoverySnapshot {
  phase: "idle" | "checking" | "ready" | "saving" | "complete" | "error";
  error: string | null;
  passwordChanged: boolean;
}
type SessionResult = { data: { session: Session | null }; error: unknown };
export interface RecoveryPort {
  resetPasswordForEmail(email: string, options: { redirectTo: string }): Promise<{ error: unknown }>;
  exchangeCodeForSession(code: string, options?: { flowId?: string }): Promise<{
    data: { session: Session | null; user?: User | null; redirectType?: string | null };
    error: unknown;
  }>;
  getSession(): Promise<SessionResult>;
  getUser(): Promise<{ data: { user: User | null }; error: unknown }>;
  /** The adapter must bind updateUser to this verified session, never shared storage. */
  updateUser(attributes: { password: string }, verifiedSession: Session): Promise<{
    data: { user: User | null }; error: unknown;
  }>;
  signOut(options: { scope: "local" }, verifiedSession: Session): Promise<{ error: unknown }>;
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): {
    data: { subscription: { unsubscribe(): void } } };
}
export interface PasswordRecoveryController {
  subscribe(listener: (snapshot: RecoverySnapshot) => void): () => void;
  getSnapshot(): RecoverySnapshot;
  processCallback(callback: RecoveryCallback | null): Promise<void>;
  send(email: string, redirectTo: string): Promise<void>;
  updatePassword(password: string, confirmation: string): Promise<void>;
  retryLogout(): Promise<void>;
  dispose(): void;
}

const INVALID_LINK = "Parola yenileme bağlantısı geçersiz, kullanılmış veya süresi dolmuş. Yeni bir bağlantı isteyin.";
const UNAVAILABLE = "Hesap bağlantısı kullanılamıyor. Lütfen daha sonra tekrar deneyin.";
const SESSION_CHANGED = "Kurtarma oturumu değişti. Güvenliğiniz için yeni bir parola yenileme bağlantısı isteyin.";
const UPDATE_FAILED = "Parola güncellenemedi. Yeni bir parola yenileme bağlantısı isteyin.";
const LOGOUT_FAILED = "Parolanız değiştirildi ancak kurtarma oturumu kapatılamadı. Bu ekrandaki oturumu kapatma düğmesiyle tekrar deneyin.";
const MAX_AUTHORITY_SECONDS = 600;
const EMAIL_LIMIT = "E-posta gönderim sınırına ulaşıldı. Önceki istekler veya projenin e-posta kotası nedeniyle işlem geçici olarak engellendi. Daha sonra tekrar deneyin.";
const REQUEST_LIMIT = "Kısa sürede çok fazla istek alındı. Bir süre bekleyip tekrar deneyin.";
const NETWORK_ERROR = "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.";
const SEND_FAILED = "Parola yenileme isteği tamamlanamadı. Daha sonra tekrar deneyin.";
const SERVICE_ERROR = "E-posta hizmeti şu anda kullanılamıyor. Daha sonra tekrar deneyin.";
const SEND_IN_PROGRESS = "Parola yenileme isteği sürüyor. Lütfen tamamlanmasını bekleyin.";
const tokenPart = (value: string) => value.length > 0 && value.length <= 2048 && /^[A-Za-z0-9._~-]+$/.test(value);

export function validateRecoveryEmail(email: string): string {
  const value = email.trim();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    throw new Error("Geçerli bir e-posta adresi girin.");
  return value;
}

export function validateNewPassword(password: string, confirmation: string): string {
  if (!password.trim() || password.length < 8 || password.length > 128)
    throw new Error("Parolanız 8–128 karakter uzunluğunda olmalıdır.");
  if (password !== confirmation) throw new Error("Parolalar eşleşmiyor.");
  return password;
}

/** Only code-based, same-origin PKCE callbacks are accepted. URL flags are not recovery authority. */
export function parseRecoveryCallback(href: string, expectedOrigin: string): RecoveryCallback | null {
  let url: URL;
  let origin: URL;
  try { url = new URL(href); origin = new URL(expectedOrigin); }
  catch { throw new Error(INVALID_LINK); }
  if (url.origin !== origin.origin || url.pathname !== RECOVERY_PATH) return null;
  const query = url.searchParams;
  if (url.username || url.password || url.hash || [...query.keys()].some((key) =>
    key.startsWith("error") || ["access_token", "refresh_token", "token", "token_hash"].includes(key)))
    throw new Error(INVALID_LINK);
  const codes = query.getAll("code");
  const flows = query.getAll("sb_flow_id");
  if (codes.length !== 1 || !tokenPart(codes[0]) || flows.length > 1 ||
    (flows.length === 1 && !tokenPart(flows[0]))) throw new Error(INVALID_LINK);
  return { code: codes[0], ...(flows.length === 1 ? { flowId: flows[0] } : {}) };
}

export function getRecoveryRedirect(origin: string): string {
  let url: URL;
  try { url = new URL(origin); } catch { throw new Error("Parola kurtarma yönlendirmesi yapılandırılmamış."); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
    !(url.protocol === "https:" || (url.protocol === "http:" && local)) ||
    (url.protocol === "https:" && local))
    throw new Error("Parola kurtarma için güvenli bir web adresi gereklidir.");
  return `${url.origin}${RECOVERY_PATH}`;
}

function sendError(error: unknown): string | null {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  if (["user_not_found", "email_not_found", "identity_not_found"].includes(String(value.code))) return null;
  // The email code covers both project quota and per-recipient cooldown.
  // Do not infer a retry duration or account existence from the provider text.
  if (value.code === "over_email_send_rate_limit") return EMAIL_LIMIT;
  if (value.code === "over_request_rate_limit" || value.status === 429) return REQUEST_LIMIT;
  if (typeof value.status === "number" && value.status >= 500) return SERVICE_ERROR;
  if (value.name === "AuthRetryableFetchError" || value.name === "TypeError")
    return NETWORK_ERROR;
  return SEND_FAILED;
}

/**
 * Recovery authority is short-lived memory, proven by both PKCE recovery type and
 * PASSWORD_RECOVERY, then checked against the server. An ordinary session can
 * never enter the ready phase. SDK callbacks stay synchronous to avoid auth locks.
 */
export function createPasswordRecoveryController(
  auth: RecoveryPort | null,
  onBegin: () => void = () => {},
  nowSeconds: () => number = () => Date.now() / 1000,
): PasswordRecoveryController {
  let snapshot: RecoverySnapshot = { phase: "idle", error: null, passwordChanged: false };
  const listeners = new Set<(snapshot: RecoverySnapshot) => void>();
  let disposed = false;
  let revision = 0;
  let processing: Promise<void> | null = null;
  let candidate: Session | null = null;
  let authority: { session: Session; until: number; revision: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let signingOut = false;
  let pendingLogout: Session | null = null;
  let sending = false;
  const publish = (phase: RecoverySnapshot["phase"], error: string | null = null, passwordChanged = snapshot.passwordChanged) => {
    if (disposed) return;
    snapshot = { phase, error, passwordChanged };
    for (const listener of listeners) listener(snapshot);
  };
  const clearAuthority = () => {
    authority = null;
    candidate = null;
    if (timer !== undefined) clearTimeout(timer);
  };
  const valid = (session: Session | null): session is Session => Boolean(session?.user?.id &&
    session.access_token && Number.isFinite(session.expires_at) && session.expires_at! > nowSeconds());
  const same = (a: Session | null, b: Session | null) => Boolean(a && b &&
    a.user.id === b.user.id && a.access_token === b.access_token);
  const reject = (message = INVALID_LINK): never => {
    clearAuthority();
    publish("error", message);
    throw new Error(message);
  };
  const currentError = (fallback: string) => snapshot.phase === "error" && snapshot.error ? snapshot.error : fallback;
  const finishLogout = async (verifiedSession: Session) => {
    if (disposed || !auth) return reject(UNAVAILABLE);
    signingOut = true;
    try {
      const result = await auth.signOut({ scope: "local" }, verifiedSession);
      if (result.error) return reject(LOGOUT_FAILED);
      pendingLogout = null;
      clearAuthority();
      publish("complete", null, true);
    } catch {
      return reject(LOGOUT_FAILED);
    } finally { signingOut = false; }
  };
  const scheduleExpiry = () => {
    if (!authority) return;
    const expected = authority;
    const expire = () => {
      if (disposed || authority !== expected) return;
      if (nowSeconds() >= expected.until) {
        revision += 1;
        clearAuthority();
        publish("error", INVALID_LINK);
      } else timer = setTimeout(expire, Math.max(1, (expected.until - nowSeconds()) * 1000));
    };
    timer = setTimeout(expire, Math.max(1, (expected.until - nowSeconds()) * 1000));
  };
  const subscription = auth?.onAuthStateChange((event, session) => {
    if (disposed) return;
    if (event === "PASSWORD_RECOVERY" && snapshot.phase === "checking") {
      candidate = valid(session) ? session : null;
      return;
    }
    const sensitive = snapshot.phase === "checking" || snapshot.phase === "ready" || snapshot.phase === "saving";
    const relevantSession = authority?.session ?? candidate;
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" ||
      (sensitive && event !== "INITIAL_SESSION" && relevantSession && !same(session, relevantSession))) {
      revision += 1;
      clearAuthority();
      if (sensitive && !signingOut) publish("error", SESSION_CHANGED);
    }
  }).data.subscription;

  return {
    subscribe: (listener) => { listeners.add(listener); listener(snapshot); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    processCallback: (callback) => {
      // A single controller survives React StrictMode and exchanges at most once.
      if (processing) return processing;
      processing = (async () => {
        if (disposed || !auth) return reject(UNAVAILABLE);
        if (!callback || !tokenPart(callback.code) || (callback.flowId !== undefined && !tokenPart(callback.flowId))) return reject();
        const expectedRevision = ++revision;
        clearAuthority();
        publish("checking");
        try {
          onBegin();
          const result = await auth.exchangeCodeForSession(callback.code, callback.flowId ? { flowId: callback.flowId } : undefined);
          if (disposed || expectedRevision !== revision) return reject(SESSION_CHANGED);
          const session = result.data.session;
          if (result.error || result.data.redirectType !== "recovery" || !valid(session) || !same(session, candidate)) return reject();
          const checked = await auth.getUser();
          if (disposed || expectedRevision !== revision) return reject(SESSION_CHANGED);
          if (checked.error || checked.data.user?.id !== session.user.id || !valid(session)) return reject();
          authority = { session, until: Math.min(session.expires_at!, nowSeconds() + MAX_AUTHORITY_SECONDS), revision };
          candidate = null;
          publish("ready");
          scheduleExpiry();
        } catch {
          return reject(currentError(INVALID_LINK));
        }
      })();
      return processing;
    },
    send: async (email, redirectTo) => {
      const normalized = validateRecoveryEmail(email);
      // A caller cannot silently replace the expected recovery path or add tokens.
      let redirect: URL;
      try { redirect = new URL(redirectTo); } catch { throw new Error("Parola kurtarma yönlendirmesi geçersiz."); }
      if (getRecoveryRedirect(redirect.origin) !== redirectTo) throw new Error("Parola kurtarma yönlendirmesi geçersiz.");
      if (disposed || !auth) throw new Error(UNAVAILABLE);
      // Also protect callers outside the form or across route remounts.
      if (sending) throw new Error(SEND_IN_PROGRESS);
      sending = true;
      try {
        const result = await auth.resetPasswordForEmail(normalized, { redirectTo });
        if (result.error) {
          const message = sendError(result.error);
          if (message) throw new Error(message);
        }
      } catch (error) {
        // Keep only our fixed messages; never propagate provider details or causes.
        const safe = error instanceof Error && [
          EMAIL_LIMIT, REQUEST_LIMIT, NETWORK_ERROR, SEND_FAILED, SERVICE_ERROR,
        ].includes(error.message) ? error.message : sendError(error);
        // eslint-disable-next-line preserve-caught-error -- Do not retain provider messages, tokens or account details in error causes.
        if (safe) throw new Error(safe);
      } finally { sending = false; }
    },
    updatePassword: async (password, confirmation) => {
      const checkedPassword = validateNewPassword(password, confirmation);
      if (disposed || !auth) return reject(UNAVAILABLE);
      const permission = authority;
      if (!permission || snapshot.phase !== "ready" || nowSeconds() >= permission.until || !valid(permission.session)) return reject();
      publish("saving");
      const stable = () => !disposed && authority === permission && revision === permission.revision &&
        nowSeconds() < permission.until && valid(permission.session);
      try {
        const current = await auth.getSession();
        if (!stable() || current.error || !same(current.data.session, permission.session)) return reject(SESSION_CHANGED);
        const server = await auth.getUser();
        if (!stable() || server.error || server.data.user?.id !== permission.session.user.id) return reject(SESSION_CHANGED);
        const result = await auth.updateUser({ password: checkedPassword }, permission.session);
        if (result.error || result.data.user?.id !== permission.session.user.id) return reject(UPDATE_FAILED);
        pendingLogout = permission.session;
        publish("saving", null, true);
        if (!stable()) return reject("Parolanız değiştirildi ancak oturum değişti. Güvenliğiniz için tekrar giriş yapın.");
        const currentAfterUpdate = await auth.getSession();
        if (!stable() || currentAfterUpdate.error || !same(currentAfterUpdate.data.session, permission.session))
          return reject("Parolanız değiştirildi ancak oturum değişti. Güvenliğiniz için tekrar giriş yapın.");
        clearAuthority();
        await finishLogout(permission.session);
      } catch {
        signingOut = false;
        return reject(currentError(snapshot.passwordChanged ? LOGOUT_FAILED : UPDATE_FAILED));
      }
    },
    retryLogout: async () => {
      if (!snapshot.passwordChanged || !pendingLogout || snapshot.phase !== "error")
        throw new Error("Yeniden kapatılacak doğrulanmış bir kurtarma oturumu bulunmuyor.");
      publish("saving", null, true);
      await finishLogout(pendingLogout);
    },
    dispose: () => { disposed = true; revision += 1; clearAuthority(); subscription?.unsubscribe(); listeners.clear(); },
  };
}
