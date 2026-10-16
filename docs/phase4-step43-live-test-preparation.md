# Phase 4 STEP 4.3 Gerçek analiz ve kalıcı kayıt testi hazırlığı

**Tarih:** 16 Ekim 2026. **Hedef:** yalnız Akilli-Atik / `nyoxbwandadakfagoner`.

**Yerel hazırlık ve testler PASS; canlı STEP 4.3 kabulü BLOCKED — onay ve güvenli kapatma doğrulaması bekliyor.** Bu adımda canlı ayar/deployment yapılmadı, analiz açılmadı, fotoğraf gönderilmedi ve kalıcı analiz kaydı oluşturulmadı.

## Güncel canlı ön kontroller

- Yerel link, Project URL ve CLI bağlantısı doğru projeyle eşleşiyor. Branch main; HEAD `f6b2915443483a85919e53fa0d18af31aaa69727`; önceki değişiklikler korundu.
- Canlı migration `20261015000100 / create_waste_analyses` tek kayıt. Dosya SHA256 `466A4B46A5249CBCC4FD2C056B386666BD19A639FA3D57B1C6C3B1DF90ED27C9` değişmemiş.
- Tablo 15 kolon, 12 geçerli kısıt, üç geçerli indeks ve iki sahiplik politikası içeriyor. RLS açık; anon erişimi, authenticated INSERT/UPDATE ve service_role UPDATE/DELETE kapalı. 24 etkin rol/yetki sonucu önceki sözleşmeyle aynı. Canlı analiz satırı **0**.
- `analyze-waste` **ACTIVE, sürüm 4, verify_jwt=true**. Yeni yerel süre koruması henüz bu sürümde yok.
- Kapalı HTTP kontrolü **503 / SERVICE_DISABLED**. CLI hash metadatası bilinen false özetiyle eşleşti; flag'in false kaldığı ayrıca doğrulandı. Secret değeri veya digest raporlanmadı. CLI bu metadata alanını `value` adıyla döndürüyor; eski `digest` alanı varsayımı düzeltilerek kontrol tekrar başarılı çalıştırıldı.
- Public Auth ayarları 200; mevcut e-posta doğrulaması korunuyor. Bu hazırlıkta gerçek kullanıcı girişi veya yeni hesap oluşturma yapılmadı; önceki STEP 4.2 oturum kanıtı bu adımda yeni yapılmış gibi sunulmuyor.

## CORS nedeni ve minimal düzeltme

Canlı ölçüm:

| Origin | OPTIONS |
| --- | --- |
| https://localhost | 204, izinli |
| http://localhost | 204, izinli |
| capacitor://localhost | 204, izinli |
| **http://localhost:5173** | **403, izin dışı** |
| http://127.0.0.1:5173 | 403, izin dışı |
| https://not-allowed.invalid | 403, izin dışı |

İzinli origin'lerde Authorization ve x-client-request-id başlıkları mevcut. Sorun uygulama isteğinin veya JWT'nin eksikliği değil, kesin origin eşleşmesidir. Vite localhost:5173 üzerinde strictPort ile çalışır; bu görev için 127.0.0.1 veya başka port izni gerekmiyor.

Hazırlanan tek değişiklik:

```dotenv
ALLOWED_ORIGINS=https://localhost,http://localhost,capacitor://localhost,http://localhost:5173
```

Yerel dosya: `report-qa/phase4-step43-cors.env`. Henüz uygulanmadı. Joker/subdomain aralığı, yeni frontend anahtarı, JWT veya RLS değişikliği yok. İzin, yalnız bu geliştirme origin'inden gelen tarayıcı isteğini kabul eder; Auth, test erişimi, fotoğraf/JSON kontrolleri ve limitler ayrıca zorunludur. CORS bir kullanıcı kimliği veya API dışı istemcileri engelleyen güvenlik sınırı değildir.

Onay sonrasında yalnız belirtilen projenin ALLOWED_ORIGINS secret'ı güncellenecek. Secret güncellemesi ayrıca deployment gerektirmeyebilir; Supabase yeni değerleri hemen kullanılabilir kıldığını belgeliyor. Ancak aşağıdaki yeni sunucu kodu için kapalı deployment gereklidir. [Supabase ortam değişkenleri](https://supabase.com/docs/guides/functions/secrets).

## Güvenli kapatma için yerel kod hazırlığı

