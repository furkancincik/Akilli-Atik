import { createConfiguredSupabaseClient, getSupabaseConfiguration } from "./supabase";
import {
  createHistoryDataService,
  HISTORY_COLUMNS,
  type HistoryQuery,
  type HistoryService,
} from "./historyData";

const PROJECT_URL = "https://nyoxbwandadakfagoner.supabase.co";

/** Shared SDK client owns the access JWT; no privileged key or manual token storage. */
function configuredService(): HistoryService {
  const configuration = getSupabaseConfiguration();
  const client = configuration?.url === PROJECT_URL ? createConfiguredSupabaseClient() : null;
  return createHistoryDataService({
    configured: Boolean(client && configuration?.url === PROJECT_URL),
    auth: client?.auth ?? null,
    online: () => navigator.onLine !== false,
    async query(command: HistoryQuery, signal: AbortSignal) {
      if (!client) throw new Error("History client unavailable");
      if (command.kind === "remove") {
        return await client.from("waste_analyses").delete()
          .eq("id", command.id).eq("user_id", command.userId).select("id").abortSignal(signal);
      }
      let query = client.from("waste_analyses").select(HISTORY_COLUMNS.join(","))
        .eq("user_id", command.userId);
      if (command.kind === "get")
        return await query.eq("id", command.id).limit(1).abortSignal(signal);
      query = query.order("created_at", { ascending: false }).order("id", { ascending: false })
        .limit(command.limit);
      if (command.cursor) {
        const { createdAt, id } = command.cursor;
        // Both values were strictly validated by the pure service before this filter.
        query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
      }
      return await query.abortSignal(signal);
    },
  });
}

export const historyService: HistoryService = {
  list: (userId, cursor, signal) => configuredService().list(userId, cursor, signal),
  get: (userId, id, signal) => configuredService().get(userId, id, signal),
  remove: (userId, id, signal) => configuredService().remove(userId, id, signal),
};
