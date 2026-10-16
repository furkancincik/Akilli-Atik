import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import {
  authErrorMessage,
  createAuthController,
  validateAuthForm,
} from "../src/services/auth.ts";
import type { AuthPort, AuthSnapshot } from "../src/services/auth.ts";
import { routeAccess } from "../src/auth/routeAccess.ts";

const BASE_TIME = 1_000;
function session(id = "user-a", expiresAt = BASE_TIME + 3_600): Session {
  return {
    access_token: "test-only-access-token",
    refresh_token: "test-only-refresh-token",
    token_type: "bearer",
    expires_in: expiresAt - BASE_TIME,
    expires_at: expiresAt,
    user: { id, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-10-15T00:00:00Z" },
  };
}
const response = (value: Session | null = null, error: unknown = null) => ({ data: { session: value }, error });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
class FakeAuth implements AuthPort {
  current: Session | null = null;
  loginResponse = response(session());
  registrationResponse = response();
  logoutError: unknown = null;
  subscriber: ((event: AuthChangeEvent, value: Session | null) => void) | null = null;
  calls: string[] = [];
  getSession = async () => { this.calls.push("getSession"); return response(this.current); };
  onAuthStateChange = (callback: (event: AuthChangeEvent, value: Session | null) => void) => {
    this.calls.push("subscribe");
    this.subscriber = callback;
    return { data: { subscription: { unsubscribe: () => { this.calls.push("unsubscribe"); this.subscriber = null; } } } };
  };
  signInWithPassword = async (credentials: { email: string; password: string }) => {
    this.calls.push(`login:${credentials.email}`);
    return this.loginResponse;
  };
  signUp = async (credentials: { email: string; password: string }) => {
    this.calls.push(`register:${credentials.email}`);
    return this.registrationResponse;
  };
  signOut = async (options: { scope: "local" }) => {
    this.calls.push(`logout:${options.scope}`);
    return { error: this.logoutError };
  };
  startAutoRefresh = () => { this.calls.push("startRefresh"); };
  stopAutoRefresh = () => { this.calls.push("stopRefresh"); };
  emit(event: AuthChangeEvent, value: Session | null) {
    this.current = value;
    this.subscriber?.(event, value);
  }
}
function fixture(auth: AuthPort | null = new FakeAuth(), now = () => BASE_TIME) {
  const changes: AuthSnapshot[] = [];
  const controller = createAuthController(auth, (snapshot) => changes.push(snapshot), now);
  const latest = () => changes.at(-1)!;
  return { controller, changes, latest };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("Auth: kurtarma sayfası eski normal oturumu ve geç SDK olaylarını arayüze taşımaz", async (t) => {
  const auth = new FakeAuth();
  auth.current = session();
  const { controller, latest } = fixture(auth);
  t.after(() => controller.dispose());
  controller.blockForRecovery();
  await controller.start();
  assert.equal(latest().status, "anonymous");
  assert.equal(auth.calls.includes("getSession"), false);
  auth.emit("SIGNED_IN", session("other-user"));
  controller.setActive(false);
  controller.setActive(true);
  await flush();
  assert.equal(latest().session, null);
  assert.equal(auth.calls.includes("startRefresh"), false);
  await controller.login("user@example.com", "password1");
  assert.equal(latest().session?.user.id, "user-a");
});

test("Auth: PASSWORD_RECOVERY olayı normal korumalı erişim sağlamaz", async (t) => {
  const auth = new FakeAuth();
  const { controller, latest } = fixture(auth);
  t.after(() => controller.dispose());
  await controller.start();
  auth.emit("PASSWORD_RECOVERY", session());
  assert.equal(latest().status, "anonymous");
  auth.emit("TOKEN_REFRESHED", session());
  assert.equal(latest().session, null);
  auth.emit("SIGNED_OUT", null);
  auth.emit("SIGNED_IN", session());
  assert.equal(latest().status, "authenticated");
});

test("Auth: geçerli kayıt e-postayı temizler, parolayı değiştirmez", () => {
  assert.deepEqual(validateAuthForm("register", " user@example.com ", " password1 ", " password1 "), {
    email: "user@example.com", password: " password1 ",
  });
});

test("Auth: geçersiz veya boş e-posta reddedilir", () => {
  for (const email of ["", "bad", "x@", "@example.com", "x y@example.com", "x@example", `${"a".repeat(250)}@b.com`])
    assert.throws(() => validateAuthForm("register", email, "password1", "password1"));
});

test("Auth: kayıt parolası boş, kısa veya çok uzun olamaz", () => {
  for (const password of ["", "        ", "1234567", "a".repeat(129)])
    assert.throws(() => validateAuthForm("register", "user@example.com", password, password));
});

test("Auth: parola tekrarı zorunludur ve eşleşmelidir", () => {
  assert.throws(() => validateAuthForm("register", "user@example.com", "password1"), /tekrar/);
  assert.throws(() => validateAuthForm("register", "user@example.com", "password1", "password2"), /eşleşmiyor/);
  assert.equal(validateAuthForm("login", "user@example.com", "old").password, "old");
});

test("Auth: servis hataları Türkçedir; ham mesaj ve hassas içerik gösterilmez", () => {
  const codes = ["invalid_credentials", "email_not_confirmed", "user_already_exists", "weak_password", "over_email_send_rate_limit", "signup_disabled"];
  for (const code of codes) {
    const message = authErrorMessage({ code, message: "secret-provider-payload" });
    assert.ok(message.length > 20);
    assert.ok(!message.includes("secret-provider-payload"));
  }
  assert.match(authErrorMessage(new TypeError("secret-provider-payload")), /İnternet/);
  assert.ok(!authErrorMessage("secret-provider-payload").includes("secret-provider"));
});

test("Auth: başarılı giriş kullanıcıyı oturum durumuna geçirir", async (t) => {
  const auth = new FakeAuth();
  const { controller, latest } = fixture(auth);
  t.after(controller.dispose);
  await controller.start();
  await controller.login(" user@example.com ", "password1");
  assert.equal(latest().status, "authenticated");
  assert.equal(latest().session?.user.id, "user-a");
  assert.ok(auth.calls.includes("login:user@example.com"));
});

test("Auth: hatalı giriş bilgileri güvenli hata verir ve oturum açmaz", async (t) => {
  const auth = new FakeAuth();
  auth.loginResponse = response(null, { code: "invalid_credentials", message: "private" });
  const { controller, latest } = fixture(auth);
  t.after(controller.dispose);
  await controller.start();
  await assert.rejects(controller.login("user@example.com", "wrong"), /E-posta veya parola hatalı/);
  assert.equal(latest().status, "anonymous");
  assert.equal(latest().session, null);
});

test("Auth: doğrulama bekleyen kayıt başarılı giriş gibi gösterilmez", async (t) => {
  const { controller, latest } = fixture();
  t.after(controller.dispose);
  await controller.start();
  assert.deepEqual(await controller.register("user@example.com", "password1", "password1"), { confirmationRequired: true });
  assert.equal(latest().status, "anonymous");
});

test("Auth: doğrulanmış kayıt servis oturumu döndürürse giriş yapılır", async (t) => {
  const auth = new FakeAuth();
  auth.registrationResponse = response(session());
  const { controller, latest } = fixture(auth);
  t.after(controller.dispose);
  await controller.start();
  assert.deepEqual(await controller.register("user@example.com", "password1", "password1"), { confirmationRequired: false });
  assert.equal(latest().status, "authenticated");
});

test("Auth: SDK oturumu geri yüklenir ve dinleyici önce kurulur", async (t) => {
  const auth = new FakeAuth();
  auth.current = session();
  const { controller, changes, latest } = fixture(auth);
  t.after(controller.dispose);
  await controller.start();
  assert.equal(changes[0].status, "loading");
  assert.deepEqual(auth.calls.slice(0, 2), ["subscribe", "getSession"]);
  assert.equal(latest().session?.user.id, "user-a");
});

test("Auth: eski başlangıç yanıtı yeni giriş veya çıkış olayını geri alamaz", async (t) => {
  const auth = new FakeAuth();
  const pending = deferred<ReturnType<typeof response>>();
  auth.getSession = () => pending.promise;
  const { controller, latest } = fixture(auth);
  t.after(controller.dispose);
  const start = controller.start();
  auth.emit("SIGNED_IN", session("user-b"));
  auth.emit("SIGNED_OUT", null);
  pending.resolve(response(session("user-a")));
  await start;
  assert.equal(latest().status, "anonymous");
  assert.equal(latest().session, null);
});

test("Auth: süresi dolmuş kayıt geri yüklenmez", async (t) => {
  const auth = new FakeAuth();
  auth.current = session("user-a", BASE_TIME);
  const { controller, latest } = fixture(auth);
  t.after(controller.dispose);
  await controller.start();
  assert.equal(latest().status, "anonymous");
  assert.match(latest().error!, /süresi doldu/);
});

test("Auth: yenileme olayı gelmese de zaman aşımı kullanıcı erişimini kaldırır", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let time = BASE_TIME;
  const auth = new FakeAuth();
  auth.current = session("user-a", BASE_TIME + 10);
  const { controller, latest } = fixture(auth, () => time);
  t.after(controller.dispose);
  await controller.start();
  const identity = latest().identityVersion;
  time += 10;
  t.mock.timers.tick(10_000);
  assert.equal(latest().status, "anonymous");
  assert.equal(latest().session, null);
  assert.ok(latest().identityVersion > identity);
});

test("Auth: TOKEN_REFRESHED aynı kullanıcıda veriyi temizlemeden süreyi yeniler", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let time = BASE_TIME;
  const auth = new FakeAuth();
  auth.current = session("user-a", BASE_TIME + 10);
  const { controller, latest } = fixture(auth, () => time);
  t.after(controller.dispose);
  await controller.start();
  const identity = latest().identityVersion;
  auth.emit("TOKEN_REFRESHED", session("user-a", BASE_TIME + 20));
  assert.equal(latest().identityVersion, identity);
  time += 10;
  t.mock.timers.tick(10_000);
  assert.equal(latest().status, "authenticated");
  time += 10;
  t.mock.timers.tick(10_000);
  assert.equal(latest().status, "anonymous");
});

