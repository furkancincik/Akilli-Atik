import { createConfiguredSupabaseClient, getSupabaseConfiguration } from "./supabase";
import {
  createStatisticsDataService,
  STATISTICS_COLUMNS,
  type StatisticsService,
} from "./statisticsData";

const PROJECT_URL = "https://nyoxbwandadakfagoner.supabase.co";

function configuredService(): StatisticsService {
  const configuration = getSupabaseConfiguration();
  const client = configuration?.url === PROJECT_URL ? createConfiguredSupabaseClient() : null;
  return createStatisticsDataService({
    configured: Boolean(client && configuration?.url === PROJECT_URL),
    auth: client?.auth ?? null,
    online: () => navigator.onLine !== false,
    async query(command, signal) {
      if (!client) throw new Error("Statistics client unavailable");
      let query = client.from("waste_analyses")
        .select(STATISTICS_COLUMNS.join(","), { count: "exact", head: command.kind === "count" })
        .eq("user_id", command.userId);
      if (command.kind === "count") {
        const { createdAt, id } = command.highWater;
        return await query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lte.${id})`)
          .abortSignal(signal);
      }
      query = query.order("created_at", { ascending: false }).order("id", { ascending: false })
        .limit(command.limit);
      if (command.cursor) {
        const { createdAt, id } = command.cursor;
        query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
      }
      return await query.abortSignal(signal);
    },
  });
}

/** SELECT/HEAD only; the existing shared SDK supplies the user's JWT. */
export const statisticsService: StatisticsService = {
  load: (userId, signal) => configuredService().load(userId, signal),
};
