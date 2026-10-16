import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfiguration } from "../services/supabase";
import { createRecoveryStorage } from "../services/recoveryStorage";
import { createPasswordRecoveryController, parseRecoveryCallback, RECOVERY_PATH } from "../services/passwordRecovery";
import type { RecoveryCallback, RecoveryPort, PasswordRecoveryController } from "../services/passwordRecovery";

let prepared = false;
let recoveryEntry = false;
let callback: RecoveryCallback | null = null;
let sharedRecovery: PasswordRecoveryController | undefined;
let begin: () => void = () => {};

// Called once before React/SDK boot. The code/flow ID stay in memory, not DOM/logs.
export function prepareRecoveryCallback() {
  if (prepared || typeof window === "undefined") return;
  prepared = true;
  recoveryEntry = window.location.pathname === RECOVERY_PATH;
  if (!recoveryEntry) return;
  try { callback = parseRecoveryCallback(window.location.href, window.location.origin); }
  catch { callback = null; }
  // Remove the complete query/hash before any Auth request or route render.
  window.history.replaceState(window.history.state, "", RECOVERY_PATH);
}

export function isRecoveryEntry() { return recoveryEntry; }

export function getRecoveryRuntime(onBegin: () => void) {
  begin = onBegin;
  if (sharedRecovery) return sharedRecovery;
  const config = getSupabaseConfiguration();
  // Only PKCE verifiers survive navigation. Recovery sessions remain in memory,
  // on a separate SDK channel, and can never replace a normal account session.
  const storageKey = `akilli-atik-recovery-${crypto.randomUUID()}`;
  const client = (() => {
    if (!config) return null;
    try {
      return createClient(config.url, config.key, {
        auth: {
          persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
          flowType: "pkce", storageKey,
          storage: createRecoveryStorage(storageKey, window.localStorage),
        },
      });
    } catch { return null; } // Blocked browser storage fails closed without breaking normal Auth.
  })();
  const port: RecoveryPort | null = client && config ? {
    resetPasswordForEmail: (email, options) => client.auth.resetPasswordForEmail(email, options),
    exchangeCodeForSession: (code, options) => client.auth.exchangeCodeForSession(code, options),
    getSession: () => client.auth.getSession(),
    getUser: () => client.auth.getUser(),
    signOut: async (options, verified) => {
      const current = await client.auth.getSession();
      if (!current.error && !current.data.session) {
        // SDK signOut clears local memory even when its HTTP request fails.
        // Retry server revocation using only the captured recovery token. This
        // is the public logout endpoint; it does not use an admin/service key.
        const result = await client.auth.admin.signOut(verified.access_token, options.scope);
        return { error: result.error && ![401, 403, 404].includes(result.error.status ?? 0) ? result.error : null };
      }
      if (current.error || current.data.session?.access_token !== verified.access_token ||
        current.data.session.user.id !== verified.user.id)
        throw new Error("Kurtarma oturumu değişti.");
      // This SDK instance has no normal sign-in entry point and no shared
      // session storage. signOut can only close its own recovery session.
      return client.auth.signOut(options);
    },
    onAuthStateChange: (listener) => client.auth.onAuthStateChange(listener),
    updateUser: async (attributes, verified) => {
      const current = await client.auth.getSession();
      if (current.error || current.data.session?.access_token !== verified.access_token ||
        current.data.session.user.id !== verified.user.id ||
        !verified.expires_at || verified.expires_at <= Date.now() / 1000)
        throw new Error("Kurtarma oturumu doğrulanamadı.");
      return client.auth.updateUser(attributes);
    },
  } : null;
  sharedRecovery = createPasswordRecoveryController(port, () => begin());
  return sharedRecovery;
}

export function processPreparedRecovery(runtime: PasswordRecoveryController) {
  // Errors are already published as safe UI state; never leak rejected callbacks.
  if (recoveryEntry) void runtime.processCallback(callback).catch(() => {});
}