Mevcut canlı sürümde süreli test kodu dolunca yeni istekler 403/TEST_ACCESS_REQUIRED alır. Bu mekanizma remote ANALYSIS_ENABLED secret'ını false yapmaz ve tek başına istenen 503 kapanışını sağlamaz. Ana sürecin finally bloğuna güvenmek de cihaz/ağ kesintisini kapsamaz.

Bu nedenle yalnız yerelde şu minimal koruma hazırlandı:

| Dosya | Hazırlanan değişiklik |
| --- | --- |
| `supabase/functions/analyze-waste/deadline.ts` | Yeni: mutlak UTC süre sonu; geçerli, gelecekte ve en fazla 10 dakikalık pencere zorunlu |
| `supabase/functions/analyze-waste/handler.ts` | Auth/okuma sonrasında, Gemini ve INSERT öncesinde süre yeniden denetimi; süre dolunca 503/SERVICE_DISABLED |
| `supabase/functions/analyze-waste/gemini.ts` | Sunucu süresi dolunca sağlayıcı isteğini iptal etme; dinleyici/zamanlayıcı temizliği |
| `tests/analysisDeadline.test.ts` | Yeni: 11 süre sonu/iptal/kayıt güvenlik testi |
| `tests/analysisHandler.test.ts` | Süresi dolmuş pencere beklentisi 403 yerine 503 olarak güncellendi |

Yeni secret veya bağımlılık eklenmedi. Mevcut ANALYSIS_TEST_EXPIRES_AT kullanılır; dış süre kapısı en fazla 10 dakika kabul eder. İç test-kodu doğrulaması, kullanıcı JWT doğrulaması, RLS ve limitler kaldırılmadı. Production varsayılanı gerçek Gemini fonksiyonudur; test enjeksiyonu yalnız izole testler içindir.

Sunucu süresi bitince, remote flag hâlâ true olsa bile yeni analiz kabul edilmez ve etkin kapalı cevap 503 olur. Devam eden Gemini HTTP isteği iptal edilir. Süre bitmeden gönderilmiş bir INSERT veritabanında tamamlanabilir; bu koruma o işlemi geri alamaz. Geç dönen başarı 503 ile sonlanabilir. Böyle bir durumda onaylı kullanıcının kendi request UUID'siyle salt okunur uzlaştırma yapılır; kayıt silinmez ve yokmuş gibi gösterilmez.

### Bağımsız kapatma aracı

`report-qa/phase4-step43-shutdown-watchdog.mjs` hazırlandı. Varsayılan mod **ağsız dry-run**; `--armed` bu adımda hiç çalıştırılmadı.

Onaylanan testte ana test sürecinden ayrı ve Windows'ta gizli süreç olarak, **etkinleştirmeden önce** başlatılması planlanır. Sabit proje, en fazla 10 dakikalık UTC son tarih, monotonik bekleme, erken durdurma işareti, sınırlı tekrar ve güvenli sonuç kaydı içerir. Yalnız ANALYSIS_ENABLED=false yazabilir; etkinleştirme veya Gemini çağrısı yapamaz. Sonuç ancak false metadata eşleşmesi **ve** gerçek 503/SERVICE_DISABLED birlikte doğrulanınca başarılıdır. CLI ham çıktısı/token/digest yazdırılmaz.

**Garanti sınırı:** Hiçbir yerel watchdog bilgisayar/ağ tamamen kaybolduğunda remote secret yazımını mutlak garanti edemez. Sunucudaki bağımsız süre kapısı etkin erişimin kapanması içindir; gerçek secret=false dönüşü ayrıca ölçülür. İki durum raporda karıştırılmayacak. Yeni koruma kapalı olarak deploy edilip, kapatma aracı kapalı ortamda sınanıp, bağımsız süreç/CLI erişimi doğrulanmadan canlı test başlatılmayacak. Bu ön koşullar sağlanmazsa test BLOCKED kalacak; kontrol gevşetilmeyecek.

## Fotoğraf, model ve kullanıcı izni

Bu test için fotoğraf henüz seçilmedi. Önceki aşamalardaki fotoğraf/gönderim onayı, bu yeni kalıcı kayıt testine taşınmadı.

Ayrı olarak gerekenler:

1. Fotoğrafın tam dosya yolu.
2. Bu fotoğrafın Supabase Edge Function üzerinden Google Gemini'ye gönderilme izni.
3. Doğrulanmış başarılı analiz metninin ilgili hesabın `waste_analyses` kaydında kalıcı tutulma izni. Fotoğraf veritabanına kaydedilmeyecek.
4. Önce kapalı CORS/süre koruması deployment onayı; ardından ayrıca ANALYSIS_ENABLED=true ve en fazla 10 dakikalık kontrollü test onayı.

