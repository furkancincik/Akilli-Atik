# Phase 4 STEP 2 Veritabanı ve RLS Doğrulaması

## Kapsam ve tarih

İşlem tarihi **15 Ekim 2026**. Planlanan rapor dönemi **19–23 Ekim 2026**; burada belirtilen çalışma gelecekte yapılmış gibi tarihlenmemiştir. Kapsam yalnız migration taslağı, yerel SQL/RLS testleri ve dokümantasyondur. Authentication, uygulama kayıt servisi ve arayüz geliştirmesi yapılmadı.

## Ön kontroller ve canlı şema envanteri

- Branch `main`, HEAD `f6b2915443483a85919e53fa0d18af31aaa69727`.
- Başlangıçta `README.md` değiştirilmiş görünüyordu; metinsel diff boştu ve satır sonu uyarısı vardı. Dosya geri alınmadı veya yeniden yazılmadı.
- Yalnız bağımsız **Akilli-Atik**, Project Ref `nyoxbwandadakfagoner`, yerel link ile eşleşti; uzak proje ACTIVE_HEALTHY.
- Supabase CLI 2.120.0 `db query --linked --project-ref ...` üzerinden **BEGIN TRANSACTION READ ONLY / SELECT / ROLLBACK** kullanıldı. Kullanıcı satırları okunmadı.
- Canlı PostgreSQL **17.11**, `public` şemasında tablo ve RLS politikası **yok**. `public.waste_analyses` **yok**. `supabase_migrations.schema_migrations` **yok**; dolayısıyla kayıtlı migration geçmişi bulunmuyor.
- `auth.uid()` mevcut. Yönetilen Auth/Storage şemaları değiştirilmedi ve kullanıcı kayıtları sorgulanmadı.
- Kontrol isteği **HTTP 503 / SERVICE_DISABLED** döndü; analiz kapalı kaldı.

Bu anlık envanter canlıya uygulama onayı değildir. Uygulama günü şema, migration geçmişi, varsayılan yetkiler ve rol üyelikleri tekrar incelenmelidir.

## Dosyalar ve model

Migration: `supabase/migrations/20261015000100_create_waste_analyses.sql`.

| Alan | Tür ve kural |
| --- | --- |
| `id` | UUID, PK, `gen_random_uuid()` varsayılanı |
| `user_id` | UUID NOT NULL, `auth.users(id)` FK, ON DELETE CASCADE |
| `client_request_id` | UUID NOT NULL |
| `created_at` | timestamptz NOT NULL, `now()` varsayılanı |
| `waste_name` | varchar(120) NOT NULL, boş olamaz |
| `category` | text NOT NULL, sekiz gerçek JSON kategorisi |
| `description` | varchar(1200) NOT NULL, boş olamaz |
| `sorting_instruction` | varchar(1600) NOT NULL, boş olamaz |
| `recycling_advice` | varchar(1600) NOT NULL, boş olamaz |
| `safety_warning` | nullable varchar(1200); verilirse boş olamaz |
| `object_count` | NOT NULL, yalnız `single` / `multiple` |
| `uncertain`, `hazardous` | NOT NULL boolean |
| `model` | varchar(120) NOT NULL, boş olamaz |
| `schema_version` | integer NOT NULL DEFAULT 1; mevcut sözleşme için CHECK = 1 |

Kategori değerleri `supabase/functions/_shared/analysis.ts` sözleşmesiyle birebirdir: **Plastik, Cam, Kâğıt/Karton, Metal, Organik, Elektronik, Pil, Diğer**. Ayrı İngilizce kodlara dönüşüm gerekmiyor. Boşluk, tab, yeni satır ve JS trim() kapsamındaki Unicode boşluklarından oluşan metinler reddedilir.

`UNIQUE(user_id, client_request_id)` aynı kullanıcı/isteğin ikinci kayıt üretmesini engeller; aynı istek kimliği farklı kullanıcı için geçerlidir. Listeleme indeksi `(user_id, created_at DESC, id DESC)` şeklindedir. Fotoğraf, base64, token, güven yüzdesi ve ham Gemini yanıtı alanı yoktur. Başarısız analizleri temsilen `object_count=none` kaydedilemez.

## Yetkiler ve RLS

RLS tablo oluşturulurken etkinleştirilir. Varsayılan tablo yetkileri PUBLIC, anon, authenticated ve service_role rollerinden kaldırılır; yalnız gerekli haklar yeniden verilir.

| Rol | Yetki | Politika |
| --- | --- | --- |
| `anon` / PUBLIC | Tablo yetkisi yok | Kayıtlara erişemez |
| `authenticated` | SELECT, DELETE | Her işlemde `(SELECT auth.uid()) = user_id` |
| `authenticated` | INSERT / UPDATE yok | İstemciden doğrudan yazma engelli |
| `service_role` | INSERT, SELECT | Güvenilir sunucu kaydı ve RETURNING; UPDATE/DELETE verilmez |

Service role BYPASSRLS yetkilidir; bu bir kullanıcı izolasyon mekanizması değildir. STEP 3/sonrası güvenilir kayıt işlemi `user_id` değerini doğrulanmış kullanıcı JWT'sinden almalı; istemciye service role anahtarı veya ayrıcalıklı INSERT yolu verilmemelidir. Veritabanı sonucu gerçekten Gemini'nin üretip üretmediğini kanıtlayamaz; server doğrulaması zorunludur.

## Yerel test ortamı

```powershell
npm run test:db
```

Gereksinim: çalışan Docker Desktop/Linux engine. Mevcut Docker kurulumu başlatıldı; yeni uygulama bağımlılığı veya veritabanı sunucusu Windows'a kurulmadı. Resmî `postgres:17-alpine` imajı indirildi. Çalıştırılan motor **PostgreSQL 17.11**, imaj özeti:

