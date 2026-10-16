import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "../auth/useAuth";
import { createStatisticsController } from "../services/statisticsController";
import { statisticsService } from "../services/statistics";
import type { StatisticsService } from "../services/statisticsData";

export function useStatistics(service: StatisticsService = statisticsService) {
  const { user, status, identityVersion } = useAuth();
  const userId = status === "authenticated" ? user?.id ?? "" : "";
  const scope = useMemo(
    () => ({ identityVersion, controller: createStatisticsController(service, userId) }),
    [service, userId, identityVersion],
  );
  const controller = scope.controller;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(() => {
    void controller.start();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void controller.reload();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      // Clear private aggregates before the next identity can paint.
      controller.dispose();
    };
  }, [controller]);
  return { ...snapshot, reload: controller.reload };
}
