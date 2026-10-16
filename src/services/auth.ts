import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

export type AuthStatus = "loading" | "authenticated" | "anonymous" | "unavailable";
export interface AuthSnapshot {
  status: AuthStatus;
  session: Session | null;
  error: string | null;
  /** Changes the key of user-owned UI, so account changes discard its memory. */
  identityVersion: number;
}

type SessionResponse = { data: { session: Session | null }; error: unknown };
export interface AuthPort {
  getSession(): Promise<SessionResponse>;
  onAuthStateChange(
    callback: (event: AuthChangeEvent, session: Session | null) => void,
  ): { data: { subscription: { unsubscribe(): void } } };
  signInWithPassword(credentials: { email: string; password: string }): Promise<SessionResponse>;
  signUp(credentials: { email: string; password: string }): Promise<SessionResponse>;
  signOut(options: { scope: "local" }): Promise<{ error: unknown }>;
  startAutoRefresh(): void | Promise<void>;
  stopAutoRefresh(): void | Promise<void>;
}

export function validateAuthForm(
  mode: "login" | "register",
  email: string,
  password: string,
  confirmation?: string,
): { email: string; password: string } {
  const normalizedEmail = email.trim();
  if (!normalizedEmail || !password.trim())
    throw new Error("E-posta ve parola alanlarını doldurun.");
  if (
    normalizedEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  )
    throw new Error("Geçerli bir e-posta adresi girin.");
  // Login accepts existing passwords without imposing new registration rules.
  if (password.length > 128 || (mode === "register" && password.length < 8))
    throw new Error("Parolanız 8–128 karakter uzunluğunda olmalıdır.");
  if (mode === "register" && !confirmation)
    throw new Error("Parolanızı tekrar girin.");
  if (mode === "register" && password !== confirmation)
    throw new Error("Parolalar eşleşmiyor.");
  return { email: normalizedEmail, password };
}

/** Never render a provider message: it can contain request or account details. */
export function authErrorMessage(error: unknown): string {
  const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
  switch (details.code) {
    case "invalid_credentials":
    case "user_not_found":
      return "E-posta veya parola hatalı. Bilgilerinizi kontrol edin.";
    case "email_not_confirmed":
      return "Giriş yapmadan önce e-posta adresinizi doğrulayın.";
    case "user_already_exists":
    case "email_exists":
      return "Bu e-posta ile kayıt tamamlanamadı. Giriş yapmayı veya e-postanızı kontrol etmeyi deneyin.";
    case "weak_password":
      return "Parolanız yeterince güçlü değil. Daha uzun ve farklı karakterler içeren bir parola seçin.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Çok fazla deneme yapıldı. Bir süre bekleyip tekrar deneyin.";
    case "signup_disabled":
      return "Yeni kullanıcı kaydı şu anda kapalı. Daha sonra tekrar deneyin.";
    case "email_address_invalid":
    case "validation_failed":
      return "Girdiğiniz bilgileri kontrol edin ve tekrar deneyin.";
    case "session_not_found":
    case "refresh_token_not_found":
    case "refresh_token_already_used":
      return "Oturumunuz yenilenemedi. Lütfen tekrar giriş yapın.";
  }
  if (details.name === "AuthRetryableFetchError" || details.name === "TypeError")
    return "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.";
  return "Hesap işlemi tamamlanamadı. Lütfen tekrar deneyin.";
}

export interface AuthController {
  start(): Promise<void>;
  dispose(): void;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, confirmation: string): Promise<{ confirmationRequired: boolean }>;
  logout(): Promise<void>;
  setActive(active: boolean): void;
  blockForRecovery(): void;
}

const SESSION_EXPIRED = "Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.";
const UNAVAILABLE = "Hesap bağlantısı yapılandırılmamış. Lütfen proje yöneticisine başvurun.";
const LOGOUT_FAILED = "Bu ekrandaki oturum kapatıldı ancak cihazdaki oturum kaydı temizlenemedi. İnternet bağlantınızı kontrol edip çıkışı tekrar deneyin.";
const LOGOUT_PENDING = "Çıkış işlemi sürüyor. Tamamlandıktan sonra tekrar giriş yapabilir veya kayıt olabilirsiniz.";

/**
 * SDK owns storage and refresh tokens. This controller only keeps the current
 * session in memory, rejects expired sessions and protects async UI updates.
 */
