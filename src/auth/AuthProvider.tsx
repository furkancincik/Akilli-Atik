import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { createConfiguredSupabaseClient } from "../services/supabase";
import { createAuthController } from "../services/auth";
import type { AuthSnapshot } from "../services/auth";
import { AuthContext } from "./AuthContext";
import { getRecoveryRuntime, isRecoveryEntry, processPreparedRecovery } from "./recoveryRuntime";
import { getRecoveryRedirect } from "../services/passwordRecovery";
import type { RecoverySnapshot, PasswordRecoveryController } from "../services/passwordRecovery";

type Controller = ReturnType<typeof createAuthController>;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>({
    status: "loading", session: null, error: null, identityVersion: 0,
  });
  const controller = useRef<Controller | null>(null);
  const recoveryController = useRef<PasswordRecoveryController | null>(null);
  const [recovery, setRecovery] = useState<RecoverySnapshot>({ phase: "idle", error: null, passwordChanged: false });

  useEffect(() => {
    const client = createConfiguredSupabaseClient();
    const active = createAuthController(client?.auth ?? null, setSnapshot);
    controller.current = active;
    const recoveryRuntime = getRecoveryRuntime(() => controller.current?.blockForRecovery());
    recoveryController.current = recoveryRuntime;
    const unsubscribeRecovery = recoveryRuntime.subscribe(setRecovery);
    if (isRecoveryEntry()) active.blockForRecovery();
    let disposed = false;
    void active.start();
    // The shared runtime consumes single-use codes only once, including StrictMode.
    processPreparedRecovery(recoveryRuntime);
    // Native activity lifecycle is bridged through the already installed App plugin.
    const listener = Capacitor.isNativePlatform()
      ? NativeApp.addListener("appStateChange", ({ isActive }) => active.setActive(isActive))
      : null;
    if (listener) void listener.catch(() => active.setActive(false));
    if (Capacitor.isNativePlatform()) {
      void NativeApp.getState().then(({ isActive }) => {
        if (!disposed) active.setActive(isActive);
      }).catch(() => active.setActive(false));
    }
    // Explicit lifecycle management: pause/resume SDK refresh and reconcile expiry.
    const resume = () => {
      if (document.visibilityState === "visible") active.setActive(true);
      else active.setActive(false);
    };
    if (!Capacitor.isNativePlatform()) {
      document.addEventListener("visibilitychange", resume);
      resume();
    }
    return () => {
      disposed = true;
      active.dispose();
      unsubscribeRecovery();
      controller.current = null;
      document.removeEventListener("visibilitychange", resume);
      if (listener) void listener.then((handle) => handle.remove()).catch(() => {});
    };
  }, []);

  const value = useMemo(() => ({
    status: snapshot.status,
    user: snapshot.session?.user ?? null,
    error: snapshot.error,
    identityVersion: snapshot.identityVersion,
    login: (email: string, password: string) => {
      if (!controller.current) return Promise.reject(new Error("Oturum yükleniyor. Lütfen bekle."));
      return controller.current.login(email, password);
    },
    register: (email: string, password: string, confirmation: string) => {
      if (!controller.current) return Promise.reject(new Error("Oturum yükleniyor. Lütfen bekle."));
      return controller.current.register(email, password, confirmation);
    },
    logout: () => controller.current?.logout() ?? Promise.resolve(),
    recovery,
    requestPasswordReset: (email: string) => {
      if (Capacitor.isNativePlatform()) return Promise.reject(new Error("Parola kurtarma için web tarayıcısını kullan."));
      if (!recoveryController.current) return Promise.reject(new Error("Hesap hizmeti yükleniyor."));
      return recoveryController.current.send(email, getRecoveryRedirect(window.location.origin));
    },
    updateRecoveredPassword: (password: string, confirmation: string) => {
      if (!recoveryController.current) return Promise.reject(new Error("Hesap hizmeti yükleniyor."));
      return recoveryController.current.updatePassword(password, confirmation);
    },
    closeRecoverySession: () => {
      if (!recoveryController.current) return Promise.reject(new Error("Kurtarma oturumu kullanılamıyor."));
      return recoveryController.current.retryLogout();
    },
  }), [snapshot, recovery]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
