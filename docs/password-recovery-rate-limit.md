# Parola kurtarma gönderim sınırı incelemesi

**Tarih:** 16 Ekim 2026. **Proje:** yalnız Akilli-Atik / `nyoxbwandadakfagoner`.

## Sonuç: canlı projenin e-posta kotası dolmuş

Supabase Auth logları, API Gateway kayıtları ve canlı Auth yapılandırması salt okunur incelendi. Sorun yönlendirme adresinden veya normal tek tıklamada yinelenen frontend çağrısından kaynaklanmıyor. Sunucu `over_email_send_rate_limit` / HTTP 429 döndürmüş; hata kaydı proje e-posta kotası mesajıyla eşleşiyor. Aynı saat içinde zaten iki başarılı kurtarma gönderimi var.

Canlı yapılandırma:

| Kontrol | Doğrulanan değer |
| --- | --- |
| E-posta gönderim kotası | **2 / saat**, proje genelinde |
| Aynı alıcı için minimum gönderim aralığı | **60 saniye** |
| Özel SMTP | Yapılandırılmamış |
| E-posta doğrulaması | Açık |
| Site URL | `http://localhost:5173` |
| Redirect allowlist | `http://localhost:5173/**` |

Supabase'in yerleşik göndericisinde kayıt/doğrulama ve kurtarma gibi e-posta gönderen Auth işlemleri aynı proje kotasını paylaşır. Aynı kullanıcının 60 saniyelik bekleme süresi ayrı bir kontroldür. `over_email_send_rate_limit` kodu tek başına ikisini ayırmaz; bu incelemede zaman çizelgesi, canlı kota ve log mesajı birlikte değerlendirildi. [Resmî sınırlar](https://supabase.com/docs/guides/auth/rate-limits), [SMTP açıklaması](https://supabase.com/docs/guides/auth/auth-smtp).

## Mevcut canlı kayıtlar

İnceleme aralığı: 14 Ekim 2026 23:05:24 UTC – 15 Ekim 2026 22:05:24 UTC. Aşağıdaki saatler **Türkiye saatiyle 16 Ekim 2026** tarihindedir:

| Saat | Auth işlemi | HTTP | Bulgular |
| --- | --- | --- | --- |
| 00:17:29 | `POST /recover` | 200 | Recovery gönderim olayı da kaydedilmiş |
| 00:22:54 | `POST /recover` | 200 | İkinci recovery gönderim olayı da kaydedilmiş |
| 00:55:47 | `POST /recover` | 429 | `over_email_send_rate_limit`, proje e-posta kotası |
| 00:58:32 | `POST /recover` | 429 | Aynı kota hatası |

Gateway kayıtlarında dört ayrı deneme için birer `POST /auth/v1/recover` var. 00:55:47'deki `OPTIONS`, CORS ön kontrolüdür; ikinci bir e-posta gönderimi değildir. Son iki hata yaklaşık 2 dakika 45 saniye arayla oluşmuş; eşzamanlı yinelenen POST çifti görünmüyor. Auth ve Gateway aynı HTTP isteğinin farklı katman kayıtlarıdır; iki ayrı gönderim gibi sayılmadı. Önceki gönderimlerin kim tarafından başlatıldığı bu incelemede ilişkilendirilmedi. HTTP 200 ve gönderim olayı, e-postanın gelen kutusuna teslim edildiğini tek başına kanıtlamaz.

Bunlar önceden mevcut kayıtlardır. **Bu görevde canlı `/recover` çağrısı veya e-posta gönderimi yapılmadı.** Loglarda kullanıcı adresi, IP, referrer, token, parola veya kurtarma bağlantısı seçilmedi/raporlanmadı. Kimlik bilgileri çıktıya ya da dosyaya yazılmadan mevcut CLI oturumu kullanıldı. Yalnız hedef projenin resmî Management API GET uçları sorgulandı; Dashboard veya Auth ayarları değiştirilmedi.

## Frontend incelemesi ve düzeltmeler

Normal gönderim zinciri:

`ForgotPasswordPage.onSubmit → AuthProvider.requestPasswordReset → recovery controller.send → SDK.resetPasswordForEmail → POST /recover`

Sayfa açılışında, React StrictMode etkisinde veya yenilemede e-posta gönderimi yok. Kurulu SDK bu çağrıyı hata halinde otomatik tekrar etmiyor.