test("Auth: çıkış sunucu yanıtını beklemeden kullanıcı state temizliğini tetikler", async (t) => {
  const auth = new FakeAuth();
  auth.current = session();
  const pending = deferred<{ error: unknown }>();
  auth.signOut = (options) => { auth.calls.push(`logout:${options.scope}`); return pending.promise; };
  const { controller, latest } = fixture(auth);
  t.after(controller.dispose);
  await controller.start();
  const identity = latest().identityVersion;
  const logout = controller.logout();
  assert.equal(latest().status, "anonymous");
  assert.ok(latest().identityVersion > identity);
  auth.emit("TOKEN_REFRESHED", session());
  assert.equal(latest().status, "anonymous");
  pending.resolve({ error: null });
  await logout;
  assert.ok(auth.calls.includes("logout:local"));
});

test("Auth: çıkış hatasında depolama temizlendi denmez ve eski oturum geri alınmaz", async (t) => {
  const auth = new FakeAuth();
  auth.current = session();
  auth.logoutError = new TypeError("private");
  const { controller, latest } = fixture(auth);
  t.after(controller.dispose);
  await controller.start();
  await assert.rejects(controller.logout(), /temizlenemedi/);
  auth.emit("SIGNED_IN", session());
  controller.setActive(false);
  controller.setActive(true);
  await flush();
  assert.equal(latest().status, "anonymous");
  assert.match(latest().error!, /temizlenemedi/);
});

