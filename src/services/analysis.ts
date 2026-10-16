import { createConfiguredSupabaseClient, getSupabaseConfiguration } from "./supabase";
import { requestAuthenticatedAnalysis } from "./analysisRequest";
import { normalAnalysisAccess } from "./analysisAccess";

export function requestAnalysis(
  photo: Blob,
  signal: AbortSignal,
  testToken: string,
  clientRequestId: string,
  expectedUserId: string,
) {
  return requestAuthenticatedAnalysis(
    {
      accessMode: normalAnalysisAccess ? "authenticated" : "test",
      auth: createConfiguredSupabaseClient()?.auth ?? null,
      configuration: getSupabaseConfiguration(),
      online: navigator.onLine !== false,
    },
    photo,
    signal,
    testToken,
    clientRequestId,
    expectedUserId,
  );
}
