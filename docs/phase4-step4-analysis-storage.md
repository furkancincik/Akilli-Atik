# Phase 4 STEP 4 Güvenli analiz kaydı

**Çalışma tarihi:** 16 Ekim 2026. **Rapor dönemi:** 19–23 Ekim 2026.

**Sonuç:** Yerel geliştirme ve otomatik doğrulamalar **PASS**. Canlı uçtan uca kayıt kabulü **BLOCKED — migration, deployment ve kontrollü test için ayrı onay bekliyor**. Bu sonuç canlı kayıt özelliğinin kullanıma açıldığı anlamına gelmez.

## Ön kontroller ve korunan durum

- Branch `main`, HEAD `f6b2915443483a85919e53fa0d18af31aaa69727`; commit/push yapılmadı. Önceden bulunan değişiklikler, README, Auth, parola kurtarma, tema ve animasyonlar korundu.
- Yerel link ve tüm canlı kontroller yalnız **Akilli-Atik / `nyoxbwandadakfagoner`** projesine aittir.
- Supabase CLI 2.120.0 ile `BEGIN TRANSACTION READ ONLY / SELECT / ROLLBACK` kullanıldı. Canlı PostgreSQL 17.11; `public` tablo sayısı **0**, RLS politika sayısı **0**. `public.waste_analyses` ve `supabase_migrations.schema_migrations` **yok**. Kullanıcı satırları okunmadı.
- Public yapılandırmayla Auth ayarları **HTTP 200**; e-posta sağlayıcısı açık, e-posta doğrulaması gerekli.
- Fotoğraf içermeyen kapalı servis kontrolü **HTTP 503 / SERVICE_DISABLED**. `ANALYSIS_ENABLED=false` değişmedi. Gerçek Gemini çağrısı ve yeni test kodu oluşturulmadı.
- Canlı `analyze-waste`: **ACTIVE, sürüm 3, `verify_jwt=false`**. Bu canlı ayar değiştirilmedi.

## Değişen dosyalar

| Dosya | Bu adımın değişikliği |
| --- | --- |
| `supabase/functions/_shared/analysis.ts` | JWT/kimlik doğrulama hata kodları, UUID kontrolü, analiz ile kayıt durumunu ayıran sözleşme ve doğrulayıcı |
| `supabase/functions/analyze-waste/authentication.ts` | Yeni: Supabase Auth üzerinden kullanıcı doğrulama |
| `supabase/functions/analyze-waste/storage.ts` | Yeni: yalnız sunucuda kullanılan dar kapsamlı kayıt servisi |
| `supabase/functions/analyze-waste/handler.ts` | Doğrulanmış sahiplik, istek kimliği, limit, mevcut kayıt okuması, eşzamanlı tekrar paylaşımı, analiz sonrası kayıt |
| `supabase/functions/analyze-waste/index.ts` | Sunucu ortamından Supabase URL/service role erişimi |
| `supabase/config.toml` | Gelecek deployment için yerel `verify_jwt=true`; canlı ayar değişmedi |
| `supabase/functions/.env.example` | Yalnız sunucuya ait ortam değişkenlerinin boş örnekleri |
| `src/services/analysis.ts` | SDK oturumuyla çalışan istek katmanına bağlantı |
| `src/services/analysisRequest.ts` | Yeni: test edilebilir JWT, oturum, fotoğraf ve yanıt kontrolleri |
| `src/hooks/useWasteAnalysis.ts` | Fotoğraf başına kararlı UUID, çift gönderim kilidi, kullanıcı değişiminde iptal, bağımsız kayıt durumu |
| `src/pages/ScanPage.tsx` | Analiz ile kayıt sonucunu ayıran Türkçe bildirimler |
| `tests/analysis.test.ts` | Mevcut senaryolar yeni kimlik/istek sözleşmesine uyarlandı; kapsam korunuyor |
| `tests/analysisAuthentication.test.ts` | Yeni: 16 doğrulama senaryosu |
| `tests/analysisStorage.test.ts` | Yeni: 14 kayıt adaptörü senaryosu |
| `tests/analysisHandler.test.ts` | Yeni: 23 bütünleşik handler senaryosu |
| `tests/analysisClient.test.ts` | Yeni: 14 istemci/oturum senaryosu |
| `tests/analysisOutcome.test.ts` | Yeni: 4 analiz/kayıt sözleşmesi senaryosu |
| `supabase/tests/analysis_storage.test.sql` | Yeni: 16 gerçek PostgreSQL kayıt sözleşmesi kontrolü |
| `scripts/test-database.mjs` | Yeni SQL grubunu mevcut 88 kontrolden sonra çalıştırır |
| `docs/phase4-step4-analysis-storage.md` | Bu teknik rapor |

