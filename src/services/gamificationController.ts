import {
  GamificationError, gamificationErrorMessage,
  type GameArena, type GameProfile, type GamificationService, type ProfilePreferences,
} from "./gamificationData.ts";

export interface GamificationSnapshot {
  profile: GameProfile | null;
  arena: GameArena | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  saveError: string | null;
}
export type GamificationMode = "profile" | "arena";
const empty = (loading = false): GamificationSnapshot => ({
  profile: null, arena: null, loading, saving: false, error: null, saveError: null,
});

/** Each account/mode owns its memory. No profile or public ranks are persisted. */
export function createGamificationController(service: GamificationService, userId: string, mode: GamificationMode) {
  let snapshot = empty(Boolean(userId));
  const listeners = new Set<() => void>();
  let active = false;
  let generation = 0;
  let readVersion = 0;
  let reading: AbortController | null = null;
  let saving: AbortController | null = null;
  let pending: Promise<void> | null = null;
  let requestedOffset = 0;
  const notify = () => { for (const listener of listeners) listener(); };
  const publish = (changes: Partial<GamificationSnapshot>) => {
    if (!active) return;
    snapshot = { ...snapshot, ...changes };
    notify();
  };
  const current = (scope: number, request: AbortController) => active && scope === generation && !request.signal.aborted;
  const unauthorized = (reason: unknown) => reason instanceof GamificationError && reason.code === "UNAUTHORIZED";
  const clearForAuthorization = (reason: unknown, isSave = false) => {
    readVersion++;
    reading?.abort();
    saving?.abort();
    reading = null;
    saving = null;
    pending = null;
    publish({ ...empty(), error: gamificationErrorMessage(reason), saveError: isSave ? gamificationErrorMessage(reason) : null });
  };

  function load(offset: number): Promise<void> {
    if (!active || !userId || saving) return Promise.resolve();
    if (pending && requestedOffset === offset) return pending;
    reading?.abort();
    const request = new AbortController();
    reading = request;
    requestedOffset = offset;
    const scope = generation;
    const version = ++readVersion;
    const isCurrent = () => current(scope, request) && readVersion === version;
    pending = Promise.resolve().then(async () => {
      try {
        if (!isCurrent()) return;
        if (mode === "profile") {
          const profile = await service.getProfile(userId, request.signal);
          if (isCurrent()) publish({ profile, arena: null, loading: false, error: null });
        } else {
          const arena = await service.listArena(userId, offset, request.signal);
          if (isCurrent()) publish({ arena, profile: null, loading: false, error: null });
        }
      } catch (reason) {
        if (!isCurrent()) return;
        if (unauthorized(reason)) clearForAuthorization(reason);
        else publish({ ...empty(), error: gamificationErrorMessage(reason) });
      } finally {
        if (reading === request) { reading = null; pending = null; }
      }
    });
    // Reserve before subscribers can react to loading or fire focus refresh.
    publish({ ...empty(true) });
    return pending;
  }
  const reload = () => load(0);
  async function save(preferences: ProfilePreferences): Promise<boolean> {
    if (!active || !userId || mode !== "profile" || saving || !snapshot.profile) return false;
    reading?.abort();
    reading = null;
    pending = null;
    readVersion++;
    const request = new AbortController();
    saving = request;
    const scope = generation;
    publish({ saving: true, loading: false, error: null, saveError: null, arena: null });
    try {
      const profile = await service.saveProfile(userId, preferences, request.signal);
      if (!current(scope, request)) return false;
      publish({ profile, error: null, saveError: null });
      return true;
    } catch (reason) {
      if (!current(scope, request)) return false;
      if (unauthorized(reason)) clearForAuthorization(reason, true);
      else publish({ saveError: gamificationErrorMessage(reason) });
      return false;
    } finally {
      if (saving === request) saving = null;
      if (current(scope, request)) publish({ saving: false });
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() {
      if (active) return pending ?? Promise.resolve();
      active = true;
      generation++;
      return reload();
    },
    reload,
    loadPage: (offset: number) => mode === "arena" ? load(offset) : Promise.resolve(),
    save,
    dispose() {
      active = false;
      generation++;
      readVersion++;
      reading?.abort();
      saving?.abort();
      reading = null;
      saving = null;
      pending = null;
      snapshot = empty();
      notify();
    },
  };
}