test("Auth: gecikmeli çıkış bitmeden yeni giriş ve kayıt SDK'ya gönderilmez", async (t) => {
  const auth = new FakeAuth();
  auth.current = session();
  const pending = deferred<{ error: unknown }>();
  auth.signOut = () => pending.promise;
  const { controller, latest } = fixture(auth);
  t.after(controller.dispose);
  await controller.start();
  const leaving = controller.logout();
  await assert.rejects(controller.login("user@example.com", "password1"), /Çıkış işlemi sürüyor/);
  await assert.rejects(controller.register("user@example.com", "password1", "password1"), /Çıkış işlemi sürüyor/);
  assert.equal(auth.calls.some((call) => call.startsWith("login:") || call.startsWith("register:")), false);
  assert.equal(latest().session, null);
  pending.resolve({ error: null });
  await leaving;
  await controller.login("user@example.com", "password1");
  assert.equal(auth.calls.filter((call) => call.startsWith("login:")).length, 1);
  assert.equal(latest().status, "authenticated");
});

test("Auth: hesap değişiminde kimlik sürümü değişir ve eski kullanıcı state'i ayrılır", async (t) => {
  const auth = new FakeAuth();
  auth.current = session();
  const { controller, latest } = fixture(auth);
  t.after(controller.dispose);
  await controller.start();
  const oldIdentity = latest().identityVersion;
  auth.emit("SIGNED_IN", session("user-b"));
  assert.equal(latest().session?.user.id, "user-b");
  assert.ok(latest().identityVersion > oldIdentity);
});