Mevcut `20261015000100_create_waste_analyses.sql` migration'ı değiştirilmedi; yeni migration gerekmedi. Derleme çıktıları ve `report-qa` dosyaları Git dışında tutulur. Yeni paket eklenmedi.

## JWT ve oturum doğrulaması

İstemci, ana Supabase SDK istemcisinin güncel oturumundan access token alır. İstek binary JPEG olarak kalır:

- `Authorization: Bearer <kullanıcı access token>`
- `apikey: <public proje anahtarı>`
- `x-client-request-id: <UUID>`
- Mevcut süreli test başlığı ve JPEG Content-Type.

Kullanıcı kimliği gövdeye veya sahiplik başlığına yazılmaz. İstemcide bilinen kullanıcı kimliği yalnız yerel oturum karşılaştırmasında kullanılır; bir yetkilendirme kanıtı değildir.

Sunucu, yalnız onaylı projenin **GET `/auth/v1/user`** uç noktasından doğrulanmış kullanıcıyı alır. JWT biçim kontrolü yalnız giriş doğrulamasıdır; token decode edilerek kimlik kabul edilmez. Eksik, bozuk, süresi dolmuş veya Auth tarafından reddedilen token **401 / USER_UNAUTHORIZED**; Auth ağ/servis/zaman aşımı sorunu **503 / AUTH_UNAVAILABLE** üretir. Kullanıcı anonim olamaz. Auth yanıtı sınırlı boyutta okunur, süre sınırı 8 saniyedir; yönlendirme izlenmez, hassas hata ayrıntıları döndürülmez.

Kapı sırası: izinli origin → yöntem/preflight → public anahtar → servis açık mı → süreli test kodu → hız/eşzamanlılık limiti → kullanıcı doğrulama → UUID → fotoğraf → kayıt arama/analiz/kayıt. Bu nedenle servis kapalıyken geçerli public anahtarlı istek JWT doğrulamasına ulaşmadan 503 alır; 401 senaryoları servis açık ve önceki kapılar geçerliyken test edilir.

