import { createConfiguredSupabaseClient, getSupabaseConfiguration } from "./supabase";
import { requestAuthenticatedAnalysis } from "./analysisRequest";

export function requestAnalysis(
  photo: Blob,
  signal: AbortSignal,
  testToken: string,
  clientRequestId: string,
  expectedUserId: string,
) {
  return requestAuthenticatedAnalysis(
    {
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
