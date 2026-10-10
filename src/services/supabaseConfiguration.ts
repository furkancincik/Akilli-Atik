export function validateSupabaseConfiguration(
  urlValue?: string,
  keyValue?: string,
): { url: string; key: string } | null {
  const url = urlValue?.trim();
  const key = keyValue?.trim();
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" &&
      !(
        parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(parsed.hostname)
      )
    )
      return null;
    if (
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    )
      return null;
    if (key.startsWith("sb_secret_")) return null;
    if (key.startsWith("eyJ")) {
      const payload = JSON.parse(
        atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      ) as { role?: string };
      if (payload.role !== "anon") return null;
    } else if (!key.startsWith("sb_publishable_")) return null;
  } catch {
    return null;
  }
  return { url: url.replace(/\/$/, ""), key };
}