Yerel platform ayarı **`verify_jwt=true`** olarak hazırlandı; gelecekte platform kontrolü de devrede olacak. Handler doğrulaması ayrıca zorunludur. Public anahtar kullanıcı kimliği sayılmaz. Yeni bağımlılık eklemeden Supabase Auth doğrulama uç noktası kullanılır. [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [JWT doğrulaması](https://supabase.com/docs/guides/auth/jwts), [platform Authorization kontrolleri](https://supabase.com/docs/guides/functions/auth-headers).

**Çıkış sınırı:** İstemci çıkış, kurtarma oturumu veya hesap değişiminde yeni işlem başlatmaz, bekleyen isteği iptal eder ve geç yanıtı göstermez. Supabase access JWT'si yerel çıkıştan sonra sona erme zamanına kadar geçerli kalabilir. Bu çalışma anlık sunucu tarafı token iptal garantisi eklemez; zaten kabul edilmiş bir isteğin ağ iptalinden önce tamamlanması da mümkündür. [Supabase oturum ömrü](https://supabase.com/docs/guides/auth/sessions).

## Kayıt mimarisi ve RLS

1. Sunucu fotoğrafın gerçek JPEG yapısını ve boyutunu doğrular.
2. Doğrulanmış `user.id` ve `client_request_id` ile önce mevcut kayıt aranır.
3. Kayıt varsa özgün analiz döndürülür; yeni Gemini çağrısı yapılmaz.
4. Kayıt yoksa Gemini sonucu mevcut JSON sözleşmesiyle doğrulanır ve tehlikeli atık kuralları uygulanır.
5. Yalnız `success=true` sonuç, yeniden doğrulanarak server-side INSERT ile kaydedilir.
6. Atık bulunamaması, geçersiz JSON ve servis hataları kayıt oluşturmaz.

Tablo ve 15 alanlı sözleşme STEP 2 migration'ıyla eşleşir: doğrulanmış kullanıcı/istek kimlikleri, ayrıştırma metinleri, sekiz gerçek kategori, nesne sayısı, belirsizlik/tehlike bayrakları, model ve `schema_version=1`. `id` ve `created_at` veritabanı varsayılanlarıdır. Fotoğraf/base64, token, test kodu ve ham Gemini yanıtı saklanmaz. İstemcinin değiştirdiği analiz JSON'u kabul eden bir kayıt endpoint'i yoktur.

Service role yalnız Edge Function ortamından alınır. Bu anahtar RLS'yi atladığından her okuma **hem kullanıcı hem istek kimliğiyle** filtrelenir; dönen satırın sahipliği tekrar doğrulanır. Adaptör yalnız sabit alan listesiyle SELECT/INSERT yapar; UPDATE/DELETE yolu yoktur. URL onaylı proje veya yerel loopback ile sınırlıdır; yönlendirme izlenmez. Her DB isteğinin süre sınırı 5 saniye, yanıt sınırı 32 KiB'dir.

Mevcut yetkiler korunur:

| Rol | İzin |
| --- | --- |
| Anonim / PUBLIC | Tablo erişimi yok |
| authenticated | Yalnız kendi satırlarını SELECT/DELETE; INSERT/UPDATE yok |
| service_role | Güvenilir sunucu kaydı için SELECT/INSERT; UPDATE/DELETE verilmez |

Kullanıcı kimliği `auth.users` dış anahtarıyla korunur; hesap silinince kayıtlar CASCADE ile silinir. Bu adım gerçek kullanıcı silmedi ve canlı veri değiştirmedi.

## Tekrar istekler ve hata davranışı

Fotoğraf/kullanıcı başına UUID oluşturulur; aynı fotoğraftaki tekrar denemede korunur, yeni fotoğrafta yenilenir. İstemcide senkron kilit çift tıklamayı durdurur. Aynı Edge Function örneğinde aynı kullanıcı/istek için eşzamanlı işlemler paylaşılır. Mevcut iki aktif işlem, 30/saat ve IP kovası başına 3/dakika sınırları Auth doğrulamasını da kapsar.

`UNIQUE(user_id, client_request_id)` ikinci satırı engeller. INSERT sırasında 23505 olursa iki kimlikle özgün kayıt yeniden okunur; yeni model sonucuyla mevcut kayıt değiştirilmez. Farklı kullanıcılar aynı UUID'yi kullanabilir, kayıtları birbirine karışmaz.

**Dağıtık sınır:** Farklı Edge Function örnekleri aynı anda henüz bulunmayan isteği işleyebilir; tek satır garantisi vardır, küresel tek Gemini çağrısı garantisi yoktur. Limitler de örnek belleğindedir. Çok kullanıcılı genel açılıştan önce kalıcı kota/claim tasarımı ayrıca değerlendirilmelidir; bu görevde yeni tablo veya dağıtık altyapı eklenmedi.

Yanıt analizi ve kaydı ayırır:

| Durum | HTTP ve `persistence` | Arayüz |
| --- | --- | --- |
| Analiz ve kayıt başarılı | 200 / saved + kayıt UUID | Analiz tamamlandı ve kaydedildi |
| Aynı istek daha önce kaydedilmiş | 200 / duplicate + özgün UUID | Önceki sonuç gösterilir |
| Analiz başarılı, DB erişimi/kaydı başarısız | 200 / failed | Geçerli analiz görünür; kaydedilemediği açıklanır |
| Atık bulunamadı | 200 / not_saved | Atık tespit edilemedi; kayıt oluşturulmaz |
| JWT/JSON/fotoğraf/model isteği hatası | Güvenli hata kodu | Hata Türkçe gösterilir; kayıt oluşturulmaz |

İstemci analiz JSON'unu tekrar doğrular ve güvenlik kurallarını uygular. Kayıt metadatası bozuksa kayıt başarısı varsayılmaz; geçerli analiz korunup failed/not_saved gösterilir. Aynı fotoğrafta yeniden deneme mevcut kaydı getirir. Önceki DB kesintisinde kayıt hiç oluşmadıysa yeniden deneme yeni Gemini çağrısı gerektirebilir. İstemci genel zaman aşımı, sunucunun ayrı Auth/fotoğraf/DB/Gemini sürelerini karşılayacak biçimde 75 saniyedir.

## Çalıştırılmış testler

| Kontrol | Sonuç | Kapsam |
| --- | --- | --- |
| `npm run typecheck` | PASS | React ve Edge TypeScript |
| `npm run lint` | PASS | ESLint |
| `npm test` | **162/162 PASS** | Önceki 91 + yeni 71 test; gerçek Gemini/Auth/PostgREST çağrısı yok |
| `npm run test:db` | **104/104 PASS** | Önceki 88 + yeni 16; gerçek PostgreSQL 17.11, izole geçici ortam |
| Mevcut UX tarayıcı | **47/47 PASS** | Gerçek Edge tarayıcısı, dış servisler mock |
| Animasyon tarayıcı | **34/34 PASS** | Görünürlük/sıralama/reduced-motion/temizlik/mobil regresyonu |
| Parola kurtarma tarayıcı | **40/40 PASS** | Mock Auth; gerçek e-posta gönderilmedi |
| HTTP 429/istek sayısı tarayıcı | **29/29 PASS** | Tek tıklama/çift gönderim ve hata ayrımı |
| Yeni analiz tarayıcı | **18/18 PASS** | JWT başlığı, kayıt durumları, çift gönderim, UUID, çıkış/geç yanıt, 320 px |
| Production build | PASS | `npm run android:apk` içindeki `npm run build` |
| Capacitor sync | PASS | Mevcut App/Camera eklentileri |
| Android Gradle/debug APK | PASS | 157 görev, BUILD SUCCESSFUL |
| APK imzası | PASS | apksigner verify, APK Signature Scheme v2 |
| Güncel dosyaların APK'ya girmesi | PASS | Üç dist asset'i APK içeriğiyle SHA256 eşleşti |
| Gerçek Auth + PostgREST + Gemini kayıt akışı | **YAPILMADI** | Canlı migration/deployment ve test onayı yok |
| Gerçek Android/emülatör | **YAPILMADI** | `adb devices -l`: bağlı hedef yok |

İstenen 15 güvenlik senaryosu JWT, handler, client ve storage unit testleriyle kapsanır. İki sentetik kullanıcı arasında gerçek PostgreSQL RLS izolasyonu ayrıca test edilir. Eksik/geçersiz/süresi dolmuş JWT 401; sahte sahiplik dikkate alınmaz; başarılı analiz kaydedilir; başarısız/no-waste/geçersiz sonuç kaydedilmez; DB hatasında sonuç korunur; tekrar ve çift gönderim ayrıştırılır; çıkış/hesap değişimi sonrası eski istemci sonucu engellenir; yabancı satır okunamaz veya silinemez. Sunucudaki anlık logout iptali sınırı yukarıda belirtilmiştir.

SQL runner ağsız, portsuz, tmpfs kullanan geçici Docker konteynerinde migration'ı uygular; iki test işlemini ROLLBACK yapar, tabloların boş kaldığını doğrular ve konteyneri kaldırır. Test Auth şeması minimum fixture'dır; gerçek GoTrue veya PostgREST değildir. Adaptör HTTP testleri mock fetch kullanır. Bu sonuçlar canlı Supabase entegrasyonu olarak sunulmaz.

Yerel kanıtlar `report-qa/phase4-step4-unit.log`, `phase4-step4-typecheck.log`, `phase4-step4-lint.log`, `phase4-step4-android.log`, `phase4-step4-apk.json` ve tarayıcı sonuç JSON'larındadır. `phase4-step4-db-test.log`, tamamlanan çalıştırmanın açıkça etiketlenmiş yürütme özetidir; ham terminal transkripti değildir.

Derlemede mevcut büyük chunk (>500 kB) ve Gradle `flatDir` uyarıları görülür; derlemeyi durdurmadılar. Bu adımda ilgili bağımlılık/refactoring kapsamı genişletilmedi.

## Android çıktısı

- Dosya: `C:\Users\gg\Desktop\Akilli-Atik\android\app\build\outputs\apk\debug\app-debug.apk`
- Boyut: **9.896.425 bayt**.
- SHA256: `D5524BC1B48E5B045174165E9A09F48F12020FC2E00DC46A3D3B6CAAE1AB9D66`.
- Kimlik `com.akilliatik.app`; etiket `Akıllı Atık`; minimum SDK 24, hedef/compile SDK 36.
- JDK 21 ve mevcut Android SDK kullanıldı; yeni ortam kurulmadı. Debug imzası doğrulandı, release/mağaza paketi üretilmedi.

## Canlı migration ve deployment planı

Bu liste bir sonraki canlı işlemin inceleme planıdır; hiçbir komut canlıya uygulanmadı.

1. **Açık onay al.** Yalnız `nyoxbwandadakfagoner` hedefini, migration dosyasını ve kapalı deployment kapsamını onay metninde belirt.
2. Uygulama günü proje ref/link, tablo/politika/constraint/migration geçmişi ve varsayılan rol yetkilerini yeniden salt okunur kontrol et. Beklenmeyen mevcut tablo veya migration varsa dur; mevcut şemayı varsayımla ezme.
3. Yedek/geri dönüş imkânını ve şema bağımlılıklarını doğrula. Migration yalnız yeni tablo/index/constraint/politika oluşturur; mevcut kullanıcı satırlarını değiştiren DML içermez. İsim çakışmasında hata verir. Sonradan `DROP TABLE` ile geri dönüş geçmişi siler; otomatik silme yerine gerektiğinde ileri düzeltme tercih et.
4. CLI migration planında yalnız `20261015000100_create_waste_analyses.sql` bulunduğunu doğrula; ardından ayrıca onaylanan migration'ı uygula. RLS, sahiplik politikaları ve SELECT/INSERT/DELETE rol haklarını salt okunur teyit et. Test fixture SQL'lerini canlıya gönderme.
5. Sunucuda doğru Supabase URL, runtime service role mevcudiyeti, public anahtar, mevcut Gemini model/secret, izinli CORS adresleri ve **ANALYSIS_ENABLED=false** doğrulansın; secret değerleri görüntülenmesin. Service role istemci ortamına eklenmesin. Yerel web origin'i gerekiyorsa CORS değişikliği ayrıca onaylansın; mevcut canlı origin listesi yerel Vite adresini içermeyebilir.
6. Yeni handler ve platform **verify_jwt=true** birlikte kapalı olarak, yalnız onaylı projeye deploy edilsin. Eski istemci/handler sözleşmesiyle dağıtım farkı oluşmaması için yeni istemci bu deployment ile eşleştirilsin. Eksik JWT/gateway CORS ve kapalı servis davranışı doğrulansın.
7. Gerçek kayıt testi için ayrı test hesabı/erişim, en fazla 15 dakikalık test penceresi, fotoğraf yolu ve açık gönderim izni alınsın. Ancak bundan sonra kontrollü etkinleştirme, gerçek analiz, kayıt/tekrar isteği, kullanıcı izolasyonu ve kapatma doğrulaması yapılsın. Test kullanıcısı/verisi izinsiz silinmesin.
8. Analiz servisi tekrar kapalı doğrulansın; web ve daha sonra fiziksel Android testi ayrı kaydedilsin. Bunlar geçmeden canlı STEP 4 kabulü PASS yapılmasın.

**Beklenen onay:** Canlı migration ve kapalı deployment ayrı onay kapsamıdır. Gerçek Gemini testi ve analiz etkinleştirmesi de ayrı onay gerektirir. STEP 5 veya Phase 5'e geçilmedi.
