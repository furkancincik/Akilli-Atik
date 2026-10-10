// Minimal declarations for repository tsc checks. The deployed runtime is Supabase Deno.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};
