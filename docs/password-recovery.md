# Güvenli parola kurtarma — Phase 4 STEP 3.1 ara görevi

Çalışma tarihi: **16 Ekim 2026**. Rapor dönemi: 19–23 Ekim 2026.

Sonraki gönderim sınırı incelemesi ve 90/90 güncel test sonucu: [Parola kurtarma kota incelemesi](password-recovery-rate-limit.md). Aşağıdaki sayımlar ilk geliştirme doğrulamasını kaydeder.

Kod ve yerel doğrulamalar tamamlandı. **Gerçek e-posta üzerinden uçtan uca kabul henüz yapılmadı; ara görevin canlı kabulü BLOCKED / kullanıcı onayı bekliyor.** Bu belge önceki Authentication raporunun yerine geçmez; parola kurtarma ekini açıklar.

## Kapsam ve mevcut durum

- Branch: `main`; başlangıç HEAD: `f6b2915443483a85919e53fa0d18af31aaa69727`.
- Önceden mevcut README, veritabanı ve Authentication değişiklikleri korundu. Commit/push yapılmadı.
- Yalnız `Akilli-Atik` / `nyoxbwandadakfagoner` kullanıldı.
- Canlı Auth ayarları salt okunur incelendi: Site URL `http://localhost:5173`, ek yönlendirme `http://localhost:5173/**`, e-posta doğrulaması açık. `/parola-yenile` mevcut liste kapsamında; Dashboard değişikliği gerekmedi.
- Public Auth settings HTTP **200**. Analiz endpoint'i izinli Android origin'iyle HTTP **503 / SERVICE_DISABLED**; `ANALYSIS_ENABLED=false` korundu.
- Geliştirme origin'i `http://localhost:5173` analiz Edge Function CORS listesinde bulunmadığından **403 / ORIGIN_DENIED** döndürdü. Auth redirect listesi ile analiz CORS listesi farklı ayarlardır. Parola kurtarmayı engellemez; analiz CORS ayarı değiştirilmedi.

## Değişen dosyalar

| Dosyalar | Amaç |
| --- | --- |
| `src/pages/ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx` | Türkçe e-posta ve yeni parola formları, yükleme/hata/başarı, göster/gizle, çıkışı tekrar deneme |
| `src/pages/LoginPage.tsx`, `src/App.tsx` | Şifremi Unuttum bağlantısı, iki public rota, başarılı kurtarma bildirimi |
| `src/services/passwordRecovery.ts` | PKCE callback doğrulaması, süreli recovery yetkisi, sunucu kullanıcı doğrulaması, parola kuralları, güvenli hata ve çıkış akışı |
| `src/services/recoveryStorage.ts` | Recovery oturumu bellekte; yalnız PKCE doğrulayıcıları ayrı kalıcı alanda |
| `src/auth/recoveryRuntime.ts` | İzole recovery SDK adaptörü ve SDK başlamadan URL temizliği |
| `src/auth/AuthContext.ts`, `AuthProvider.tsx`, `src/services/auth.ts` | Recovery durumunu sunma ve normal korumalı erişimden ayırma |
| `src/main.tsx` | Callback query/fragment bilgisini render ve Auth isteklerinden önce temizleme |
| `src/styles.css`, `vite.config.ts` | Mevcut form stili; geliştirme origin'ini tek yerde localhost:5173 ve strictPort ile sabitleme |
| `tests/passwordRecovery.test.ts`, `recoveryStorage.test.ts`, `auth.test.ts` | Kurtarma, depolama ve normal oturum bariyeri testleri |
| `docs/password-recovery.md` | Bu teknik rapor ve canlı kabul adımları |

Yeni npm bağımlılığı eklenmedi. Ana Supabase istemcisinin normal oturum saklama modeli korunuyor.

## Akış ve Supabase yöntemleri

