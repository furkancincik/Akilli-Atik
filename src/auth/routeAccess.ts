export const DASHBOARD_PATH = "/panel";

export function routeAccess(status: "loading" | "authenticated" | "anonymous" | "unavailable") {
  if (status === "loading") return "loading";
  return status === "authenticated" ? "allow" : "login";
}
