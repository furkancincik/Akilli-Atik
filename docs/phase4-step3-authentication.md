# Phase 4 STEP 3 Authentication ve Oturum Yönetimi

## Kapsam ve tarih

Çalışma tarihi **15 Ekim 2026**; planlanan rapor dönemi **19–23 Ekim 2026**. Tek geliştiricili mevcut React/TypeScript/Capacitor mimarisi korundu. E-posta/parola Authentication, oturum takibi ve istemci rota koruması eklendi. Yeni npm bağımlılığı, backend, tablo, canlı migration veya Edge deployment eklenmedi. STEP 2 dosyaları ve önceden değiştirilmiş README korundu.

## Ön kontroller ve canlı ayarlar

Başlangıç branch'i `main`, HEAD `f6b2915443483a85919e53fa0d18af31aaa69727`. Çalışma ağacında STEP 2 değişiklikleri ve README satır sonu durumu vardı; geri alınmadı.

Yalnız `nyoxbwandadakfagoner` için public `GET /auth/v1/settings` salt okunur kontrol edildi: HTTP 200, e-posta girişi açık, kayıt açık, `mailer_autoconfirm=false`. **E-posta doğrulaması gereklidir.** Telefon girişi kapalıdır; bu özellik geliştirilmedi. SMTP, parolalar, anahtarlar ve kullanıcı satırları okunmadı. Dashboard ayarı değiştirilmedi. `analyze-waste` kontrolü HTTP **503 / SERVICE_DISABLED** döndürdü; analiz kapalı kaldı.

## Eklenen ve değiştirilen dosyalar

Yeni dosyalar:

- `src/services/auth.ts`: Türkçe doğrulama/hatalar, SDK adaptör sözleşmesi, oturum durum makinesi.
- `src/auth/AuthContext.ts`, `AuthProvider.tsx`, `useAuth.ts`: tek oturum sağlayıcısı ve yaşam döngüsü.
- `src/auth/RequireAuth.tsx`, `routeAccess.ts`: yükleniyor/bekle, izin ver veya girişe yönlendir.
- `tests/auth.test.ts`: 23 Auth unit testi.
- Bu teknik rapor.

Değişen dosyalar:

- `src/services/supabase.ts`: tek paylaşılan SDK istemcisi; kalıcılık ve otomatik yenileme.
- `src/main.tsx`, `src/App.tsx`: sağlayıcı ve hesap kimliğiyle ayrılmış ekran durumu.
- `src/pages/LoginPage.tsx`: kayıt/giriş formu, doğrulama tekrarı, yükleniyor ve bildirimler.
- `src/components/Layout.tsx`: oturum göstergesi, çıkış ve gerekirse cihaz oturumunu temizlemeyi tekrar deneme.
- `src/pages/HistoryPage.tsx`: Authentication sonrası durumu doğru anlatan hazırlık metni.
- `src/pages/ScanPage.tsx`: yalnız onaylı süreli testlerde analiz açıldığını belirten statik metin; HTTP akışı değişmedi.
- `src/hooks/usePhotoCapture.ts`: hesap değişiminden sonra geç tamamlanan fotoğraf işleminin eski bellek/blob URL'si oluşturmasını önleme.
- `src/styles.css`: kayıt sekmeleri, parola alanları, bildirim ve çıkış düğmesi.
- `android/app/src/main/AndroidManifest.xml`: `allowBackup=false`.

Mevcut `src/services/analysis.ts`, analiz hook'u, Edge Function kodu ve STEP 2 migration/test dosyaları bu adımda değiştirilmedi. `package.json` içindeki önceki `test:db` değişikliği STEP 2'ye aittir.

## Authentication mimarisi

Tek paylaşılan `@supabase/supabase-js` istemcisi SDK oturumunu yönetir. UI yalnız durum, kullanıcı bilgisi ve işlem metotlarını context üzerinden alır; tokenlar kullanıcı arayüzüne/log'a yazılmaz. `AuthPort` gerçek SDK ile yapısal uyumludur; unit testlerde aynı sözleşmenin fake adaptörü kullanılır.

Controller önce `onAuthStateChange` dinleyicisini kurar, sonra `getSession` ile başlangıç oturumunu yükler. Eski başlangıç/resume yanıtları yeni giriş/çıkış olaylarını geri alamaz. Callback içinde await edilen SDK çağrısı yoktur. Süresi dolmuş oturum kabul edilmez; yenileme gelmese de süre dolum zamanlayıcısı erişimi kapatır. Aynı kullanıcı için `TOKEN_REFRESHED` fotoğrafı veya ekran durumunu sıfırlamaz.

Kimlik değişiminde `AccountRoutes` yeniden oluşturulur. Fotoğraf/blob URL'si, analiz sonucu, devam eden analiz isteği, test kodu ve form alanları eski kullanıcı ekranından ayrılır. Normal sayfa geçişinde fotoğraf korunur. Henüz veritabanı geçmişi veya ayrı kullanıcı cache'i yoktur.