export function createAuthController(
  auth: AuthPort | null,
  onChange: (snapshot: AuthSnapshot) => void,
  nowSeconds: () => number = () => Date.now() / 1000,
): AuthController {
  let snapshot: AuthSnapshot = {
    status: auth ? "loading" : "unavailable",
    session: null,
    error: auth ? null : UNAVAILABLE,
    identityVersion: 0,
  };
  let disposed = false;
  let active = true;
  let started: Promise<void> | null = null;
  let unsubscribe: (() => void) | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  let logoutBarrier = false;
  let recoveryBarrier = false;
  let signingOut = false;

  const valid = (session: Session | null): session is Session => Boolean(
    session?.user?.id && typeof session.expires_at === "number" &&
    Number.isFinite(session.expires_at) && session.expires_at > nowSeconds(),
  );
  const publish = (session: Session | null, error: string | null = null, reset = false) => {
    if (disposed) return;
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    const accepted = valid(session) ? session : null;
    const changed = snapshot.session?.user.id !== accepted?.user.id;
    snapshot = {
      status: auth ? (accepted ? "authenticated" : "anonymous") : "unavailable",
      session: accepted,
      error,
      identityVersion: snapshot.identityVersion + (changed || reset ? 1 : 0),
    };
    onChange(snapshot);
    if (accepted) {
      // Recheck the current clock when fired (also covers long/background waits).
      const expires = () => {
        if (disposed || snapshot.session !== accepted) return;
        if (!valid(accepted)) {
          revision += 1;
          publish(null, SESSION_EXPIRED);
          return;
        }
        expiryTimer = setTimeout(expires, Math.min(2_147_483_647, Math.max(1, (accepted.expires_at! - nowSeconds()) * 1000)));
      };
      expiryTimer = setTimeout(expires, Math.min(2_147_483_647, Math.max(1, (accepted.expires_at! - nowSeconds()) * 1000)));
    }
  };
  const refreshControl = (enabled: boolean) => {
    if (!auth) return;
    // SDK callbacks stay synchronous; do not await another Auth method inside them.
    try {
      const result = enabled ? auth.startAutoRefresh() : auth.stopAutoRefresh();
      void Promise.resolve(result).catch(() => {
        // The session expiry timer still fails closed if automatic refresh fails.
      });
    } catch {
      // An unavailable refresh mechanism must never extend a session's lifetime.
    }
  };
  const reconcile = async () => {
    if (!auth || disposed || logoutBarrier || recoveryBarrier) return;
    const observedRevision = revision;
    try {
      const result = await auth.getSession();
      if (disposed || logoutBarrier || recoveryBarrier || observedRevision !== revision) return;
      if (result.error) publish(null, authErrorMessage(result.error));
      else publish(result.data.session, result.data.session && !valid(result.data.session) ? SESSION_EXPIRED : null);
    } catch (error) {
      if (!disposed && !logoutBarrier && !recoveryBarrier && observedRevision === revision)
        publish(null, authErrorMessage(error));
    }
  };
  const requireAuth = (): AuthPort => {
    if (disposed || !auth) throw new Error(UNAVAILABLE);
    return auth;
  };
  const executeCredentials = async (mode: "login" | "register", email: string, password: string, confirmation?: string) => {
    const credentials = validateAuthForm(mode, email, password, confirmation);
    const port = requireAuth();
    // SDK signOut clears its storage after the network response. A new login
    // must not save a replacement session while that cleanup is still pending.
    if (signingOut) throw new Error(LOGOUT_PENDING);
    logoutBarrier = false;
    recoveryBarrier = false;
    const observedRevision = ++revision;
    try {
      const result = await (mode === "login" ? port.signInWithPassword(credentials) : port.signUp(credentials));
      if (result.error) throw result.error;
      if (!disposed && active && !logoutBarrier) refreshControl(true);
      if (disposed || observedRevision !== revision) return { confirmationRequired: !valid(result.data.session) };
      if (mode === "login" && !valid(result.data.session))
        throw new Error("missing_session");
      publish(result.data.session);
      return { confirmationRequired: !valid(result.data.session) };
    } catch (error) {
      const message = authErrorMessage(error);
      if (!disposed && observedRevision === revision) publish(snapshot.session, message);
      // eslint-disable-next-line preserve-caught-error -- Do not retain raw provider details in UI errors or their causes.
      throw new Error(message);
    }
  };

  return {
    start: () => {
      if (started) return started;
      if (disposed) return Promise.resolve();
      onChange(snapshot);
      if (!auth) return started = Promise.resolve();
      try {
        const subscription = auth.onAuthStateChange((event, session) => {
          if (disposed || (logoutBarrier && event !== "SIGNED_OUT")) return;
          if (event === "PASSWORD_RECOVERY") {
            recoveryBarrier = true;
            revision += 1;
            publish(null, null, true);
            refreshControl(false);
            return;
          }
          if (event === "SIGNED_OUT") recoveryBarrier = false;
          if (recoveryBarrier) return;
          revision += 1;
          publish(session, session && !valid(session) ? SESSION_EXPIRED : null, event === "SIGNED_OUT");
        });
        unsubscribe = () => subscription.data.subscription.unsubscribe();
        // Subscribe first: stale bootstrap must not undo a sign-in/sign-out event.
        started = reconcile();
        if (active && !recoveryBarrier) refreshControl(true);
      } catch (error) {
        publish(null, authErrorMessage(error));
        started = Promise.resolve();
      }
      return started;
    },
    dispose: () => {
      disposed = true;
      revision += 1;
      if (expiryTimer !== undefined) clearTimeout(expiryTimer);
      unsubscribe?.();
      refreshControl(false);
    },
    login: async (email, password) => { await executeCredentials("login", email, password); },
    register: (email, password, confirmation) => executeCredentials("register", email, password, confirmation),
    blockForRecovery: () => {
      recoveryBarrier = true;
      revision += 1;
      publish(null, null, true);
      refreshControl(false);
    },
    logout: async () => {
      const port = requireAuth();
      if (signingOut) throw new Error(LOGOUT_PENDING);
      signingOut = true;
      logoutBarrier = true;
      const observedRevision = ++revision;
      // Clear user-owned UI before waiting for a possibly unavailable server.
      publish(null, null, true);
      refreshControl(false);
      try {
        const result = await port.signOut({ scope: "local" });
        if (result.error) throw result.error;
      } catch {
        if (!disposed && logoutBarrier && observedRevision <= revision) publish(null, LOGOUT_FAILED);
        throw new Error(LOGOUT_FAILED);
      } finally { signingOut = false; }
    },
    setActive: (nextActive) => {
      if (disposed || active === nextActive) return;
      active = nextActive;
      refreshControl(active && !logoutBarrier && !recoveryBarrier);
      if (active) {
        if (snapshot.session && !valid(snapshot.session)) publish(null, SESSION_EXPIRED);
        void reconcile();
      }
    },
  };
}
