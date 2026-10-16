import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "../auth/useAuth";
import { gamificationService } from "../services/gamification";
import type { GamificationService } from "../services/gamificationData";
import { createGamificationController, type GamificationMode } from "../services/gamificationController";

function useGamification(mode: GamificationMode, service: GamificationService, refreshOnFocus = true) {
  const { user, status, identityVersion } = useAuth();
  const userId = status === "authenticated" ? user?.id ?? "" : "";
  const scope = useMemo(() => ({ identityVersion, controller: createGamificationController(service, userId, mode) }),
    [service, userId, identityVersion, mode]);
  const controller = scope.controller;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(() => {
    void controller.start();
    return () => controller.dispose();
  }, [controller]);
  // Pausing refresh while a profile draft is being edited must not dispose or
  // restart its controller; explicit reload still works as a user action.
  useLayoutEffect(() => {
    if (!refreshOnFocus) return;
    const refresh = () => { if (document.visibilityState === "visible") void controller.reload(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [controller, refreshOnFocus]);
  return { ...snapshot, reload: controller.reload, save: controller.save, loadPage: controller.loadPage };
}
export const useProfile = (service: GamificationService = gamificationService, refreshOnFocus = true) => useGamification("profile", service, refreshOnFocus);
export const useArena = (service: GamificationService = gamificationService) => useGamification("arena", service);