## Kayıt giriş ve çıkış

- Kayıt: zorunlu alanlar, trim edilmiş geçerli e-posta (en fazla 254 karakter), 8–128 karakter parola ve eşleşen parola tekrarı. Parolanın içeriği trim edilerek değiştirilmez; yalnız boşluklardan oluşan parola reddedilir.
- Giriş: mevcut hesap parolalarına yeni kayıt minimumu zorlanmaz. Sunucu hataları güvenli Türkçe kodlara eşlenir; ham provider mesajı kullanıcıya gösterilmez.
- `signUp` session döndürmezse doğrulama bekleme bildirimi gösterilir; oturum açılmış gibi davranılmaz. Gizlenmiş mevcut kullanıcı davranışları da aynı genel bildirimle ele alınır.
- Başarılı giriş ana sayfaya yönlendirir. Gönderim sırasında kontroller kilitlenir; işlem sonunda parola alanları temizlenir.
- Çıkış `signOut({scope:'local'})` ile yapılır; diğer cihazların oturumları bilinçsizce kapatılmaz. Önce mevcut UI durumu temizlenir, korumalı erişim kapanır.
- Ağ/SDK hatasında kalıcı oturumun silindiği iddia edilmez. Açık Türkçe uyarı ve yeniden temizleme düğmesi gösterilir. Bu durumda uygulama yeniden başlatılırsa SDK'daki kayıt tekrar yüklenebilir; başarılı çıkış doğrulaması gereklidir. Yeni girişe kadar geç SDK olayları arayüzü yeniden yetkilendiremez.

## Sayfa erişimi

| Sayfa | Erişim |
| --- | --- |
| Ana sayfa | Herkese açık |
| Kullanıcı girişi/kayıt | Oturumsuz kullanıcı; giriş yapan ana sayfaya yönlenir |
| Atık tarama | Giriş gerekli; eski Gemini HTTP sözleşmesi korunur |
| Analiz geçmişi | Giriş gerekli; kayıt entegrasyonu henüz yok, hazırlık ekranı |
| İstatistikler | Giriş gerekli; sahte veri/grafik yok |

Başlangıç yüklemesinde korumalı içerik gösterilmez. **İstemci rota koruması sunucu yetkilendirmesi değildir.** STEP 4'te sunucu JWT'yi ayrıca doğrulamalıdır. Şu anki analiz endpoint'ine kullanıcı JWT'si eklenmedi; public key, kapalı servis ve süreli kod kontrolleri olduğu gibi kaldı.

## Oturum saklama ve mobil uyumluluk

`persistSession=true`, `autoRefreshToken=true`. SDK kendi localStorage kaydını kullanır; uygulama tokenları başka localStorage anahtarına, Capacitor Preferences'a veya dosyaya kopyalamaz. Tarayıcı ve Android WebView açılışında SDK bu kaydı yükler.

Bu yaklaşım basittir ancak **localStorage JavaScript tarafından okunabilir; Keystore ile şifreli depolama değildir**. XSS, ele geçirilmiş/root cihaz veya geliştirme erişimi tokenları açığa çıkarabilir. `allowBackup=false` Android yedek riskini azaltır; şifreleme veya tüm üreticilerin cihaz aktarımı karşısında mutlak koruma iddiası değildir.

Tarayıcı görünürlük olayları ve Capacitor `App.getState` / `appStateChange` olaylarıyla SDK yenilemesi açıkça durdurulur/başlatılır. İlk görünürlük durumu da uygulanır; dönüşte oturum tekrar uzlaştırılır. Dinleyiciler ve zamanlayıcılar temizlenir.

`detectSessionInUrl=false`, `flowType='pkce'`. Rastgele URL fragment'inden oturum kurulmaz. Mevcut akış: kullanıcı e-postadaki resmi doğrulama bağlantısını tarayıcıda açar, ardından uygulamaya dönerek parola ile giriş yapar. Otomatik tarayıcıdan APK'ya oturum aktarımı bu adımda yoktur. Gelecekte bu deneyim istenirse tam redirect allowlist, doğrulanmış app link/deep link, manifest ve PKCE callback değişiklikleri ayrıca tasarlanmalı ve Dashboard değişikliği onaylanmalıdır.

Canlı Site URL/redirect allowlist ve gerçek e-posta teslimi bu adımda doğrulanmadı; bunlar canlı kabulün açık maddeleridir. E-posta doğrulaması kapatılmadı veya atlatılmadı.

## Test sonuçları

