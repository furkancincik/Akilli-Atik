import { useEffect, useRef, useState } from "react";
import { AnalysisError } from "../../supabase/functions/_shared/analysis.ts";
import type { WasteAnalysis } from "../../supabase/functions/_shared/analysis.ts";
import { requestAnalysis } from "../services/analysis";

export function useWasteAnalysis(photo: Blob | undefined) {
  const [state, setState] = useState<{
    photo: Blob;
    result: WasteAnalysis | null;
    error: string | null;
    busy: boolean;
  } | null>(null);
  const active = useRef<AbortController | null>(null);
  const version = useRef(0);
  useEffect(
    () => () => {
      version.current++;
      active.current?.abort();
      active.current = null;
    },
    [photo],
  );
  async function analyze(testToken: string) {
    if (!photo || active.current) return;
    const id = ++version.current;
    const controller = new AbortController();
    active.current = controller;
    setState({ photo, result: null, error: null, busy: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 50000);
    try {
      const result = await requestAnalysis(photo, controller.signal, testToken);
      if (id === version.current)
        setState({ photo, result, error: null, busy: false });
    } catch (reason) {
      const error = timedOut
        ? new AnalysisError("TIMEOUT")
        : reason instanceof AnalysisError
          ? reason
          : new AnalysisError(
              navigator.onLine === false ? "OFFLINE" : "NETWORK_ERROR",
            );
      if (id === version.current)
        setState({ photo, result: null, error: error.message, busy: false });
    } finally {
      clearTimeout(timer);
      if (active.current === controller) active.current = null;
    }
  }
  const current = state?.photo === photo ? state : null;
  return {
    result: current?.result ?? null,
    error: current?.error ?? null,
    busy: current?.busy ?? false,
    attempted: Boolean(current),
    analyze,
  };
}
