import { test } from "node:test";
import assert from "node:assert/strict";
import { createRecoveryStorage } from "../src/services/recoveryStorage.ts";

function persistent() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  };
}

test("Recovery storage: session ve kullanıcı yalnız bellekte tutulur", () => {
  const storage = persistent();
  const key = "akilli-atik-recovery-instance-a";
  const first = createRecoveryStorage(key, storage);
  first.setItem(key, "synthetic-session");
  first.setItem(`${key}-user`, "synthetic-user");
  assert.equal(first.getItem(key), "synthetic-session");
  assert.equal(first.getItem(`${key}-user`), "synthetic-user");
  assert.equal(storage.entries.size, 0);
  const recreated = createRecoveryStorage(key, storage);
  assert.equal(recreated.getItem(key), null);
  assert.equal(recreated.getItem(`${key}-user`), null);
});

test("Recovery storage: PKCE legacy, flow ve index farklı instance kimlikleri arasında kalır", () => {
  const storage = persistent();
  const firstKey = "akilli-atik-recovery-instance-a";
  const secondKey = "akilli-atik-recovery-instance-b";
  const first = createRecoveryStorage(firstKey, storage);
  const second = createRecoveryStorage(secondKey, storage);
  for (const suffix of ["-code-verifier", "-flows-code-verifier", "-flow-01234567-abcd-4567-8901-0123456789ab-code-verifier"]) {
    first.setItem(`${firstKey}${suffix}`, `synthetic${suffix}`);
    assert.equal(storage.getItem(`akilli-atik-recovery-pkce${suffix}`), `synthetic${suffix}`);
    assert.equal(second.getItem(`${secondKey}${suffix}`), `synthetic${suffix}`);
  }
  assert.equal([...storage.entries.keys()].some((key) => key.includes("instance-")), false);
});

test("Recovery storage: normal Auth depolaması ve farklı instance oturumları izole kalır", () => {
  const storage = persistent();
  const normal = "sb-testproject-auth-token";
  storage.setItem(normal, "normal-auth-session");
  const key = "akilli-atik-recovery-instance-a";
  const first = createRecoveryStorage(key, storage);
  const otherKey = "akilli-atik-recovery-instance-b";
  const second = createRecoveryStorage(otherKey, storage);
  first.setItem(key, "recovery-session");
  assert.equal(second.getItem(otherKey), null);
  assert.throws(() => first.getItem(normal));
  assert.throws(() => first.setItem(normal, "overwrite"));
  assert.throws(() => first.removeItem(normal));
  assert.throws(() => first.getItem(otherKey));
  assert.equal(storage.getItem(normal), "normal-auth-session");
});

test("Recovery storage: yalnız izinli verifier anahtarları kalıcıdır", () => {
  const storage = persistent();
  const key = "akilli-atik-recovery-instance-a";
  const recovery = createRecoveryStorage(key, storage);
  for (const suffix of ["-session-code-verifier", "-access_token", "-refresh_token", "-flow-../secret-code-verifier", "-flow--code-verifier", "-code-verifier-extra"]) {
    recovery.setItem(`${key}${suffix}`, "memory-only");
    assert.equal(recovery.getItem(`${key}${suffix}`), "memory-only");
  }
  assert.equal(storage.entries.size, 0);
});

test("Recovery storage: silme belleği ve ilgili PKCE slotunu temizler", () => {
  const storage = persistent();
  const key = "akilli-atik-recovery-instance-a";
  const recovery = createRecoveryStorage(key, storage);
  recovery.setItem(key, "memory-session");
  recovery.setItem(`${key}-code-verifier`, "synthetic-verifier");
  recovery.setItem(`${key}-flow-safe-flow-code-verifier`, "synthetic-flow-verifier");
  recovery.removeItem(key);
  recovery.removeItem(`${key}-code-verifier`);
  assert.equal(recovery.getItem(key), null);
  assert.equal(recovery.getItem(`${key}-code-verifier`), null);
  assert.equal(storage.getItem("akilli-atik-recovery-pkce-flow-safe-flow-code-verifier"), "synthetic-flow-verifier");
  recovery.removeItem(`${key}-flow-safe-flow-code-verifier`);
  assert.equal(storage.entries.size, 0);
});

test("Recovery storage: bozuk alan adı ve komşu prefix anahtarları reddedilir", () => {
  const storage = persistent();
  for (const key of ["", "sb-normal-auth-token", "akilli-atik-recovery-", "akilli-atik-recovery-instance/secret", `akilli-atik-recovery-${"x".repeat(139)}`])
    assert.throws(() => createRecoveryStorage(key, storage));
  const key = "akilli-atik-recovery-safe";
  const recovery = createRecoveryStorage(key, storage);
  assert.throws(() => recovery.getItem(`${key}evil-code-verifier`));
  assert.equal(storage.entries.size, 0);
});
