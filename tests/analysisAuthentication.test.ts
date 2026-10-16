import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_TIMEOUT_MS,
  verifyAnalysisUser,
} from "../supabase/functions/analyze-waste/authentication.ts";
import { AnalysisError } from "../supabase/functions/_shared/analysis.ts";

const userA = "a1a1a1a1-1111-4111-8111-111111111111";
const userB = "b2b2b2b2-2222-4222-8222-222222222222";
const token = "unitHeader.unitPayload.unitSignature";
const configuration = {
  supabaseUrl: "https://nyoxbwandadakfagoner.supabase.co",
  publicKey: "unit-public-api-key",
};
function request(authorization: string | null = `Bearer ${token}`): Request {
  const headers = new Headers();
  if (authorization !== null) headers.set("authorization", authorization);
  return new Request(`${configuration.supabaseUrl}/functions/v1/analyze-waste`, {
    headers,
  });
}
const unauthorized = (error: unknown) =>
  error instanceof AnalysisError && error.code === "USER_UNAUTHORIZED";
const unavailable = (error: unknown) =>
  error instanceof AnalysisError && error.code === "AUTH_UNAVAILABLE";

test("JWT: kullanıcı Supabase Auth üzerinden doğrulanır, yalnız değiştirilemez kimlik döner", async () => {
  let calls = 0;
  const user = await verifyAnalysisUser(request(), configuration, async (url, init) => {
    calls++;
    assert.equal(url, `${configuration.supabaseUrl}/auth/v1/user`);
    assert.equal(init?.method, "GET");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), `Bearer ${token}`);
    assert.equal(headers.get("apikey"), configuration.publicKey);
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({ id: userA, role: "authenticated", email: "ignored@example.test" });
  });
  assert.deepEqual(user, { id: userA });
  assert.equal(Object.isFrozen(user), true);
  assert.equal(calls, 1);
});

test("JWT: eksik, bozuk ve fazla uzun bearer başlıkları ağa gitmeden reddedilir", async () => {
  let calls = 0;
  for (const header of [
    null, "", "Basic unit", "Bearer", "Bearer unit", "Bearer a.b", "Bearer a.b.c.d",
    "Bearer a..c", "Bearer a.b.c, Bearer d.e.f", "Bearer  a.b.c", `Bearer ${"a".repeat(8193)}.b.c`,
  ]) {
    await assert.rejects(verifyAnalysisUser(request(header), configuration, async () => {
      calls++;
      return Response.json({ id: userA });
    }), unauthorized);
  }
  assert.equal(calls, 0);
});

test("JWT: bearer şeması büyük/küçük harften bağımsızdır", async () => {
  const result = await verifyAnalysisUser(request(`bearer ${token}`), configuration,
    async () => Response.json({ id: userA }));
  assert.equal(result.id, userA);
});

test("JWT: süresi dolmuş tokenın Auth sunucusu tarafından reddi yetkisiz olarak eşlenir", async () => {
  await assert.rejects(verifyAnalysisUser(request(), configuration, async () =>
    Response.json({ code: "bad_jwt", msg: "JWT expired" }, { status: 401 })), unauthorized);
});

test("JWT: geçersiz imza veya iptal edilmiş kullanıcı yanıtları yetkisizdir", async () => {
  for (const status of [401, 403, 422])
    await assert.rejects(verifyAnalysisUser(request(), configuration,
      async () => Response.json({ error: "untrusted provider detail" }, { status })), unauthorized);
});

test("JWT: istemci gövdesindeki başka kullanıcı kimliği sahipliği değiştiremez", async () => {
  const supplied = new Request(`${configuration.supabaseUrl}/functions/v1/analyze-waste`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ user_id: userB }),
  });
  const result = await verifyAnalysisUser(supplied, configuration,
    async () => Response.json({ id: userA }));
  assert.equal(result.id, userA);
  assert.equal(supplied.bodyUsed, false);
});

test("JWT: doğrulanmış yanıtta geçersiz UUID, anonim kullanıcı ve yetkisiz rol reddedilir", async () => {
  for (const user of [
    {}, { id: "not-a-uuid" }, { id: userA, is_anonymous: true },
    { id: userA, role: "anon" }, { id: userA, role: "service_role" },
  ])
    await assert.rejects(verifyAnalysisUser(request(), configuration,
      async () => Response.json(user)), unauthorized);
});

