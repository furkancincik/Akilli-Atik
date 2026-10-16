import { AnalysisError } from "../_shared/analysis.ts";

export const MAX_ANALYSIS_WINDOW_MS = 10 * 60_000;

export interface AnalysisDeadline {
  readonly signal: AbortSignal;
  assertOpen(): void;
  dispose(): void;
}

/** Absolute server-side cutoff; it never changes the remote enable secret. */
export function createAnalysisDeadline(
  expiresAt: string | undefined,
  now: () => number = Date.now,
): AnalysisDeadline {
  const expiry = Date.parse(expiresAt ?? "");
  const assertWindow = () => {
    const remaining = expiry - now();
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > MAX_ANALYSIS_WINDOW_MS)
      throw new AnalysisError("SERVICE_DISABLED");
  };
  assertWindow();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), expiry - now());
  return {
    signal: controller.signal,
    assertOpen() {
      if (controller.signal.aborted) throw new AnalysisError("SERVICE_DISABLED");
      assertWindow();
    },
    dispose() { clearTimeout(timer); },
  };
}
