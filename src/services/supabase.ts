import { createClient } from "@supabase/supabase-js";
import { validateSupabaseConfiguration } from "./supabaseConfiguration";

// Only public configuration; no authentication/session lookup or network request.
export function getSupabaseConfiguration() {
  return validateSupabaseConfiguration(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  );
}
export function createConfiguredSupabaseClient() {
  const config = getSupabaseConfiguration();
  if (!config) return null;
  return createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