1. `/sifremi-unuttum` e-postayı doğrular. `resetPasswordForEmail(email, {redirectTo})` ile aynı origin'deki `/parola-yenile` istenir. Başarılı yanıt, hesabın var olup olmadığını açıklamayan aynı Türkçe bildirimi üretir.
2. SDK `flowType: pkce` ile doğrulayıcı üretir. Kullanıcı e-postadaki bağlantıyı **isteği başlattığı aynı tarayıcı profili ve aynı origin** ile açmalıdır. `localhost` ile `127.0.0.1` birbirinin yerine kullanılamaz.
3. Callback yalnız tek bir PKCE `code` ve varsa SDK `sb_flow_id` bilgisini kabul eder. URL fragment tokenları, eksik/bozuk kodlar ve hata callback'leri reddedilir. Query ve fragment SDK çağrısından önce history replace ile temizlenir; kod/flow ID yalnız bellekte kalır.
4. `exchangeCodeForSession` sonucu `redirectType=recovery` olmalı ve aynı oturumla `PASSWORD_RECOVERY` olayı gelmelidir. `getUser` sunucu doğrulaması, kullanıcı kimliği ve oturum süresi ayrıca kontrol edilir. Normal oturum, URL'deki type parametresi veya `INITIAL_SESSION` yetki vermez.
5. Kurtarma yetkisi en fazla **10 dakika**, ayrıca SDK oturumunun kalan ömrü kadardır. Geçersiz callback, token/oturum değişikliği veya süre aşımı yetkiyi kaldırır. React StrictMode tek kullanımlık kodu iki kez tüketmez.
6. Eşleşen 8–128 karakter yeni parola `updateUser({password})` ile gönderilir. Parola alanları işlem sonunda temizlenir. Ham sağlayıcı hata mesajı veya secret çıktısı gösterilmez.
7. Başarıdan sonra yalnız kurtarma oturumu `signOut({scope: local})` ile kapatılır ve `/giris` üzerinde Türkçe başarı bildirimi gösterilir. Ağ hatasında parola değişmedi denmez; çıkış hatası ve yeniden deneme düğmesi gösterilir. SDK yerel belleği zaten temizlemişse tekrar deneme yalnız yakalanmış recovery tokenıyla SDK logout endpoint'ine gider; service role kullanılmaz.

## Oturumların ayrılması

Ana SDK normal Authentication oturumunu yönetir. Ayrı recovery SDK'sının benzersiz storage/channel kimliği vardır. SDK'nin özel storage adaptörünü kullanması için `persistSession=true` seçilir; adaptör **session/user kayıtlarını yalnız Map belleğinde** tutar. Sadece izin verilen SDK PKCE verifier/index anahtarları `akilli-atik-recovery-pkce` alanında localStorage'a yazılır. Recovery access/refresh tokenları diske veya normal oturum alanına kopyalanmaz.

Bu ayrım başka sekmede açılan normal hesabın parola güncellemesi ya da kurtarma çıkışı tarafından değiştirilmesini önler. Önceden açık sıradan oturum ve diğer cihaz oturumları topluca iptal edilmez. Callback ekranındaki normal hesap görünümü yeni normal girişe kadar bariyer arkasındadır. Recovery sayfası yenilenirse bellekteki yetki kaybolur; yeni bağlantı gerekir.

PKCE doğrulayıcısı da hassas kabul edilir ve raporlanmaz. XSS riskine karşı localStorage gizli bir kasa değildir; session tokenlarının recovery tarafında kalıcı tutulmaması bu riski azaltır.

## Test sonuçları

| Kontrol | Sonuç |
| --- | --- |
| TypeScript: frontend ve Edge | PASS |
| ESLint | PASS |
| Uygulama unit testleri | **86/86 PASS**: mevcut 57 + 21 recovery + 6 storage + 2 Auth bariyer testi |
| SQL/RLS | **88/88 PASS**, ağsız geçici PostgreSQL; fixture rollback ve konteyner temizliği doğrulandı |
| Recovery tarayıcı testleri | **40/40 PASS**, gerçek SDK ve yakalanmış test HTTP yanıtları; canlı entegrasyon testi değildir |
| Mevcut Auth tarayıcı regresyonu | **21/21 PASS**, gerçek SDK ve test yanıtları |
| Production build, Capacitor sync, Gradle/debug APK | PASS; son APK bilgisi aşağıda |
| Gerçek recovery e-postası, bağlantı, yeni parola ile giriş | **YAPILMADI — ayrı kullanıcı onayı bekliyor** |
| Android fiziksel cihaz, emülatör, deep link | **YAPILMADI**, bu görevde ertelendi |