```text
postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24
```

Runner her çalıştırmada yalnız kendine ait geçici bir konteyner oluşturur: `--network none`, dışarı açılan port yok, veriler tmpfs üzerinde. Yerel soket bağlantısı kullanılır. Runner bağlantı URL'si, canlı proje ref'i, `.env.local` veya CLI credential okumaz. Test bittikten sonra konteyner kaldırılır; diğer Docker iş yüklerine dokunulmaz. İmaj önbellekte kalır. Çalıştırılan imajın özeti her koşuda yazılır; gelecekte aynı tag farklı patch sürümüne ilerleyebilir.

`supabase/tests/bootstrap.sql`, yalnız gereken Supabase auth sözleşmesini kurar: sentetik `auth.users`, `auth.uid()` ve üç rol. **Tam Supabase Auth/GoTrue/PostgREST ortamı değildir.** RLS ve SQL davranışı gerçek PostgreSQL motorunda test edilir; JWT imza doğrulaması ve HTTP Auth entegrasyonu bu testin kapsamında değildir.

Test dosyası veritabanı adını, yerel soketi ve `akilli_atik.test_database=true` işaretini kontrol eder. İki `example.invalid` kullanıcısı kullanılır; tüm fixture işlemleri BEGIN/ROLLBACK içindedir. Runner rollback sonrası kullanıcı ve analiz tablolarının boş olduğunu ayrıca doğrular. Bu dosyaları canlıya göndermeyin.

## Çalıştırılmış sonuçlar

**88/88 SQL güvenlik/doğrulama kontrolü başarılı.** Migration gerçek PostgreSQL 17.11 üzerinde hatasız uygulanmıştır; SQL sözdizimi yalnız metinsel incelemeyle değerlendirilmemiştir.

| İstenen senaryo | Sonuç |
| --- | --- |
| A kendi kaydını okuyabilir | PASS |
| A B'nin kaydını ID üzerinden okuyamaz | PASS, 0 satır |
| A B'nin kaydını silemez | PASS, 0 satır; B kaydı ayrıcalıklı fixture kontrolünde mevcut |
| Anonim kullanıcı okuyamaz | PASS, SQLSTATE 42501 |
| İstemci doğrudan INSERT yapamaz | PASS, geçerli gövdede SQLSTATE 42501 |
| İstemci UPDATE yapamaz | PASS, kendi kaydında SQLSTATE 42501 |
| Geçersiz kategori reddedilir | PASS, SQLSTATE 23514 |
| Boş zorunlu alanlar reddedilir | PASS, boş/ASCII whitespace/Unicode whitespace için 23514 |
| Aynı kullanıcı/istek tekrarlanamaz | PASS, SQLSTATE 23505 |
| Kullanıcı silinince kayıtlar kaldırılır | PASS, CASCADE; diğer kullanıcı korunur |

Ek kontroller: B'nin kendi kaydını okuması, A'nın kendi kaydını silmesi, kimliksiz authenticated oturumu, sekiz kategorinin kabulü, alan uzunlukları, NOT NULL, FK, schema_version, varsayılan UUID/tarih ve service_role yetkileri. RLS kontrolleri tablo sahibi/postgres/service_role olarak değil gerçek authenticated/anon rolleri altında çalıştırılır. Fixture oluşturma ve kısıt kontrolleri ayrıcalıklı test rolünde yapılır; böylece yetki hataları kısıt hatasını maskelemez.

Diğer kontroller: **TypeScript PASS, ESLint PASS, mevcut otomatik testler 34/34 PASS, production build PASS**. Test log'u Git dışında `report-qa/phase4-step2-db-test.log` konumundadır.

## Geri dönüş ve canlıya uygulama riskleri

- Migration BEGIN/COMMIT içerir; işlem hatasında kısmi tablo/politika bırakmaz. Mevcut tabloyu `IF NOT EXISTS` ile sessizce kabul etmez; isim çakışmasında durur.
- Migration henüz canlıya uygulanmadığından şu anda geri alınacak canlı değişiklik yoktur.
- Gelecekte `DROP TABLE` ile geri dönüş **tüm geçmişi siler**. Otomatik down migration eklenmedi. Verili ortamda önce yedek/export, bağımlılık incelemesi ve açık onay gerekir; tercihen ileri düzeltme migration'ı hazırlanır.
- `ON DELETE CASCADE` hesap silinince geçmişi kalıcı siler; hesap silme özelliğinde ayrıca kullanıcıya açıklanmalıdır.
- UNIQUE çift kaydı önler; eşzamanlı yinelenen Gemini çağrı maliyetini tek başına önlemez.
- Şema sürümü 1 ile sınırlıdır; yeni sözleşme ayrı migration ve doğrulama gerektirir.
- Yerel fixture Auth şemasının tüm Supabase üretim davranışını temsil etmez. Canlı uygulama öncesi güncel şema/rol üyelikleri/default privilege ve eklenti/bağımlılık kontrolü tekrar gerekir.

## Sonuç ve sonraki adım

**STEP 2: Yerel migration/SQL/RLS kapsamı PASS.** Canlı uygulama ve gerçek Auth entegrasyonu doğrulanmış değildir. Canlı migration, deployment, Gemini çağrısı, analiz etkinleştirmesi, kullanıcı verisi değişikliği, Git commit/push ve STEP 3 yapılmadı.

Sonraki öneri STEP 3 Authentication geliştirmesinin ayrı onayla başlamasıdır. Canlı veritabanına geçiş ayrıca migration incelemesi ve açık uygulama onayı gerektirir. Phase 3.1'in fiziksel Android testi açık kalır; bu sonuç onu tamamlanmış yapmaz.
