import { AnalysisError, UUID_PATTERN } from "../_shared/analysis.ts";
import { readLimitedBody } from "../_shared/image.ts";

export type Admission = { status: "admitted"; leaseId: string } |
  { status: "duplicate" } | { status: "limited" } | { status: "conflict" };
export interface AnalysisQuota {
  reserve(userId: string, requestId: string, digest: string): Promise<Admission>;
  finish(userId: string, requestId: string, leaseId: string): Promise<void>;
}

/** Only the verified JWT user is passed here. RPCs are service-role only. */
export function createAnalysisQuota(
  config: { supabaseUrl: string; serviceRoleKey: string },
  transport: typeof fetch = fetch,
): AnalysisQuota {
  let origin: string;
  try {
    const url = new URL(config.supabaseUrl);
    if (url.origin !== "https://nyoxbwandadakfagoner.supabase.co" ||
      url.pathname !== "/" || url.search || url.hash || url.username || url.password ||
      !config.serviceRoleKey.trim() || /[\r\n]/.test(config.serviceRoleKey)) throw Error();
    origin = url.origin;
  } catch { throw new AnalysisError("QUOTA_UNAVAILABLE"); }
  async function rpc(name: string, body: object): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await transport(`${origin}/rest/v1/rpc/${name}`, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`,
          "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok) throw Error();
      return JSON.parse(new TextDecoder().decode(await readLimitedBody(response.body, 2048, "INVALID_RESPONSE", controller.signal)));
    } catch { throw new AnalysisError("QUOTA_UNAVAILABLE"); }
    finally { clearTimeout(timer); }
  }
  return {
    async reserve(userId, requestId, digest) {
      if (!UUID_PATTERN.test(userId) || !UUID_PATTERN.test(requestId) || !/^[a-f0-9]{64}$/.test(digest))
        throw new AnalysisError("INVALID_REQUEST_ID");
      const value = await rpc("reserve_analysis_request", { p_user_id: userId, p_request_id: requestId, p_digest: digest });
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new AnalysisError("QUOTA_UNAVAILABLE");
      const data = value as Record<string, unknown>;
      if (data.status === "admitted" && Object.keys(data).length === 2 &&
        typeof data.leaseId === "string" && UUID_PATTERN.test(data.leaseId))
        return { status: "admitted", leaseId: data.leaseId };
      if (Object.keys(data).length === 1 &&
        (data.status === "duplicate" || data.status === "limited" || data.status === "conflict"))
        return { status: data.status };
      throw new AnalysisError("QUOTA_UNAVAILABLE");
    },
    async finish(userId, requestId, leaseId) {
      if (![userId, requestId, leaseId].every((value) => UUID_PATTERN.test(value)))
        throw new AnalysisError("INVALID_REQUEST_ID");
      const value = await rpc("finish_analysis_request", { p_user_id: userId, p_request_id: requestId, p_lease_id: leaseId });
      if (typeof value !== "boolean") throw new AnalysisError("QUOTA_UNAVAILABLE");
    },
  };
}