test("JWT: Auth kesintisi, kota ve yönlendirme cevabı kimlik doğrulamayı kapatır", async () => {
  for (const status of [201, 302, 400, 404, 429, 500, 502, 503, 504])
    await assert.rejects(verifyAnalysisUser(request(), configuration,
      async () => Response.json({ detail: "ignored" }, { status })), unavailable);
});

test("JWT: geçersiz veya aşırı büyük Auth JSON yanıtı kabul edilmez", async () => {
  for (const body of ["not-json", "[]", "null", "\"text\"", `{"id":"${userA}","metadata":"${"x".repeat(129 * 1024)}"}`])
    await assert.rejects(verifyAnalysisUser(request(), configuration,
      async () => new Response(body, { status: 200 })), unavailable);
});

test("JWT: Auth taşıma hataları token veya sağlayıcı ayrıntılarını dışarı sızdırmaz", async () => {
  await assert.rejects(verifyAnalysisUser(request(), configuration, async () => {
    throw new Error(`${token} ${configuration.publicKey} private provider detail`);
  }), (error: unknown) => {
    assert.ok(unavailable(error));
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes(token), false);
    assert.equal(error.message.includes(configuration.publicKey), false);
    assert.equal(error.message.includes("private provider"), false);
    return true;
  });
});

test("JWT: AbortError güvenli Auth hizmet hatasına çevrilir", async () => {
  await assert.rejects(verifyAnalysisUser(request(), configuration, async () => {
    throw new DOMException("private transport detail", "AbortError");
  }), unavailable);
});

test("JWT: Auth isteği süre sonunda abort edilir ve otomatik tekrar gönderilmez", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const pending = verifyAnalysisUser(request(), configuration, async (_url, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  });
  const rejected = assert.rejects(pending, unavailable);
  t.mock.timers.tick(AUTH_TIMEOUT_MS);
  await rejected;
  assert.equal(calls, 1);
});

test("JWT: istemci bağlantısı iptal olduğunda Auth isteği de iptal edilir", async () => {
  const controller = new AbortController();
  const supplied = new Request(`${configuration.supabaseUrl}/functions/v1/analyze-waste`, {
    headers: { authorization: `Bearer ${token}` }, signal: controller.signal,
  });
  let cancelled = false;
  const pending = verifyAnalysisUser(supplied, configuration, async (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        cancelled = true;
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    }));
  const rejected = assert.rejects(pending, unavailable);
  controller.abort();
  await rejected;
  assert.equal(cancelled, true);
});

test("JWT: başka Supabase projesi, güvensiz origin veya URL enjeksiyonu kullanılmaz", async () => {
  let calls = 0;
  for (const supabaseUrl of [
    "https://another-project.supabase.co", "http://nyoxbwandadakfagoner.supabase.co",
    "https://nyoxbwandadakfagoner.supabase.co.evil.test", "https://nyoxbwandadakfagoner.supabase.co/other",
    "https://user@nyoxbwandadakfagoner.supabase.co", "https://nyoxbwandadakfagoner.supabase.co?target=other",
    "https://nyoxbwandadakfagoner.supabase.co#fragment", "not-url",
  ])
    await assert.rejects(verifyAnalysisUser(request(), { ...configuration, supabaseUrl }, async () => {
      calls++;
      return Response.json({ id: userA });
    }), unavailable);
  assert.equal(calls, 0);
});

test("JWT: önceden iptal edilmiş istemci isteği Auth sunucusuna gönderilmez", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const supplied = new Request(`${configuration.supabaseUrl}/functions/v1/analyze-waste`, {
    headers: { authorization: `Bearer ${token}` }, signal: controller.signal,
  });
  await assert.rejects(verifyAnalysisUser(supplied, configuration, async () => {
    calls++;
    return Response.json({ id: userA });
  }), unavailable);
  assert.equal(calls, 0);
});

test("JWT: eksik veya bozuk public anahtar hata ayrıntısı vermeden erişimi kapatır", async () => {
  let calls = 0;
  for (const publicKey of ["", " ", "has whitespace", "x".repeat(8193)])
    await assert.rejects(verifyAnalysisUser(request(), { ...configuration, publicKey }, async () => {
      calls++;
      return Response.json({ id: userA });
    }), unavailable);
  assert.equal(calls, 0);
});