Bulunan ayrı bir kod açığı: iki `submit` olayı React'in state değişikliğini ekrana işlemesinden önce eşzamanlı geldiğinde eski `busy` kontrolü iki çağrıya izin verebiliyordu. Bu, normal tek tıklama ve canlı kota hatasının kanıtlanmış nedeni değildir; bağımsız olarak düzeltildi.

| Dosya | Değişiklik |
| --- | --- |
| `src/pages/ForgotPasswordPage.tsx` | Senkron `useRef` kilidi, React render'ından önce ikinci form gönderimini engeller |
| `src/services/passwordRecovery.ts` | Servis katmanında eşzamanlı gönderim kilidi; bitiş/hata sonrası kilit açılır; otomatik tekrar yok |
| `src/services/passwordRecovery.ts` | E-posta kotası/bekleme, genel istek sınırı, sunucu 5xx ve bağlantı hataları için ayrı sabit Türkçe mesajlar |
| `tests/passwordRecovery.test.ts` | Kota ayrımı, 5xx/ağ ayrımı, eşzamanlı servis çağrısı ve hata sonrası kilidin serbest bırakılması için dört test |
| `docs/password-recovery-rate-limit.md` | Bu inceleme raporu |

E-posta sınırı mesajı kotanın veya önceki isteklerin etkisini açıklar; kullanıcıyı tek başına çok kez tıklamakla ilişkilendirmez. Hesabın varlığı ve ham sağlayıcı ayrıntıları açıklanmaz. Doğrulanmamış bir kesin yeniden deneme süresi gösterilmez.

## Bu görevde çalıştırılan testler

| Kontrol | Sonuç |
| --- | --- |
| TypeScript, frontend ve Edge | PASS |
| ESLint | PASS |
| Unit testler | **90/90 PASS**; önceki 86 korundu, dört test eklendi |
| Mock tarayıcı istek sayısı suite'i | **29/29 PASS** |
| Mevcut kurtarma mock tarayıcı suite'i | **40/40 PASS** |
| Production build | PASS; mevcut 500 kB chunk uyarısı devam ediyor |
| Canlı yeni e-posta / parola değişikliği | **YAPILMADI**, gönderim yasağı korundu |
| SQL/RLS, Android Gradle/APK | Bu görevde yeniden çalıştırılmadı; SQL/Android kaynakları değişmedi |

Gerçek SDK ve izole Edge tarayıcılarıyla, bütün Supabase yanıtları yerel test fixture'larıyla yakalandı. Başarı, e-posta 429, genel istek 429, HTTP 500 ve ağ hatasında bir normal tıklama **tam bir POST** üretiyor. Mount/reload ek istek üretmiyor. Fiziksel çift tıklama bir POST; eşzamanlı iki submit eski kodda iki POST, düzeltmeden sonra bir POST üretiyor. Tüm bu testlerde canlı Supabase/e-posta isteği sıfır.

Yerel kanıtlar Git dışında: `report-qa/recovery-auth-rate-verified.json`, `recovery-auth-log-events.json`, `recovery-rate-unit.log`, `recovery-rate-build.log`, `recovery-browser/request-count-before-fix.json`, `recovery-browser/request-count.json`, `recovery-browser/results.json`.

## Çözüm ve kalan adımlar

1. Şimdilik yeni gönderim yapılmaz. Kota penceresi yenilendikten sonra bile yeni deneme için kullanıcıdan ayrıca açık izin gerekir. Yeniden deneme otomatik başlatılmadı.
2. Sürekli geliştirme ve gerçek kullanıma geçiş için uygun bir özel SMTP sağlayıcısı değerlendirilebilir. SMTP ve kota değişiklikleri ayrıca onay ve güvenli Dashboard yapılandırması gerektirir. API/SMTP anahtarları sohbete veya frontend'e yazılmaz. [Resmî SMTP kurulumu](https://supabase.com/docs/guides/auth/auth-smtp).
3. E-posta doğrulaması veya rate limit korumaları bu sorunu aşmak için kapatılmamalı. Frontend düzeltmesi sunucunun kotasını artırmaz.
4. Yeni gönderim onayı olmadan canlı kurtarma kabulü tamamlanmış sayılmaz. STEP 3.1 bütünüyle PASS değildir; STEP 4'e geçilmedi. Commit/push, migration, Edge deployment, Gemini çağrısı ve yeni bağımlılık yok.

Güncel frontend düzeltmeleri production web build'ine alındı. Önceki Android APK bu görevde yenilenmedi.
