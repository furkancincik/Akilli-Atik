import {
  HistoryError,
  historyErrorMessage,
  type HistoryCursor,
  type HistoryRecord,
  type HistoryService,
} from "./historyData.ts";

export interface HistorySnapshot {
  items: readonly HistoryRecord[];
  detail: HistoryRecord | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  nextCursor: HistoryCursor | null;
  deletingId: string | null;
  deleteError: string | null;
}

function emptySnapshot(loading = false): HistorySnapshot {
  return {
    items: [], detail: null, loading, loadingMore: false, error: null,
    nextCursor: null, deletingId: null, deleteError: null,
  };
}

function mergeRecords(items: readonly HistoryRecord[], incoming: readonly HistoryRecord[], deleted: Set<string>) {
  const unique = new Map<string, HistoryRecord>();
  for (const item of [...items, ...incoming])
    if (!deleted.has(item.id) && !unique.has(item.id)) unique.set(item.id, item);
  // The service supplies canonical UTC timestamps with six fraction digits.
  // Date.parse would lose microseconds and break keyset order within one ms.
  return [...unique.values()].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? -1 : 1;
    return a.id === b.id ? 0 : a.id > b.id ? -1 : 1;
  });
}

/** One immutable account/route scope. No token, image or response is persisted. */
export function createHistoryController(service: HistoryService, userId: string, detailId?: string) {
  let snapshot = emptySnapshot(Boolean(userId));
  const listeners = new Set<() => void>();
  const deleted = new Set<string>();
  let active = false;
  let lifecycle = 0;
  let readVersion = 0;
  let readRequest: AbortController | null = null;
  let moreRequest: AbortController | null = null;
  let deleteRequest: AbortController | null = null;
  let initialLoad: Promise<void> | null = null;

  const notify = () => { for (const listener of listeners) listener(); };
  const publish = (changes: Partial<HistorySnapshot>) => {
    if (!active) return;
    snapshot = { ...snapshot, ...changes };
    notify();
  };
  const current = (generation: number, request: AbortController) =>
    active && lifecycle === generation && !request.signal.aborted;
  const unauthorized = (reason: unknown) => reason instanceof HistoryError && reason.code === "UNAUTHORIZED";
  const readFailure = (reason: unknown) => {
    if (unauthorized(reason)) {
      readVersion++;
      readRequest?.abort();
      moreRequest?.abort();
      deleteRequest?.abort();
      readRequest = null;
      moreRequest = null;
      deleteRequest = null;
      publish({ ...emptySnapshot(), error: historyErrorMessage(reason) });
    } else publish({ error: historyErrorMessage(reason) });
  };

  async function reload(): Promise<void> {
    if (!active || !userId) return;
    readRequest?.abort();
    moreRequest?.abort();
    moreRequest = null;
    const request = new AbortController();
    readRequest = request;
    const generation = lifecycle;
    const version = ++readVersion;
    publish({ loading: true, loadingMore: false, error: null });
    try {
      if (detailId !== undefined) {
        const detail = await service.get(userId, detailId, request.signal);
        if (!current(generation, request) || readVersion !== version) return;
        publish({ detail: detail && !deleted.has(detail.id) ? detail : null });
      } else {
        const page = await service.list(userId, null, request.signal);
        if (!current(generation, request) || readVersion !== version) return;
        publish({ items: mergeRecords([], page.items, deleted), nextCursor: page.nextCursor });
      }
    } catch (reason) {
      if (!current(generation, request) || readVersion !== version) return;
      if (detailId !== undefined && reason instanceof HistoryError && reason.code === "NOT_FOUND")
        publish({ detail: null, error: historyErrorMessage(reason) });
      else readFailure(reason);
    } finally {
      if (current(generation, request) && readVersion === version) publish({ loading: false });
      if (readRequest === request) readRequest = null;
    }
  }

  async function loadMore(): Promise<void> {
    if (!active || !userId || detailId !== undefined || snapshot.loading || snapshot.loadingMore || !snapshot.nextCursor)
      return;
    const cursor = snapshot.nextCursor;
    const request = new AbortController();
    moreRequest = request;
    const generation = lifecycle;
    const version = readVersion;
    publish({ loadingMore: true, error: null });
    try {
      const page = await service.list(userId, cursor, request.signal);
      if (!current(generation, request) || readVersion !== version) return;
      publish({ items: mergeRecords(snapshot.items, page.items, deleted), nextCursor: page.nextCursor });
    } catch (reason) {
      if (current(generation, request) && readVersion === version) readFailure(reason);
    } finally {
      if (current(generation, request) && readVersion === version) publish({ loadingMore: false });
      if (moreRequest === request) moreRequest = null;
    }
  }

  async function remove(id: string): Promise<boolean> {
    if (!active || !userId || deleteRequest ||
      !(snapshot.detail?.id === id || snapshot.items.some((item) => item.id === id))) return false;
    const request = new AbortController();
    deleteRequest = request;
    const generation = lifecycle;
    publish({ deletingId: id, deleteError: null });
    try {
      await service.remove(userId, id, request.signal);
      if (!current(generation, request)) return false;
      deleted.add(id);
      publish({
        items: snapshot.items.filter((item) => item.id !== id),
        detail: snapshot.detail?.id === id ? null : snapshot.detail,
      });
      return true;
    } catch (reason) {
      if (!current(generation, request)) return false;
      if (unauthorized(reason)) {
        readRequest?.abort();
        moreRequest?.abort();
        readVersion++;
        publish({ ...emptySnapshot(), error: historyErrorMessage(reason), deleteError: historyErrorMessage(reason) });
      } else publish({ deleteError: historyErrorMessage(reason) });
      return false;
    } finally {
      if (deleteRequest === request) deleteRequest = null;
      if (current(generation, request)) publish({ deletingId: null });
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start(): Promise<void> {
      if (active) return initialLoad ?? Promise.resolve();
      active = true;
      lifecycle++;
      initialLoad = reload();
      return initialLoad;
    },
    dispose() {
      active = false;
      lifecycle++;
      readVersion++;
      readRequest?.abort();
      moreRequest?.abort();
      deleteRequest?.abort();
      readRequest = null;
      moreRequest = null;
      deleteRequest = null;
      initialLoad = null;
      deleted.clear();
      snapshot = emptySnapshot();
      notify();
    },
    reload,
    loadMore,
    remove,
    clearDeleteError() { publish({ deleteError: null }); },
  };
}
