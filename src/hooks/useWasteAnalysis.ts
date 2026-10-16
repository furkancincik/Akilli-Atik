import { useEffect, useRef, useState } from "react";
import { AnalysisError } from "../../supabase/functions/_shared/analysis.ts";
import type { AnalysisOutcome } from "../../supabase/functions/_shared/analysis.ts";
import { requestAnalysis } from "../services/analysis";
import { useAuth } from "../auth/useAuth";

export function useWasteAnalysis(photo: Blob | undefined) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [state, setState] = useState<{
    photo: Blob;
    userId: string;
    outcome: AnalysisOutcome | null;
    error: string | null;
    busy: boolean;
  } | null>(null);
  const active = useRef<AbortController | null>(null);
  const version = useRef(0);
  // Retry the same photo with the same idempotency key. A new photo gets a new
  // intent; UUIDs contain no user ID, image data, token or personal information.
  const intent = useRef<{ photo: Blob; userId: string; id: string } | null>(null);
  useEffect(
    () => () => {
      version.current++;
      active.current?.abort();
      active.current = null;
    },
    [photo, userId],
  );
  async function analyze(testToken: string) {
    if (!photo || !userId || active.current) return;
    if (intent.current?.photo !== photo || intent.current.userId !== userId)
      intent.current = { photo, userId, id: crypto.randomUUID() };
    const clientRequestId = intent.current.id;
    const id = ++version.current;
    const controller = new AbortController();
    active.current = controller;
    setState({ photo, userId, outcome: null, error: null, busy: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    // Auth (8s), body read (10s), lookup (5s), Gemini (35s), insert/conflict
    // lookup (10s) each have their own server deadline. Allow their full budget.
    }, 75000);
    try {
      const outcome = await requestAnalysis(photo, controller.signal, testToken, clientRequestId, userId);
      if (id === version.current)
        setState({ photo, userId, outcome, error: null, busy: false });
    } catch (reason) {
      const error = timedOut
        ? new AnalysisError("TIMEOUT")
        : reason instanceof AnalysisError
          ? reason
          : new AnalysisError(
              navigator.onLine === false ? "OFFLINE" : "NETWORK_ERROR",
            );
      if (id === version.current)
        setState({ photo, userId, outcome: null, error: error.message, busy: false });
    } finally {
      clearTimeout(timer);
      if (active.current === controller) active.current = null;
    }
  }
  const current = state?.photo === photo && state?.userId === userId ? state : null;
  return {
    result: current?.outcome?.result ?? null,
    persistence: current?.outcome?.persistence ?? null,
    error: current?.error ?? null,
    busy: current?.busy ?? false,
    attempted: Boolean(current),
    analyze,
  };
}