Yerel varsayılan model `gemini-3.5-flash-lite`. Resmî Google dokümanında stable model, görüntü girdisi ve structured outputs desteği mevcut. Bu belge kontrolü gerçek API testi değildir; uzak model secret'ının değeri açılmadı. Kullanılan gerçek model daha sonra onaylı kaydın model alanından raporlanacak. [Google model belgesi](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite).

## Onay sonrası canlı test akışı

### A. Kapalı yapılandırma ve deployment

- Yalnız hedef projede tek CORS origin'i eklenir; ANALYSIS_ENABLED=false korunur.
- Süre koruması içeren analyze-waste deploy edilir; verify_jwt=true kalır.
- localhost:5173 OPTIONS 204 ve gerekli başlıklar; 127.0.0.1/yabancı origin reddi; gerçek SDK oturumuyla kapalı 503 ölçülür. Başka origin açılmaz.
- Kapatma aracının gerçek false yazma/metadata/503 prova akışı, servis zaten kapalıyken ayrı onay kapsamında sınanır. Bunun için Gemini, fotoğraf veya yeni analiz kaydı gerekmez.
- Yeni sürüm/koruma ve bağımsız süreç hazırlığı geçmeden etkinleştirme yapılmaz.

### B. Ayrı etkinleştirme, gönderim ve kalıcı kayıt onayı

- Onaylı fotoğraf uygulamanın mevcut fotoğraf servisiyle JPEG'e hazırlanır. Boyut/yapı kontrolleri korunur.
- Kullanıcı kendi parolasını yerel forma girer. SDK oturumu ve Auth getUser doğrulaması kullanılır; token chat/URL/log/dosyaya kopyalanmaz.
- Gerçek testin hemen öncesinde en fazla 10 dakikalık UTC deadline ve rastgele test erişim kodu hazırlanır. Kod yalnız güvenli bellek/Edge secrets ve geçici test ekranında kullanılır; raporlanmaz. Bu hazırlıkta kod oluşturulmadı.
- Bağımsız watchdog'un güncel PID, deadline ve hazır durumu doğrulanır. Ana test süreci de finally ile kapatmayı çalıştırır. Eski yerel işaretler veya hazır dosya tek başına canlılık kanıtı sayılmaz.
- Yalnız ayrıca onaylandıktan sonra ANALYSIS_ENABLED=true yapılır. İlk hata, onaylı deneme tamamlanması veya deadline'da kapatma başlar.

### C. Gerçek browser → Edge → Gemini → DB

- localhost:5173 tarayıcısı üretimdeki requestAnalysis/SDK akışını kullanır. Önceki mobil-origin loopback köprüsü bu gerçek web CORS testinin yerine geçmez.
- Tek fotoğraf/analiz niyeti için tek client_request_id UUID kullanılır. Normal akışta bir gerçek analiz ve aynı UUID ile bir sıralı tekrar planlanır; hata durumunda otomatik yeni Gemini denemesi yapılmaz.
- İlk yanıtta HTTP, JSON doğrulama, result.success ve persistence durumu **ayrı** kaydedilir. Sonuç kaydedilmediyse analiz başarıyla tamamlandı diye kayıt PASS verilmez.
- persistence.saved ve kayıt UUID'si elde edilirse yalnız bu UUID, giriş yapan kullanıcının SDK istemcisiyle okunur. user_id ile Auth doğrulanmış kullanıcı kimliği bellekte karşılaştırılır; sonuç alanları/model/schema_version karşılaştırılır.
- Aynı fotoğraf/UUID tekrarında duplicate, aynı kayıt ID'si ve özgün JSON beklenir. Kullanıcının kendi user/request filtreli sorgusunda satır sayısı bir olmalı. Bu tek satır kanıtıdır; sağlayıcının faturalandırma/istek sayısı ayrıca ölçülmeden raporlanmaz.
- Test kayıtları/kullanıcı silinmez. Kullanıcı onaylı kalıcı kayıt kalır; fotoğraf, base64, token ve ham Gemini yanıtı DB'ye yazılmaz.

### D. Hata, limit ve kapanış

