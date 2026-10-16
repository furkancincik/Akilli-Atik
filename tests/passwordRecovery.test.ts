import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import {
  createPasswordRecoveryController,
  getRecoveryRedirect,
  parseRecoveryCallback,
  validateNewPassword,
  validateRecoveryEmail,
} from "../src/services/passwordRecovery.ts";
import type { RecoveryPort } from "../src/services/passwordRecovery.ts";

const NOW = 1_000;
function session(id = "user-a", expires = NOW + 3_600, token = "test-only-recovery-token"): Session {
  return { access_token: token, refresh_token: "test-only-refresh", token_type: "bearer", expires_in: expires - NOW,
    expires_at: expires, user: { id, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-10-16T00:00:00Z" } };
}
const result = (value: Session | null = null, error: unknown = null, redirectType: string | null = "recovery") => ({ data: { session: value, redirectType }, error });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((success) => { resolve = success; });
  return { promise, resolve };
}
class FakeRecovery implements RecoveryPort {
  current: Session | null = null;
  exchangeResponse = result(session());
  exchangeEvent: AuthChangeEvent | null = "PASSWORD_RECOVERY";
  eventSession: Session | undefined;
  serverError: unknown = null;
  serverUser: Session["user"] | undefined;
  sendError: unknown = null;
  updateError: unknown = null;
  logoutError: unknown = null;
  calls: string[] = [];
  sentEmail: string | null = null;
  updatedSession: Session | null = null;
  signedOutSession: Session | null = null;
  exchangeOptions: { flowId?: string } | undefined;
  subscriber: ((event: AuthChangeEvent, value: Session | null) => void) | null = null;
  resetPasswordForEmail = async (email: string, options: { redirectTo: string }) => {
    this.calls.push(`send:${options.redirectTo}`); this.sentEmail = email; return { error: this.sendError };
  };
  exchangeCodeForSession = async (_code: string, options?: { flowId?: string }) => {
    this.calls.push("exchange"); this.exchangeOptions = options;
    this.current = this.exchangeResponse.data.session;
    if (this.exchangeEvent) this.emit(this.exchangeEvent, this.eventSession ?? this.current);
    return this.exchangeResponse;
  };
  getSession = async () => { this.calls.push("getSession"); return result(this.current); };
  getUser = async () => { this.calls.push("getUser"); return { data: { user: this.serverUser ?? this.current?.user ?? null }, error: this.serverError }; };
  updateUser = async (_attributes: { password: string }, verifiedSession: Session) => {
    this.calls.push("update"); this.updatedSession = verifiedSession;
    return { data: { user: verifiedSession.user }, error: this.updateError };
  };
  signOut = async (options: { scope: "local" }, verifiedSession: Session) => {
    this.calls.push(`signOut:${options.scope}`);
    this.signedOutSession = verifiedSession;
    if (!this.logoutError) this.emit("SIGNED_OUT", null);
    return { error: this.logoutError };
  };
  onAuthStateChange = (listener: (event: AuthChangeEvent, value: Session | null) => void) => {
    this.calls.push("subscribe"); this.subscriber = listener;
    return { data: { subscription: { unsubscribe: () => { this.calls.push("unsubscribe"); this.subscriber = null; } } } };
  };
  emit(event: AuthChangeEvent, value: Session | null) { this.current = value; this.subscriber?.(event, value); }
}
const callback = { code: "test-only-pkce-code" };
function fixture(t: { after: (callback: () => void) => void }, auth: FakeRecovery | null = new FakeRecovery(), now = () => NOW) {
  let begins = 0;
  const controller = createPasswordRecoveryController(auth, () => { begins += 1; }, now);
  t.after(() => controller.dispose());
  return { controller, auth, begins: () => begins };
}

test("Recovery: geçerli e-posta temizlenir, geçersiz e-posta ağa gönderilmez", async (t) => {
  assert.equal(validateRecoveryEmail(" user@example.com "), "user@example.com");
  const f = fixture(t); const auth = f.auth!;
  for (const email of ["", "bad", "a@", "x y@example.com", `${"a".repeat(255)}@b.com`])
    await assert.rejects(f.controller.send(email, "http://localhost:5173/parola-yenile"), /e-posta/);
  assert.equal(auth.calls.filter((x) => x.startsWith("send")).length, 0);
  await f.controller.send(" user@example.com ", "http://localhost:5173/parola-yenile");
  assert.equal(auth.sentEmail, "user@example.com");
});

test("Recovery: kayıtlı olmayan adres aynı nötr başarı davranışını üretir", async (t) => {
  const f = fixture(t); const auth = f.auth!;
  assert.equal(await f.controller.send("registered@example.com", "http://localhost:5173/parola-yenile"), undefined);
  auth.sendError = { code: "user_not_found", message: "private-account-detail" };
  assert.equal(await f.controller.send("missing@example.com", "http://localhost:5173/parola-yenile"), undefined);
  assert.equal(f.controller.getSnapshot().error, null);
});

test("Recovery: hata mesajları sağlayıcı ayrıntısı ve hesap bilgisi sızdırmaz", async (t) => {
  const f = fixture(t); const auth = f.auth!;
  for (const error of [{ code: "over_email_send_rate_limit", message: "private-token" }, new TypeError("private-token"), { message: "private-token" }]) {
    auth.sendError = error;
    await assert.rejects(f.controller.send("user@example.com", "http://localhost:5173/parola-yenile"), (value: unknown) => {
      assert.ok(value instanceof Error);
      assert.ok(!value.message.includes("private-token"));
      assert.equal(value.cause, undefined);
      return true;
    });
  }
});

test("Recovery: e-posta kotası ve genel istek sınırı farklı güvenli mesajlar verir", async (t) => {
  const f = fixture(t); const auth = f.auth!;
  auth.sendError = { code: "over_email_send_rate_limit", status: 429, message: "private-provider-detail" };
  await assert.rejects(f.controller.send("user@example.com", "http://localhost:5173/parola-yenile"), /E-posta gönderim sınırına.*projenin e-posta kotası/);
  for (const error of [{ code: "over_request_rate_limit", status: 429 }, { status: 429 }]) {
    auth.sendError = error;
    await assert.rejects(f.controller.send("user@example.com", "http://localhost:5173/parola-yenile"), /Kısa sürede çok fazla istek/);
  }
});

test("Recovery: sunucu hatası bağlantı hatasıyla karıştırılmaz", async (t) => {
  const f = fixture(t); const auth = f.auth!;
  auth.sendError = { name: "AuthRetryableFetchError", status: 500, message: "private-provider-detail" };
  await assert.rejects(f.controller.send("user@example.com", "http://localhost:5173/parola-yenile"), /E-posta hizmeti şu anda kullanılamıyor/);
  auth.sendError = { name: "AuthRetryableFetchError", status: 0, message: "private-provider-detail" };
  await assert.rejects(f.controller.send("user@example.com", "http://localhost:5173/parola-yenile"), /İnternet bağlantınızı/);
});

test("Recovery: eşzamanlı servis çağrıları tek istek üretir, bitince kilit kalkar", async (t) => {
  const f = fixture(t); const auth = f.auth!;
  const pending = deferred<{ error: unknown }>();
  let count = 0;
  auth.resetPasswordForEmail = async () => { count += 1; return pending.promise; };
  const first = f.controller.send("user@example.com", "http://localhost:5173/parola-yenile");
  await assert.rejects(f.controller.send("other@example.com", "http://localhost:5173/parola-yenile"), /isteği sürüyor/);
  assert.equal(count, 1);
  pending.resolve({ error: null });
  await first;
  await f.controller.send("other@example.com", "http://localhost:5173/parola-yenile");
  assert.equal(count, 2);
});

test("Recovery: hata sonrası gönderim kilidi serbest bırakılır, otomatik tekrar yapılmaz", async (t) => {
  const f = fixture(t); const auth = f.auth!;
  auth.sendError = { code: "over_email_send_rate_limit", status: 429 };
  await assert.rejects(f.controller.send("user@example.com", "http://localhost:5173/parola-yenile"));
  assert.equal(auth.calls.filter((call) => call.startsWith("send:")).length, 1);
  auth.sendError = null;
  await f.controller.send("user@example.com", "http://localhost:5173/parola-yenile");
  assert.equal(auth.calls.filter((call) => call.startsWith("send:")).length, 2);
});

test("Recovery: yönlendirme yalnız güvenli web origin ve doğru rota kullanır", () => {
  assert.equal(getRecoveryRedirect("http://localhost:5173"), "http://localhost:5173/parola-yenile");
  assert.equal(getRecoveryRedirect("http://127.0.0.1:5176"), "http://127.0.0.1:5176/parola-yenile");
  assert.equal(getRecoveryRedirect("https://example.com"), "https://example.com/parola-yenile");
  for (const value of ["bad", "http://example.com", "https://localhost", "capacitor://localhost", "https://user@example.com", "https://example.com/path", "https://example.com?token=x"])
    assert.throws(() => getRecoveryRedirect(value));
});

test("Recovery: callback aynı origin ve rotada tek PKCE kodu ister, flow ID korunur", () => {
  const origin = "http://localhost:5173";
  assert.deepEqual(parseRecoveryCallback(`${origin}/parola-yenile?code=valid-code&sb_flow_id=flow-id&type=recovery`, origin), { code: "valid-code", flowId: "flow-id" });
  assert.equal(parseRecoveryCallback("https://evil.example/parola-yenile?code=valid-code", origin), null);
  assert.equal(parseRecoveryCallback(`${origin}/giris?code=valid-code`, origin), null);
  for (const suffix of ["", "?type=recovery", "?code=", "?code=a&code=b", "?code=has%20space", "?code=a%0Ab", "?code=%ZZ", "?code=x&sb_flow_id=a&sb_flow_id=b", "?code=a&error=expired", "?code=a&access_token=secret", "?code=a#access_token=secret", `?code=${"x".repeat(2049)}`])
    assert.throws(() => parseRecoveryCallback(`${origin}/parola-yenile${suffix}`, origin));
});

test("Recovery: eksik veya hatalı callback oturum değiştiremez", async (t) => {
  for (const data of [null, { code: "" }, { code: "a b" }]) {
    const f = fixture(t);
    await assert.rejects(f.controller.processCallback(data));
    assert.equal(f.controller.getSnapshot().phase, "error");
    assert.equal(f.auth!.calls.includes("exchange"), false);
  }
});

test("Recovery: normal oturum ve INITIAL_SESSION kurtarma yetkisi vermez", async (t) => {
  const f = fixture(t); const auth = f.auth!;
  auth.emit("INITIAL_SESSION", session());
  auth.emit("SIGNED_IN", session());
  await assert.rejects(f.controller.updatePassword("password1", "password1"));
  assert.equal(auth.calls.includes("update"), false);
  assert.notEqual(f.controller.getSnapshot().phase, "ready");
});

test("Recovery: PKCE normal giriş türü ve eksik recovery olayı reddedilir", async (t) => {
  for (const mode of ["normal", "missing-event", "wrong-event-user", "wrong-event-token"]) {
    const f = fixture(t); const auth = f.auth!;
    if (mode === "normal") { auth.exchangeResponse = result(session(), null, "signup"); auth.exchangeEvent = "SIGNED_IN"; }
    if (mode === "missing-event") auth.exchangeEvent = null;
    if (mode === "wrong-event-user") auth.eventSession = session("other-user");
    if (mode === "wrong-event-token") auth.eventSession = session("user-a", NOW + 3_600, "other-token");
    await assert.rejects(f.controller.processCallback(callback));
    assert.equal(f.controller.getSnapshot().phase, "error");
    assert.equal(auth.calls.includes("update"), false);
  }
});

test("Recovery: süresi dolmuş veya sunucuda doğrulanmayan oturum reddedilir", async (t) => {
  for (const mode of ["expired", "server-error", "other-user", "exchange-error"]) {
    const f = fixture(t); const auth = f.auth!;
    if (mode === "expired") auth.exchangeResponse = result(session("user-a", NOW));
    if (mode === "server-error") auth.serverError = { message: "secret-detail" };
    if (mode === "other-user") auth.serverUser = session("other-user").user;
    if (mode === "exchange-error") auth.exchangeResponse = result(null, { message: "secret-detail" });
    await assert.rejects(f.controller.processCallback(callback), (error: unknown) => error instanceof Error && !error.message.includes("secret-detail"));
    assert.equal(f.controller.getSnapshot().phase, "error");
  }
});

test("Recovery: doğrulanmış callback ready olur; StrictMode ve tekrar aynı exchange işlemini paylaşır", async (t) => {
  const f = fixture(t); const auth = f.auth!;
  const first = f.controller.processCallback({ ...callback, flowId: "flow-a" });
  const second = f.controller.processCallback({ ...callback, flowId: "flow-a" });
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(f.controller.getSnapshot().phase, "ready");
  assert.equal(auth.calls.filter((x) => x === "exchange").length, 1);
  assert.equal(f.begins(), 1);
  assert.deepEqual(auth.exchangeOptions, { flowId: "flow-a" });
  assert.equal("session" in f.controller.getSnapshot(), false);
});

test("Recovery: parola kuralları ve tekrar kontrolü updateUser çağrısından önce uygulanır", async (t) => {
  const f = fixture(t); const auth = f.auth!;
  await f.controller.processCallback(callback);
  for (const password of ["", "        ", "short", "x".repeat(129)]) {
    assert.throws(() => validateNewPassword(password, password));
    await assert.rejects(f.controller.updatePassword(password, password));
  }
  await assert.rejects(f.controller.updatePassword("password1", "different"), /eşleşmiyor/);
  assert.equal(auth.calls.includes("update"), false);
  assert.equal(f.controller.getSnapshot().phase, "ready");
});

test("Recovery: başarılı güncelleme doğrulanmış oturuma bağlıdır, çıkış yapar ve tekrar kullanılamaz", async (t) => {
  const f = fixture(t); const auth = f.auth!;
  await f.controller.processCallback(callback);
  const accepted = auth.current;
  await f.controller.updatePassword("new-password1", "new-password1");
  assert.equal(auth.updatedSession, accepted);
  assert.equal(auth.signedOutSession, accepted);
  assert.equal(f.controller.getSnapshot().phase, "complete");
  assert.equal(f.controller.getSnapshot().passwordChanged, true);
  assert.equal(auth.current, null);
  assert.ok(auth.calls.includes("signOut:local"));
  await assert.rejects(f.controller.updatePassword("new-password2", "new-password2"));
  assert.equal(auth.calls.filter((x) => x === "update").length, 1);
});

test("Recovery: on dakikayı veya oturum ömrünü aşan yetki kapalı kalır", async (t) => {
  let now = NOW;
  const f = fixture(t, new FakeRecovery(), () => now);
  await f.controller.processCallback(callback);
  now += 601;
  await assert.rejects(f.controller.updatePassword("password1", "password1"));
  assert.equal(f.auth!.calls.includes("update"), false);
});

test("Recovery: SIGNED_OUT, hesap değişimi ve token değişimi yetkiyi iptal eder", async (t) => {
  for (const [event, value] of [["SIGNED_OUT", null], ["SIGNED_IN", session("other-user")], ["TOKEN_REFRESHED", session("user-a", NOW + 3_600, "new-token")]] as const) {
    const f = fixture(t); const auth = f.auth!;
    await f.controller.processCallback(callback);
    auth.emit(event, value);
    await assert.rejects(f.controller.updatePassword("password1", "password1"));
    assert.equal(auth.calls.includes("update"), false);
  }
});

test("Recovery: server getUser beklerken değişen hesap ready olamaz", async (t) => {
  const f = fixture(t); const auth = f.auth!;
  const waiting = deferred<{ data: { user: Session["user"] }; error: null }>();
  auth.getUser = async () => waiting.promise;
  const operation = f.controller.processCallback(callback);
  await Promise.resolve();
  auth.emit("SIGNED_IN", session("other-user"));
  waiting.resolve({ data: { user: session().user }, error: null });
  await assert.rejects(operation);
  assert.equal(f.controller.getSnapshot().phase, "error");
});

test("Recovery: parola önkontrolü beklerken hesap değişirse updateUser çalışmaz", async (t) => {
  const f = fixture(t); const auth = f.auth!;
  await f.controller.processCallback(callback);
  const waiting = deferred<{ data: { user: Session["user"] }; error: null }>();
  auth.getUser = async () => waiting.promise;
  const operation = f.controller.updatePassword("password1", "password1");
  await Promise.resolve();
  auth.emit("SIGNED_IN", session("other-user"));
  waiting.resolve({ data: { user: session().user }, error: null });
  await assert.rejects(operation);
  assert.equal(auth.calls.includes("update"), false);
});

test("Recovery: güncelleme sırasında hesap değişirse başka hesaptan çıkış yapılmaz", async (t) => {
  const f = fixture(t); const auth = f.auth!;
  await f.controller.processCallback(callback);
  const waiting = deferred<{ data: { user: Session["user"] }; error: null }>();
  auth.updateUser = async (_attributes, verified) => { auth.updatedSession = verified; return waiting.promise; };
  const operation = f.controller.updatePassword("password1", "password1");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  auth.emit("SIGNED_IN", session("other-user"));
  waiting.resolve({ data: { user: session().user }, error: null });
  await assert.rejects(operation);
  assert.equal(auth.updatedSession?.user.id, "user-a");
  assert.equal(auth.calls.includes("signOut:local"), false);
  assert.equal(f.controller.getSnapshot().passwordChanged, true);
});

test("Recovery: güncelleme veya çıkış hatası sahte tamamlandı durumuna dönüşmez", async (t) => {
  for (const mode of ["update", "logout"]) {
    const f = fixture(t); const auth = f.auth!;
    await f.controller.processCallback(callback);
    if (mode === "update") auth.updateError = { message: "private-password-token" };
    else auth.logoutError = { message: "private-password-token" };
    await assert.rejects(f.controller.updatePassword("password1", "password1"), (error: unknown) => error instanceof Error && !error.message.includes("private-password-token"));
    assert.equal(f.controller.getSnapshot().phase, "error");
    assert.equal(f.controller.getSnapshot().passwordChanged, mode === "logout");
  }
});

test("Recovery: parola değiştiğinde başarısız kurtarma çıkışı aynı oturumla tekrar denenebilir", async (t) => {
  const f = fixture(t); const auth = f.auth!;
  await f.controller.processCallback(callback);
  const accepted = auth.current;
  auth.logoutError = { message: "synthetic-network-failure" };
  await assert.rejects(f.controller.updatePassword("password1", "password1"));
  assert.equal(f.controller.getSnapshot().passwordChanged, true);
  assert.equal(f.controller.getSnapshot().phase, "error");
  auth.logoutError = null;
  await f.controller.retryLogout();
  assert.equal(auth.signedOutSession, accepted);
  assert.equal(f.controller.getSnapshot().phase, "complete");
  assert.equal(auth.calls.filter((item) => item === "update").length, 1);
  await assert.rejects(f.controller.retryLogout());
});

test("Recovery: parola değişmeden veya yetki yokken çıkış tekrarı çalışamaz", async (t) => {
  const f = fixture(t); const auth = f.auth!;
  await assert.rejects(f.controller.retryLogout());
  await f.controller.processCallback(callback);
  auth.updateError = { message: "synthetic-update-failure" };
  await assert.rejects(f.controller.updatePassword("password1", "password1"));
  await assert.rejects(f.controller.retryLogout());
  assert.equal(auth.calls.some((item) => item.startsWith("signOut:")), false);
});

test("Recovery: eksik yapılandırma kapalı kalır ve abonelik dispose ile kaldırılır", async (t) => {
  const f = fixture(t, null);
  await assert.rejects(f.controller.processCallback(callback));
  await assert.rejects(f.controller.send("user@example.com", "http://localhost:5173/parola-yenile"));
  const auth = new FakeRecovery();
  const controller = createPasswordRecoveryController(auth);
  const snapshots: string[] = [];
  const unsubscribe = controller.subscribe((value) => snapshots.push(value.phase));
  assert.deepEqual(snapshots, ["idle"]);
  unsubscribe(); controller.dispose();
  assert.ok(auth.calls.includes("unsubscribe"));
});
