import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateSupabaseConfiguration } from "./supabaseConfiguration";

// Analysis uses only public configuration; its HTTP contract remains unchanged.
export function getSupabaseConfiguration() {
  return validateSupabaseConfiguration(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  );
}
let sharedClient: SupabaseClient | null | undefined;

// A single SDK client owns session persistence. Never copy tokens to other stores.
export function createConfiguredSupabaseClient(): SupabaseClient | null {
  if (sharedClient !== undefined) return sharedClient;
  const config = getSupabaseConfiguration();
  if (!config) return (sharedClient = null);
  sharedClient = createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      // Email confirmation opens in the browser; password login follows manually.
      // Never turn arbitrary URL fragments into a WebView session.
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
  return sharedClient;
}
