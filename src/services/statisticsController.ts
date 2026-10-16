import { statisticsErrorMessage, type StatisticsService, type StatisticsSummary } from "./statisticsData.ts";

export interface StatisticsSnapshot {
  summary: StatisticsSummary | null;
  loading: boolean;
  error: string | null;
}
const empty = (loading = false): StatisticsSnapshot => ({ summary: null, loading, error: null });

/** A single account scope; no personal aggregate is cached or persisted. */
export function createStatisticsController(service: StatisticsService, userId: string) {
  let snapshot = empty(Boolean(userId));
  const listeners = new Set<() => void>();
  let active = false;
  let generation = 0;
  let request: AbortController | null = null;
  let pending: Promise<void> | null = null;
  const notify = () => { for (const listener of listeners) listener(); };
  const publish = (next: StatisticsSnapshot) => {
    if (!active) return;
    snapshot = next;
    notify();
  };
  function reload(): Promise<void> {
    if (!active || !userId) return Promise.resolve();
    if (pending) return pending;
    const currentRequest = new AbortController();
    request = currentRequest;
    const currentGeneration = generation;
    const current = () => active && currentGeneration === generation && !currentRequest.signal.aborted;
    pending = Promise.resolve().then(async () => {
      try {
        if (!current()) return;
        const summary = await service.load(userId, currentRequest.signal);
        if (current()) publish({ summary, loading: false, error: null });
      } catch (error) {
        if (current()) publish({ summary: null, loading: false, error: statisticsErrorMessage(error) });
      } finally {
        if (request === currentRequest) { request = null; pending = null; }
      }
    });
    // Reserve the request before notifying subscribers, which may request a
    // refresh themselves. Never expose an old or partial total as current.
    publish(empty(true));
    return pending;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start() {
      if (active) return pending ?? Promise.resolve();
      active = true;
      generation++;
      return reload();
    },
    reload,
    dispose() {
      active = false;
      generation++;
      request?.abort();
      request = null;
      pending = null;
      snapshot = empty();
      notify();
    },
  };
}
