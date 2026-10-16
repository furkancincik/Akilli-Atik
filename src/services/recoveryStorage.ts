type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const PERSISTENT_PREFIX = "akilli-atik-recovery-pkce";

/**
 * Recovery sessions stay in this instance's memory. Only SDK-generated PKCE
 * verifier slots survive navigation, in a namespace isolated from normal Auth.
 * The SDK may use both legacy and flow-specific verifier/index keys.
 */
export function createRecoveryStorage(uniqueKey: string, persistent: StoragePort): StoragePort {
  if (!/^akilli-atik-recovery-[A-Za-z0-9_-]{1,138}$/.test(uniqueKey))
    throw new Error("Kurtarma depolama alanı geçersiz.");
  const memory = new Map<string, string>();
  const persistentKey = (key: string): string | null => {
    if (key !== uniqueKey && !key.startsWith(`${uniqueKey}-`))
      throw new Error("Kurtarma depolama alanı dışındaki anahtara erişilemez.");
    const suffix = key.slice(uniqueKey.length);
    // Explicit allowlist: arbitrary keys that happen to end in this suffix do
    // not gain persistence. Session and user keys always remain in memory.
    if (suffix === "-code-verifier" || suffix === "-flows-code-verifier" ||
      /^-flow-[A-Za-z0-9_-]{1,128}-code-verifier$/.test(suffix))
      return `${PERSISTENT_PREFIX}${suffix}`;
    return null;
  };
  return {
    getItem: (key) => {
      const slot = persistentKey(key);
      return slot ? persistent.getItem(slot) : memory.get(key) ?? null;
    },
    setItem: (key, value) => {
      const slot = persistentKey(key);
      if (slot) persistent.setItem(slot, value);
      else memory.set(key, value);
    },
    removeItem: (key) => {
      const slot = persistentKey(key);
      if (slot) persistent.removeItem(slot);
      else memory.delete(key);
    },
  };
}