Tarayıcı kontrolleri: geçerli/geçersiz e-posta, nötr bilinmeyen hesap yanıtı, kota hatası, eksik/fragment/normal oturum/expired/used callback reddi, URL temizliği, tek exchange, parola kuralı/tekrarı, görünürlük düğmesi, başarılı kayıt ve girişe yönlendirme. SDK'nin ilk logout HTTP 500 hatasında belleği temizlediği durum da test edildi: parola tekrar gönderilmeden yakalanmış recovery oturumuyla çıkış tekrarlandı ve giriş ekranına dönüldü. İki sekmeli kontrol normal B hesabının recovery A exchange/update/logout/reload işlemleri boyunca korunduğunu ve recovery tokenlarının localStorage'a yazılmadığını doğruladı. 390×844 mobil görünüm incelendi; runtime exception ve gerçek Supabase/Gemini çağrısı yoktu.

Kanıtlar Git dışında `report-qa/recovery-unit.log`, `recovery-db.log`, `recovery-apk.log`, `recovery-live-preflight.json`, `recovery-browser/results.json`, `auth-browser/results.json` altında. İlk Docker kontrolü sandbox erişimi nedeniyle çalışmadı; izinli tekrarında 88 kontrol geçti. İlk Edge kontrolünün 403 origin reddi yukarıda ayrıca kaydedildi.

Build uyarıları: Vite ana JS parçası 500 kB üzerinde; Gradle mevcut flatDir uyarısı veriyor. İkisi de derlemeyi başarısız kılmadı; sınırlar yükseltilerek uyarılar gizlenmedi.

Son APK: `C:\Users\gg\Desktop\Akilli-Atik\android\app\build\outputs\apk\debug\app-debug.apk`.

- Boyut: **9.896.425 bayt**.
- Gradle: **BUILD SUCCESSFUL**, son derleme 7 saniye.
- APK Signature Scheme **v2 doğrulandı**.
- APK içindeki `index-BJueYenF.js` ile son `dist` dosyasının SHA256 karşılaştırması eşleşti.
- APK SHA256: `61C6187426B1CE57845C501043F36DD8AFCBD4292603DB950F1672337DCC75B6`.

APK kurulumu ve cihazda çalışma test edilmedi; imza/build doğrulaması cihaz testi yerine geçmez.

## Android kapsamı

APK `com.akilliatik.app` ve mevcut Capacitor 8 yapılandırması korunuyor. Formlar mobil uyumlu; bu sürümde APK içinden recovery isteği başlatılmaz ve kullanıcı web akışına yönlendirilir. Geliştirme bilgisayarındaki localhost telefonun localhost'u değildir.

Android'e e-posta bağlantısıyla dönüş ayrı cihaz görevidir: sahip olunan HTTPS alan adı/Android App Links doğrulaması, manifest intent-filter, SDK/App `appUrlOpen` dinleyicisi, dar redirect allowlist ve isteği başlatan WebView'deki PKCE doğrulayıcısıyla güvenli callback eşleşmesi gerekir. Bu adımda rastgele deep link'ten token kabul edilmedi; native Auth/kamera davranışı değiştirilmedi.

## Canlı kabul için kullanıcı işlemleri

1. Yalnız hedef Supabase projesinde bir yeni parola kurtarma e-postası gönderimine açık onay ver.
2. `http://localhost:5173/sifremi-unuttum` formunu kendi tarayıcında aç. Onaydan sonra isteği aynı profilden başlat; e-postadaki bağlantıyı o profilde aç.
3. Yeni parolayı yalnız uygulama formuna gir. Parolayı, doğrulama kodunu ve tam kurtarma bağlantısını sohbete veya dosyaya gönderme.
4. Türkçe başarı bildirimi, yeni parola ile giriş, yanlış parola kontrolü, yenileme sonrası oturum, çıkış ve korumalı rota reddi canlı ortamda ayrıca doğrulansın.

Önceden paylaşılmış kurtarma bağlantısı kullanılmadı. Onaysız hesap silme, diğer oturumları iptal etme veya e-posta gönderimi yapılmadı. Eski bağlantı yeniden kullanılmamalıdır; toplu oturum iptali istenirse ayrıca onay gerekir. Canlı test tamamlanana kadar STEP 3.1 bütünüyle PASS değildir. STEP 4, migration, Edge deployment, Gemini çağrısı, commit/push ve haftalık Word raporu yapılmadı.