| Kontrol | Sonuç ve kapsam |
| --- | --- |
| TypeScript | PASS, frontend ve Edge kontrolleri |
| ESLint | PASS |
| Unit testler | **57/57 PASS**; önceki 34 + yeni 23 Auth testi |
| SQL/RLS | **88/88 PASS**, ağsız geçici PostgreSQL 17.11; canlıya migration yok |
| Tarayıcı | **21/21 PASS**, Edge/Playwright ile mock HTTP yanıtları |
| Production build / Capacitor sync | PASS, android:apk içinde |
| Android Gradle / debug APK | PASS; son dosya ve imza bilgisi aşağıda |
| Gerçek Supabase Auth uçtan uca | YAPILMADI |
| Fiziksel Android/emülatör Auth ve kamera testleri | YAPILMADI; bağlı cihaz yok |

Unit kapsamı: kayıt doğrulaması, hatalı parola, doğrulama bekleme, başarılı giriş, geri yükleme, eski bootstrap/event yarışları, token yenileme/süre dolumu, çıkış hatası/başarısı, kullanıcı değişimi ve rota erişimi. Browser testleri gerçek SDK üzerinde HTTP fixture'larıyla kayıt/giriş hatalarını, confirmation bildirimini, reload sonrası kalıcılığı, refresh'i, aynı kullanıcıda fotoğrafın korunmasını, çıkış ve ikinci hesapta fotoğraf/kod temizliğini doğruladı. 390×844 görünümde yatay taşma ve runtime exception yoktu.

Browser testleri bütün Supabase isteklerini yakaladı: **gerçek Supabase Auth/Gemini isteği 0**. Sentetik hesaplar, parolalar ve tokenlar yalnız Git dışında `report-qa/` fixture'larıdır; gerçek kullanıcı oluşturulmadı/değiştirilmedi. Unit fixture'ları açıkça test amaçlıdır. SQL testlerinde yalnız rollback edilen yerel sentetik kullanıcılar kullanıldı.

Yerel kanıtlar: `report-qa/phase4-step3-unit-test.log`, `phase4-step3-db-test.log`, `phase4-step3-apk.log` ve `report-qa/auth-browser/results.json`. Bunlar Git'e eklenmez.

## Kalan canlı kabul ve STEP 4

1. Ayrı izinle ayrılmış gerçek test hesabında e-posta teslimi, doğrulama ve giriş/çıkışın doğrulanması.
2. Web Site URL/redirect davranışının kontrolü; gerekiyorsa Dashboard değişikliği için onay.
3. Android cihazda kapat/aç, arka plan/ön plan, token yenileme, ağ kesintisi ve çıkış temizleme testleri.
4. STEP 4 onayından sonra kullanıcı JWT'sinin Edge'de doğrulanması ve güvenilir kayıt akışının tasarlanması. Mevcut test kodu koruması kaldırılmaz.
5. Canlı migration ve Edge deployment için ayrı açık onay. Bu adımda ikisi de yapılmadı.

**STEP 3 kod/yerel test kapsamı PASS; canlı Supabase Auth ve Android kabulü bekliyor.** Phase 3.1 fiziksel cihaz açığı kapanmış sayılmaz. STEP 4, Phase 5, commit/push veya haftalık Word raporu başlatılmadı. `ANALYSIS_ENABLED=false` korundu; Gemini çağrısı yapılmadı.

## Resmî dayanaklar

- [Supabase Auth istemcisi ve kalıcılık](https://supabase.com/docs/reference/javascript/auth)
- [Otomatik yenileme yaşam döngüsü](https://supabase.com/docs/reference/javascript/auth-startautorefresh)
- [Yerel kapsamlı çıkış](https://supabase.com/docs/guides/auth/signout)
- [Redirect yapılandırması](https://supabase.com/docs/guides/auth/redirect-urls)

## Güncel APK ve build notları

APK: `android/app/build/outputs/apk/debug/app-debug.apk` — **9.896.425 bayt**. Son derleme `BUILD SUCCESSFUL`; v2 APK imzası doğrulandı. Paket içindeki `index-MN9yZBeY.js` dosyasında yeni Authentication arayüzü ve oturum süresi mesajları bulundu; eski APK yalnızca yeniden adlandırılmadı.

```text
SHA256: 2CDE8A1F1EE3161002F7E99D2903E5429C3EDEEF2C422BE6502881432FFC0371
```

Vite, Authentication SDK'sıyla ana JS parçasının 533,71 kB'a ulaşması nedeniyle 500 kB chunk uyarısı verdi; build başarısızlığı değildir. Kod bölme ileride performans için değerlendirilebilir; uyarıyı gizlemek için limit yükseltilmedi. Gradle'ın mevcut flatDir uyarısı da derlemeyi engellemedi. Capacitor sync sonrasında üretilen Gradle dosyaları Git'te satır sonu durumu gösterebilir; metinsel diff'te ek bağımlılık değişikliği yoktur.
