import {
  AnalysisError,
  applySafetyRules,
  edgeError,
  parseAnalysis,
  record,
} from "../../supabase/functions/_shared/analysis.ts";
import type { WasteAnalysis } from "../../supabase/functions/_shared/analysis.ts";
import {
  MAX_ANALYSIS_BYTES,
  readLimitedBody,
  validateAnalysisImage,
} from "../../supabase/functions/_shared/image.ts";
import { getSupabaseConfiguration } from "./supabase";

export async function requestAnalysis(
  photo: Blob,
  signal: AbortSignal,
  testToken: string,
): Promise<WasteAnalysis> {
  if (navigator.onLine === false) throw new AnalysisError("OFFLINE");
  const config = getSupabaseConfiguration();
  if (!config) throw new AnalysisError("NOT_CONFIGURED");
  if (!testToken.trim()) throw new AnalysisError("TEST_ACCESS_REQUIRED");
  if (
    photo.type !== "image/jpeg" ||
    !photo.size ||
    photo.size > MAX_ANALYSIS_BYTES
  )
    throw new AnalysisError("INVALID_PHOTO");
  validateAnalysisImage(new Uint8Array(await photo.arrayBuffer()));
  const response = await fetch(`${config.url}/functions/v1/analyze-waste`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "image/jpeg",
      apikey: config.key,
      "x-analysis-test-token": testToken.trim(),
    },
    body: photo,
  });
  if (!response.ok) {
    let failure: unknown = null;
    try {
      const raw = await readLimitedBody(
        response.body,
        64000,
        "INVALID_RESPONSE",
        signal,
      );
      failure = JSON.parse(new TextDecoder().decode(raw));
    } catch (reason) {
      if (reason instanceof AnalysisError && reason.code === "TIMEOUT")
        throw reason;
    }
    throw edgeError(failure, response.status);
  }
  const raw = await readLimitedBody(
    response.body,
    64000,
    "INVALID_RESPONSE",
    signal,
  );
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new AnalysisError("INVALID_RESPONSE");
  }
  return applySafetyRules(parseAnalysis(record(payload).result));
}
