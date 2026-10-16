# Phase 4 STEP 4.2 Canlı migration ve kapalı deployment

**Tarih:** 16 Ekim 2026. **Proje:** Akilli-Atik. **Project Ref:** `nyoxbwandadakfagoner`.

**STEP 4.2 onaylanan canlı migration ve kapalı deployment kapsamı PASS.** Geçerli SDK kullanıcı oturumuyla kapalı API kontrolü de tamamlandı. Analiz servisi kapalı kaldı. Gerçek Gemini çağrısı veya analiz kaydı oluşturulmadı; açık analiz/kalıcı kayıt kabulü sonraki ayrı onaya aittir.

## Ön kontrol ve uygulama kapsamı

- Yerel link/ref ve Project URL doğrulandı. Yalnız `nyoxbwandadakfagoner` kullanıldı.
- Branch `main`, HEAD `f6b2915443483a85919e53fa0d18af31aaa69727`; önceki çalışma ağacı değişiklikleri korundu.
- Canlı PostgreSQL 17.11 üzerinde READ ONLY envanter tekrar alındı. Başlangıçta public ilişki/fonksiyon/politika, waste_analyses tablosu ve migration geçmişi yoktu; beklenmeyen nesne bulunmadı.
- Migration dosyası değişmemişti: `20261015000100_create_waste_analyses.sql`, SHA256 `466A4B46A5249CBCC4FD2C056B386666BD19A639FA3D57B1C6C3B1DF90ED27C9`.
- Kapalı servis kontrolü uygulama öncesinde 503/SERVICE_DISABLED döndü. Secret değerleri yazdırılmadı ve set/unset yapılmadı.

## Canlı migration sonucu

Supabase CLI **2.120.0** ile önce `db push --linked --project-ref nyoxbwandadakfagoner --skip-vault --dry-run` çalıştırıldı. Plan yalnız tek onaylı dosyayı gösterdi; seed ve rol listeleri boştu.

Ardından aynı hedef ve `--skip-vault` ile gerçek `db push` çalıştırıldı: **exit 0, Finished supabase db push**. Seed, rol, Vault güncellemesi, reset, repair veya veri silme yapılmadı. CLI migration geçmişi oluşturuldu.

Yalnız `public.waste_analyses` tablosu ve migration'ın öngördüğü nesneler oluşturuldu:

- **15 kolon:** id, user_id, client_request_id, created_at, waste_name, category, description, sorting_instruction, recycling_advice, safety_warning, object_count, uncertain, hazardous, model, schema_version.
- **12 geçerli kısıt:** primary key; auth.users(id) foreign key / ON DELETE CASCADE; kullanıcı/istek unique; kategori, object_count, schema_version ve altı metin CHECK'i.
- **Üç geçerli/hazır indeks:** primary key, kullanıcı/istek unique, `(user_id,created_at DESC,id DESC)` listeleme indeksi.
- **İki politika:** waste_analyses_select_own ve waste_analyses_delete_own.
- Tablo sahibi postgres; RLS açık. FORCE RLS kapalı; kullanıcı rolleri tablo sahibi değil.
- Özel kullanıcı trigger'ı yok. Canlı analiz satır sayısı **0**.
- Migration geçmişinde yalnız **20261015000100 / create_waste_analyses** var.

Kolon türleri, uzunluklar, NOT NULL ve UUID/tarih/schema_version default'ları dosyayla eşleşti. Tüm kısıtlar validated, indeksler valid/ready. Kataloglar ve etkin yetkiler salt okunur doğrulandı. CLI çoklu sorguda yalnız son SELECT sonucunu gösterdiğinden, tüm katalog sonuçları tek JSON SELECT'te ayrıca alındı; bu bir migration hatası değildir.

## Canlı RLS ve etkin yetkiler

| Rol | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| anon | Kapalı | Kapalı | Kapalı | Kapalı |
| authenticated | Kendi satırları, RLS | Kapalı | Kapalı | Kendi satırları, RLS |
| service_role | Açık | Açık | Kapalı | Kapalı |

Her üç rol için TRUNCATE, REFERENCES, TRIGGER ve MAINTAIN de kapalıdır. **24 etkin rol/yetki sonucu** beklentiyle eşleşti. Tablo ACL'sinde istemciye ek grant veya grant option yok. İki authenticated politika `((SELECT auth.uid())=user_id)` koşulunu kullanıyor. Anonim/PUBLIC politikası veya istemci INSERT/UPDATE politikası yok.

Ek gerçek HTTP kontrolü: public key ile anonim `GET /rest/v1/waste_analyses?select=id&limit=1` → **401 / PostgreSQL 42501 permission denied**. Veri dönmedi, yazma yapılmadı. İki gerçek canlı kullanıcıyla satır oluşturup izolasyon testi yapılmadı; bu senaryo yalnız izole yerel PostgreSQL'de sentetik kullanıcılarla doğrulandı.

