import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "../auth/useAuth";
import { createHistoryController } from "../services/historyController";
import { historyService } from "../services/history";
import type { HistoryService } from "../services/historyData";

export function useAnalysisHistory(detailId?: string, service: HistoryService = historyService) {
  const { user, status, identityVersion } = useAuth();
  const userId = status === "authenticated" ? user?.id ?? "" : "";
  // A changed account, route or identity generation reads an empty new store
  // immediately, before effect cleanup; old account data cannot flash on screen.
  const scope = useMemo(
    () => ({ identityVersion, controller: createHistoryController(service, userId, detailId) }),
    [service, userId, detailId, identityVersion],
  );
  const controller = scope.controller;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  // Dispose the old route/account during commit, before an awaited deletion
  // could resume against the newly displayed account and trigger navigation.
  useLayoutEffect(() => {
    void controller.start();
    return () => controller.dispose();
  }, [controller]);
  return {
    ...snapshot,
    reload: controller.reload,
    loadMore: controller.loadMore,
    remove: controller.remove,
    clearDeleteError: controller.clearDeleteError,
  };
}
