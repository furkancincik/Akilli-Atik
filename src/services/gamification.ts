import { createConfiguredSupabaseClient, getSupabaseConfiguration } from "./supabase";
import { createGamificationDataService, type GamificationService } from "./gamificationData";

const PROJECT_URL = "https://nyoxbwandadakfagoner.supabase.co";
let configured: GamificationService | undefined;
function service(): GamificationService {
  if (configured) return configured;
  const configuration = getSupabaseConfiguration();
  const client = configuration?.url === PROJECT_URL ? createConfiguredSupabaseClient() : null;
  return configured = createGamificationDataService({
    configured: Boolean(client), auth: client?.auth ?? null,
    online: () => navigator.onLine !== false,
    async rpc(command, signal) {
      if (!client) throw new Error("Gamification client unavailable");
      if (command.kind === "profile") return await client.rpc("get_my_profile").abortSignal(signal);
      if (command.kind === "save") return await client.rpc("save_my_profile", {
        p_nickname: command.preferences.nickname, p_arena_opt_in: command.preferences.arenaOptIn,
      }).abortSignal(signal);
      return await client.rpc("get_eco_arena", { p_offset: command.offset }).abortSignal(signal);
    },
  });
}
export const gamificationService: GamificationService = {
  getProfile: (userId, signal) => service().getProfile(userId, signal),
  saveProfile: (userId, preferences, signal) => service().saveProfile(userId, preferences, signal),
  listArena: (userId, offset, signal) => service().listArena(userId, offset, signal),
};