Service role RLS'yi atlar. Anahtar yalnız Edge ortamındadır; kayıt adaptörünün iki UUID ile filtre, sabit alan listesi ve yalnız SELECT/INSERT erişimi korunur. JWT'den doğrulanmış kullanıcı dışındaki bir sahiplik girdisi kullanılmaz. Gerçek güvenilir INSERT ve kalıcı kayıt akışı bu kapalı testin kapsamında değildir.

## Edge Function deployment

Migration doğrulandıktan sonra yalnız şu fonksiyon API bundling yöntemiyle deploy edildi:

```powershell
supabase functions deploy analyze-waste --project-ref nyoxbwandadakfagoner --use-api
```

Deployment **exit 0**. Fonksiyon adı açıkça belirtildi; başka fonksiyon deploy edilmedi. `--prune` veya `--no-verify-jwt` kullanılmadı.

| Metadata | Sonuç |
| --- | --- |
| Fonksiyon | analyze-waste |
| Durum | **ACTIVE** |
| Önceki/yeni sürüm | **3 → 4** |
| verify_jwt | **false → true** |
| Deployment paketi SHA256 | `93d2332c24a01645b0a3a7c3a0a6a3bbc7b0fff475b66ab2b664447e3c39bfaa` |

Güncel handler, authentication, storage, Gemini, testAccess ve ortak JSON/görsel doğrulama modülleri deploy paketine dahil edildi. Gemini anahtarı, CORS secret'ı, test kodu veya analiz flag'i değiştirilmedi. Supabase Auth `/user` doğrulaması ve sunucuda sahiplik belirleme kodu korundu.

## Gerçek CORS ve HTTP kontrolleri

POST istekleri boş JPEG gövdesiyle yapıldı; gerçek fotoğraf ve test erişim kodu kullanılmadı.

| Senaryo | Gerçek sonuç |
| --- | --- |
| https://localhost OPTIONS | 204, doğru allow-origin |
| http://localhost OPTIONS | 204, doğru allow-origin |
| capacitor://localhost OPTIONS | 204, doğru allow-origin |
| İzinli origin'lerde yeni JWT/UUID başlıkları | Authorization ve x-client-request-id izinleri mevcut |
| localhost:5173 / 127.0.0.1:5173 OPTIONS | 403; mevcut CORS sınırı korundu |
| Yabancı origin OPTIONS | 403 |
| Public anahtar ve JWT yok | **401**, platform reddi |
| Yanlış public anahtar, JWT yok | **401**, platform reddi |
| Doğru public anahtar, JWT yok | **503 / SERVICE_DISABLED** |
| Doğru public anahtar, bozuk bearer | **401**, platform reddi |
| Doğru public anahtar, yasak origin | **403 / ORIGIN_DENIED** |
| Doğru public anahtar, geçerli kullanıcı SDK JWT'si | **503 / SERVICE_DISABLED**, izinli mobil origin |
| Geçerli kullanıcı JWT'si, yanlış public anahtar | **403 / UNAUTHORIZED** |
| Geçerli kullanıcı JWT'si, yasak origin | **403 / ORIGIN_DENIED**, allow-origin yok |

Hiçbir yanıt analiz veya kayıt başarısı payload'ı içermedi. Kapalı davranış doğrulandı; **ANALYSIS_ENABLED=false durumu korundu**. Public anahtar tek başına kullanıcı kimliği olarak kabul edilmez. API key uyumluluk yolu kapalı handler'a ulaşabilir, fakat kullanıcı adına analiz/kayıt yapamaz.

**503 tek başına JWT doğrulama kanıtı değildir.** Handler servis kapalı kontrolünü kendi Auth çağrısından önce yapar. Bozuk bearer'ın gerçek 401 alması platform reddini kanıtlar; gerçek kullanıcı tokenının kabul edildiğini veya uygulama Auth yolunun çalıştığını tek başına kanıtlamaz. Bu katman ayrımı korunur; herhangi bir kontrol kapatılmadı.

Kullanıcı mevcut test hesabıyla yerel uygulamada kendisi giriş yaptı; panelde oturum açık durumu doğrulandı. Parola/token sohbetten istenmedi. Tarayıcının mevcut Supabase SDK oturumu, tek kullanımlık yerel QA sayfasında bellekte kullanıldı. Loopback'e bağlı, yalnız localhost:5173 origin'ini kabul eden ve işlem sonunda kapanan yerel API test aracı üzerinden yalnız hedef Supabase projesine iletildi. Token URL, DOM, konsol, rapor veya dosyaya yazılmadı; SDK'nın mevcut oturum deposu dışında kalıcılaştırılmadı.