- Eksik JWT testi, public key uyumluluk yoluyla handler'a ulaşabiliyorsa geçerli test koduyla 401 üretmeli. Bozuk bearer platformdan 401 almalı. Anonim tablo okuması permission-denied olmalı.
- Hız limiti 3/dakika korunur: eksik JWT handler'a ulaşırsa bir hakkı tüketir; başarı ve tekrar diğer iki hakkı tüketebilir. Ek kontroller sonraki kovaya bırakılır; limit yükseltilmez.
- Başarılı analiz/kayıt hatası senaryosu unit/mock testlerinde doğrulanır. Canlı DB yetkileri veya anahtarları bozularak hata enjekte edilmez. Gerçekte save failure oluşursa sonuç korunur, kayıt başarısız diye raporlanır ve test kapatılır.
- Test sonunda veya hatada hemen false yazımı istenir; watchdog ikinci yoldur. False metadata eşleşmesi ve 503/SERVICE_DISABLED ölçülür. Geçerli JWT'nin platformdan geçebildiği de ayrıca dikkate alınır; 401 kapanış kanıtı yerine kullanılamaz.

## Geçmiş okuma servisi ve test kapsamı

`src/pages/HistoryPage.tsx` halen hazırlık ekranıdır. Uygulamada analiz geçmişi listeleme/okuma servisi **henüz yok**. Bu nedenle mevcut bir geçmiş servisi doğrulandı denemez.

Bu adımda onaylı kaydın yalnız kullanıcı SDK'sıyla doğrudan okunması, RLS ve kalıcı kayıt doğrulaması olarak planlandı. Bu geçici QA okuması STEP 5 geçmiş arayüzü/servisi geliştirmesi değildir. Gerçek geçmiş servisinin kabul kriteri ayrıca açık kalır; STEP 5'e geçilmez.

Başka kullanıcıların satırlarına veya hesaplarına erişilmeyecek. İki kullanıcılı izolasyon ve kasıtlı DB hatası kanıtları yerel SQL/unit testleri olarak kalacak. Canlı yapılmayan senaryolar PASS sayılmayacak.

## Bu hazırlıkta çalıştırılan testler

| Kontrol | Sonuç |
| --- | --- |
| TypeScript | PASS |
| ESLint | PASS |
| Uygulama unit testleri | **173/173 PASS**; önceki 162 + yeni 11 süre güvenliği |
| Watchdog ağsız testleri | **4/4 PASS**; dry-run çalıştı, armed mod çalışmadı |
| İzole PostgreSQL/RLS | **104/104 PASS**; gerçek kullanıcı verisi yok |
| Production build | PASS |
| Capacitor sync | PASS |
| Android Gradle/debug APK | PASS, 157 görev, BUILD SUCCESSFUL |
| APK imzası | PASS, v2 |
| Gerçek Gemini / kalıcı kayıt | **YAPILMADI — izin bekliyor** |
| Gerçek Android/emülatör | YAPILMADI |

Önceki 189 tarayıcı sonucu STEP 4.2 kaydıdır; bu hazırlıkta yeniden çalıştırılmış gibi sunulmadı. Yerel önbellek/SDK kullanıldı; yeni bağımlılık, cihaz veya emülatör başlatılmadı.

APK: `C:\Users\gg\Desktop\Akilli-Atik\android\app\build\outputs\apk\debug\app-debug.apk`, **9.896.425 bayt**; SHA256 `D5524BC1B48E5B045174165E9A09F48F12020FC2E00DC46A3D3B6CAAE1AB9D66`. Mobil pakette frontend değişikliği olmadığı için aynı hash beklenir; build ve imza bu adımda yeniden doğrulandı.

Kanıtlar `report-qa/phase4-step43-{typecheck,lint,unit,db,android,signature}.log`, `phase4-step43-apk.json`, `phase4-step43-flag-check.json`; CORS/HTTP ölçümleri `phase4-step41-closed-after.json`. Yerel hazırlık dosyaları ve testler dışında canlı değişiklik yapılmadı.

## Onay bekleyen sonuç

İlk onay, yalnız **tek CORS origin ekleme + süre korumasını kapalı deploy etme + kapalı watchdog provası** içindir. Bu, gerçek analiz etkinleştirme onayı değildir.

Sonraki aşama ayrıca **fotoğraf yolu/gönderim/kalıcı saklama izinleri** ve **en fazla 10 dakikalık etkinleştirme onayı** gerektirir. Güvenli kapatma ön koşulları geçmeden test başlatılmaz. Canlı kayıt ID'si/analiz sonucu henüz yok; STEP 4.3 bütünüyle PASS değildir. Git commit/push, yeni migration, başka proje işlemi, STEP 5 ve haftalık Word raporu yapılmadı.