test("Auth: uygulama durdurulunca yenileme durur; dönüşte oturum uzlaştırılır", async (t) => {
  const auth = new FakeAuth();
  const { controller, latest } = fixture(auth);
  t.after(controller.dispose);
  await controller.start();
  controller.setActive(false);
  assert.equal(auth.calls.at(-1), "stopRefresh");
  auth.current = session("user-b");
  controller.setActive(true);
  await flush();
  assert.ok(auth.calls.filter((call) => call === "startRefresh").length >= 2);
  assert.equal(latest().session?.user.id, "user-b");
});

test("Auth: resume yanıtı kendisinden sonraki hesap olayını değiştiremez", async (t) => {
  const auth = new FakeAuth();
  const { controller, latest } = fixture(auth);
  t.after(controller.dispose);
  await controller.start();
  const pending = deferred<ReturnType<typeof response>>();
  auth.getSession = () => pending.promise;
  controller.setActive(false);
  controller.setActive(true);
  auth.emit("SIGNED_IN", session("user-b"));
  pending.resolve(response(session("user-a")));
  await flush();
  assert.equal(latest().session?.user.id, "user-b");
});

test("Auth: eksik yapılandırmada bağlantı ve yetkili oturum kurulmaz", async () => {
  const { controller, latest } = fixture(null);
  await controller.start();
  assert.equal(latest().status, "unavailable");
  assert.equal(latest().session, null);
  await assert.rejects(controller.login("user@example.com", "password1"), /yapılandırılmamış/);
  controller.dispose();
});

test("Auth: korumalı rota yüklemeyi bekler ve oturumsuz kullanıcıyı girişe yönlendirir", async (t) => {
  assert.equal(routeAccess("loading"), "loading");
  assert.equal(routeAccess("anonymous"), "login");
  assert.equal(routeAccess("unavailable"), "login");
  assert.equal(routeAccess("authenticated"), "allow");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let time = BASE_TIME;
  const auth = new FakeAuth();
  auth.current = session("user-a", BASE_TIME + 1);
  const { controller, latest } = fixture(auth, () => time);
  t.after(controller.dispose);
  await controller.start();
  assert.equal(routeAccess(latest().status), "allow");
  time += 1;
  t.mock.timers.tick(1_000);
  assert.equal(routeAccess(latest().status), "login");
});

test("Auth: dinleyici kurulumu hatası başlangıcı yüklemede bırakmaz", async () => {
  const auth = new FakeAuth();
  auth.onAuthStateChange = () => { throw new TypeError("private-provider-details"); };
  const { controller, latest } = fixture(auth);
  await controller.start();
  assert.equal(latest().status, "anonymous");
  assert.match(latest().error!, /İnternet/);
  controller.dispose();
});

test("Auth: ağ hatası veya imha sonrası geç gelen yanıt oturum açmaz", async () => {
  const auth = new FakeAuth();
  auth.getSession = async () => { throw new TypeError("private-provider-details"); };
  const first = fixture(auth);
  await first.controller.start();
  assert.equal(first.latest().status, "anonymous");
  assert.match(first.latest().error!, /İnternet/);
  first.controller.dispose();
  const pending = deferred<ReturnType<typeof response>>();
  auth.getSession = () => pending.promise;
  const second = fixture(auth);
  const loading = second.controller.start();
  second.controller.dispose();
  pending.resolve(response(session()));
  await loading;
  assert.equal(second.changes.length, 1);
  assert.ok(auth.calls.includes("unsubscribe"));
});