Önce gerçek **GET /auth/v1/user → 200** ile tokenın geçerliliği doğrulandı. Ardından aynı tokenla izinli mobil origin `https://localhost` için kapalı fonksiyon → **503/SERVICE_DISABLED**; yanlış public key → **403/UNAUTHORIZED**; yasak origin → **403/ORIGIN_DENIED** ölçüldü. Güvenli durum sonuçları `report-qa/phase4-step42-session-probe-result.json` dosyasına kaydedildi; yerel araç exit 0 ile kapandı. Fotoğraf/test kodu gönderilmedi, hesap veya analiz verisi değiştirilmedi.

Bu sonuç **gerçek SDK tokenı ile HTTP API/mobil-origin uyumluluğu** kanıtıdır. CORS'ta değişiklik yapılmadı: yerel web origin'leri hâlâ izin dışıdır. Gerçek web analiz akışı veya Android cihaz testi yapılmış sayılmaz. Fonksiyonun uygulama katmanı Auth yolu kapalı kapıdan sonra olduğundan, gerçek etkin analizdeki JWT sahipliği/kalıcı kayıt akışı sonraki onaylı testte ayrıca doğrulanmalıdır.

## Yeniden çalıştırılan regresyonlar

| Kontrol | Yeni sonuç |
| --- | --- |
| TypeScript | PASS, exit 0 |
| ESLint | PASS, exit 0 |
| Unit testler | **162/162 PASS**, skipped/fail 0; Auth/kurtarma/JWT/kayıt testleri dahil |
| İzole PostgreSQL/RLS | **104/104 PASS**; 88 temel + 16 kayıt sözleşmesi |
| Authentication tarayıcı | **21/21 PASS** |
| UX tarayıcı | **47/47 PASS** |
| Animasyon tarayıcı | **34/34 PASS** |
| Parola kurtarma tarayıcı | **40/40 PASS** |
| Kurtarma istek/429 tarayıcı | **29/29 PASS** |
| Analiz istemcisi tarayıcı | **18/18 PASS** |
| Production build | PASS |
| Capacitor sync | PASS |
| Android Gradle/debug APK | PASS, BUILD SUCCESSFUL; 157 görev |
| Debug APK imzası | PASS, APK Signature Scheme v2 |

Tarayıcı toplamı **189/189**; önceki 168'e ayrıca 21 Authentication kontrolü dahil edildi. Tarayıcı Auth/servis yanıtları mock edildi veya uzak istekler engellendi; bu sonuçlar gerçek Supabase/Gemini uçtan uca testi değildir. Gerçek e-posta gönderilmedi.

SQL testleri ağsız ve geçici PostgreSQL konteynerinde çalıştı. Sentetik veriler ROLLBACK ile geri alındı, boşluk kontrolü yapıldı ve konteyner kaldırıldı. Canlı kullanıcı verisi bu testlerde kullanılmadı.

Derlemedeki mevcut >500 kB chunk ve Gradle flatDir uyarıları derlemeyi durdurmadı. Yeni bağımlılık veya SDK kurulmadı. Android Studio/emülatör/cihaz testi başlatılmadı.

## APK

- Konum: `C:\Users\gg\Desktop\Akilli-Atik\android\app\build\outputs\apk\debug\app-debug.apk`
- Boyut: **9.896.425 bayt**.
- SHA256: `D5524BC1B48E5B045174165E9A09F48F12020FC2E00DC46A3D3B6CAAE1AB9D66`.
- Kaynak kod değişmediği için önceki doğrulanan APK ile aynı hash elde edilmesi beklenen sonuçtur; derleme ve imza kontrolü bu adımda gerçekten yeniden çalıştırıldı.

## Kanıtlar ve kalan işlemler

Git dışında yerel kanıtlar: `report-qa/phase4-step42-live-schema.json`, `phase4-step42-anonymous-rest.json`, `phase4-step41-closed-after.json`, `phase4-step42-session-probe-result.json`, `phase4-step42-browser-summary.json`, `phase4-step42-{typecheck,lint,unit,db}.log`, `phase4-step42-android.log`, `phase4-step42-signature.log`, `phase4-step42-apk.json`.

Uygulama kaynakları ve onaylı migration dosyası değiştirilmedi; yalnız teknik rapor ve yerel kontrol/kanıt dosyaları eklendi. Git commit/push yapılmadı.

**STEP 4.2 sonucu PASS:** Migration, canlı RLS/yetkiler, kapalı deployment, platform JWT reddi, geçerli SDK tokenı/kapalı servis ve istenen regresyonlar doğrulandı. Beklenmeyen migration, onarım veya güvenlik kontrolü gevşetme yapılmadı.

**Sonraki ayrı onay:** Gerçek fotoğrafın Gemini'ye gönderilmesi, en fazla 15 dakikalık erişim, kontrollü etkinleştirme ve kalıcı kayıt/tekrar/kullanıcı izolasyonu testi. Bu adımda analizler açılmadı, test kodu oluşturulmadı, yeni analiz satırı yazılmadı. STEP 5'e geçilmedi ve haftalık Word raporu hazırlanmadı.
