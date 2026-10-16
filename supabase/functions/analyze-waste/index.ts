import { createHandler } from "./handler.ts";

function publicKeys(): string[] {
  const keys = [
    Deno.env.get("SUPABASE_ANON_KEY"),
    Deno.env.get("ANALYSIS_PUBLIC_KEY"),
  ];
  try {
    const dictionary: unknown = JSON.parse(
      Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}",
    );
    if (
      dictionary &&
      typeof dictionary === "object" &&
      !Array.isArray(dictionary)
    )
      keys.push(
        ...Object.values(dictionary).filter(
          (key): key is string => typeof key === "string",
        ),
      );
  } catch {
    /* Invalid configuration remains inaccessible. */
  }
  return keys.filter((key): key is string => Boolean(key?.trim()));
}

Deno.serve(
  createHandler({
    enabled: Deno.env.get("ANALYSIS_ENABLED") === "true",
    testToken: Deno.env.get("ANALYSIS_TEST_TOKEN"),
    testExpiresAt: Deno.env.get("ANALYSIS_TEST_EXPIRES_AT"),
    apiKey: Deno.env.get("GEMINI_API_KEY") ?? "",
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    model: Deno.env.get("GEMINI_MODEL") || undefined,
    publicKeys: publicKeys(),
    allowedOrigins: (
      Deno.env.get("ALLOWED_ORIGINS") ??
      "https://localhost,http://localhost,capacitor://localhost"
    )
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  }),
);
