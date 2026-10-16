# Phase 4 / STEP 4.3 — Kapalı deployment ve güvenli kapatma doğrulaması

**Tarih:** 16 Ekim 2026 (Europe/Istanbul). **Proje:** Akilli-Atik / `nyoxbwandadakfagoner`.

**Onaylanan kapalı deployment kapsamı: PASS.** Gerçek Gemini analizi ve kalıcı kayıt kabulü bu işlemlerin kapsamında değildir; **STEP 4.3 canlı analiz kabulü henüz tamamlanmadı**. Analiz etkinleştirilmedi, fotoğraf gönderilmedi ve analiz kaydı oluşturulmadı.

## 1. Hedef proje ve son durum

| Kontrol | Doğrulanan durum |
| --- | --- |
| Yerel Supabase link / Project Ref | `nyoxbwandadakfagoner` |
| Project URL | `https://nyoxbwandadakfagoner.supabase.co` |
| Git | `main`, HEAD `f6b2915443483a85919e53fa0d18af31aaa69727`; önceki değişiklikler korundu |
| Edge Function | `analyze-waste`, **ACTIVE, sürüm 8** |
| Platform JWT ayarı | **verify_jwt=true** |
| Analiz anahtarı | **ANALYSIS_ENABLED=false**; son metadata karşılaştırması ve kapalı HTTP yanıtı doğrulandı |
| Canlı tablo | `public.waste_analyses`, **0 satır**; salt okunur katalog kontrolü |
| Migration | `20261015000100 / create_waste_analyses`; yeni migration uygulanmadı |

Son salt okunur fonksiyon ve yapılandırma kontrolü 16 Ekim 2026 yaklaşık 02:19 TRT'de alındı; ardından 02:21 TRT'de son kapalı HTTP kontrolü yapıldı. Secret listesi yalnız bellekte işlendi; değerler veya özetleri rapora/terminal çıktısına yazılmadı. `false` ve beklenen kesin CORS dizgesinin SHA256 metadatasıyla eşleşmesi yalnız boolean olarak kaydedildi.

Canlı tablo envanterinde 15 kolon, 12 kısıt, üç indeks ve iki sahiplik politikası korundu. RLS açık; anon tablo erişimi kapalı, authenticated yalnız SELECT/DELETE, service_role yalnız SELECT/INSERT yetkisine sahip. Gerçek kullanıcı verisi okunmadı; katalog bilgileri ve toplam satır sayısı incelendi. Başka Supabase projesinde işlem yapılmadı.

## 2. Uygulanan sınırlı değişiklikler

`ALLOWED_ORIGINS` izin listesine yalnız `http://localhost:5173` eklendi. Son izin listesi:

```text
https://localhost
http://localhost
capacitor://localhost
http://localhost:5173
```

Mobil origin'ler korundu. Joker, `127.0.0.1`, başka port veya yabancı site eklenmedi. Public anahtar değiştirilmedi. CORS, kullanıcı kimliği veya API istemcileri için tek başına yetkilendirme mekanizması olarak değerlendirilmedi.

Önceden hazırlanan sunucu süre koruması içeren güncel kaynaklar yalnız hedef projeye deploy edildi:

```powershell
npm exec --offline --yes --package supabase@2.120.0 -- supabase functions deploy analyze-waste --project-ref nyoxbwandadakfagoner --use-api
```

JWT kontrolünü kapatan seçenek kullanılmadı. CORS güncellemesi, kod deployment'ı ve iki kapatma provasındaki `false` secret yazımları sonrasında fonksiyonun sürümü 8 oldu. Ara sürüm 6 kod deployment'ı sonrasında, sürüm 7 ilk kapatma provası sonrasında gözlendi; son sürüm ayrıca yeniden sorgulandı.

Deployment'a dahil olan temel süre değişiklikleri:

| Dosya | Görevi |
| --- | --- |
| `supabase/functions/analyze-waste/deadline.ts` | Mutlak sunucu son tarihini ve en fazla 10 dakikalık pencereyi denetler; iptal sinyali sağlar |
| `supabase/functions/analyze-waste/handler.ts` | Auth/okuma sonrasında, Gemini ve INSERT öncesinde ve sonuç dönüşlerinde süreyi yeniden denetler |
| `supabase/functions/analyze-waste/gemini.ts` | Süre dolduğunda sağlayıcı isteğinin iptalini ve dinleyici temizliğini destekler |
| `tests/analysisDeadline.test.ts` | 11 süre/iptal/kayıt güvenliği senaryosu |
| `tests/analysisHandler.test.ts` | Süresi dolmuş test penceresinin 503 beklentisi |

Mevcut test kodu koruması, JWT üzerinden kullanıcı doğrulaması, görüntü/JSON doğrulama ve istek sınırları korundu. Yeni test kodu veya yeni test penceresi oluşturulmadı. Hız sınırları isolate başınadır; dağıtık ve kalıcı kota garantisi değildir.

## 3. Gerçek HTTP ve tarayıcı sonuçları

Kontroller boş istek gövdesiyle yapıldı; fotoğraf veya geçerli test erişim kodu gönderilmedi.

| Gerçek istek | Yanıt | Değerlendirme |
| --- | --- | --- |
| Üç mevcut mobil origin, OPTIONS | **204** | Kesin origin ve gerekli Authorization/request-id başlıkları izinli |
| `http://localhost:5173`, OPTIONS | **204** | Yeni origin izinli; wildcard yok |
| `http://127.0.0.1:5173`, OPTIONS | **403** | İzin dışında, allow-origin yok |
| Yabancı origin, OPTIONS | **403** | İzin dışında, allow-origin yok |
| Yabancı origin, POST | **403 / ORIGIN_DENIED** | Uygulama katmanında reddedildi |
| Kimlik bilgisi olmadan POST | **401** | Gateway reddi |
| Yanlış public anahtar, JWT olmadan | **401** | Gateway reddi |
| Doğru public anahtar ve bozuk JWT | **401** | Gateway reddi |
| Doğru public anahtar, kullanıcı JWT'si olmadan | **503 / SERVICE_DISABLED** | Publishable anahtar uyumluluk yolu kapalı handler'a ulaşabiliyor; kullanıcı yetkilendirmesi kanıtı değildir |
| Geçerli SDK oturumu ve doğru public anahtar | **503 / SERVICE_DISABLED** | Gerçek localhost tarayıcısından kapalı servis doğrulandı |
| Geçerli SDK oturumu ve yanlış public anahtar | **403 / UNAUTHORIZED** | Handler public anahtar denetimi korundu |

Gerçek tarayıcı `http://localhost:5173` üzerinden doğrudan Supabase'e istek gönderdi; başka origin kullanan ara köprü kullanılmadı. Önce uygulamanın SDK istemcisiyle oturum yüklendi ve `getUser` doğrulaması başarılı oldu. JWT, parola ve kullanıcı nesnesi çıktı, dosya veya URL'ye aktarılmadı. Yeni hesap veya e-posta isteği oluşturulmadı.

**JWT kanıtının sınırı:** `503` tek başına JWT doğrulamasının kanıtı sayılmadı. Platform ayarı `true`, bozuk bearer reddi ve ayrı SDK `getUser` doğrulaması birlikte kaydedildi. Kapalı servis kontrolü handler'ın kullanıcı doğrulama çağrısından önce olduğu için, bu provada handler içindeki `verifyAnalysisUser` canlı olarak çalıştırılmış değildir. Public anahtar, kullanıcı kimliği yerine geçmez; analiz açıldığında test erişimi ve Supabase Auth doğrulaması ayrıca zorunludur. Etkin analizdeki tam sahiplik akışı ayrı onaylı testte ölçülecek.

Tüm kapalı yanıtlarda analiz sonucu ve persistence yükü bulunmadığı kontrol edildi.

Tam HTTP matrisi ve SDK tarayıcı kontrolü kod deployment'ından sonra alındı. Sonraki iki `false` yazımı sürümü artırdı; bu nedenle tüm matrise son sürüm 8 sonrasında yeniden çalıştırılmış gibi anlam yüklenmedi. Sürüm 8 metadata kontrolünün ardından localhost OPTIONS **204** ve boş POST **503 / SERVICE_DISABLED** ayrıca tekrar ölçüldü. Uzak bundle hash doğrulaması bu raporun kanıtları arasında değildir.

## 4. İki ayrı kapatma mekanizması

### Sunucu süre kapısı

Mevcut `ANALYSIS_TEST_EXPIRES_AT` kullanılır. Eksik/geçersiz, geçmiş veya 10 dakikadan fazla ileri son tarih etkin analiz erişimini kapatır. Süre sonunda yeni analiz kabul edilmez; Gemini isteği iptal edilir; ilgili yanıt `503 / SERVICE_DISABLED` olur. Bu koruma **remote ANALYSIS_ENABLED secret'ını değiştirmez**.

Bu kod deploy edildi ve yerel otomatik testlerde doğrulandı. Analiz bu görev boyunca `false` kaldığı için **true durumundan süre sonunda kapalı duruma geçiş canlı olarak sınanmadı**. Kapalı servis yanıtı süre kapısının etkin canlı testinin yerine sayılmadı.

### Bağımsız watchdog

`report-qa/phase4-step43-shutdown-watchdog.mjs`, ana test sürecinden ayrı ve Windows'ta gizli süreç olarak çalıştırıldı. Sabit hedef proje kontrolü, en fazla 10 dakikalık UTC son tarih, monotonik bekleme, erken durdurma işareti, sınırlı tekrar ve güvenli sonuç kaydı mevcut. Araç yalnız **ANALYSIS_ENABLED=false** yazabilir; etkinleştirme veya Gemini çağrısı yolu yoktur.

Başarı için hem `false` metadata eşleşmesi hem gerçek `503 / SERVICE_DISABLED` şarttır. Eski `ARMED` dosyası tek başına hazır veya çalışan süreç kanıtı sayılmaz; PID ve son tarih eşleşmesi ile sonuç/süreç çıkışı ayrıca kontrol edildi.

| Canlı kapalı prova | Sonuç |
| --- | --- |
| 30 saniyelik son tarih dolması | İlk denemede CLI exit 0, false metadata eşleşmesi, **503 / SERVICE_DISABLED**, **DISABLED_CONFIRMED**; bağımsız süreç çıktı |
| Erken durdurma işareti, 60 saniyelik pencere | İlk denemede aynı doğrulamalar; işaretten yaklaşık **6,429 saniye** sonra, son tarihten önce kapandı; süreç çıktı |

İki prova da **false → false** yazımıdır. Açık servisin kapatıldığı iddia edilmez. Her iki süreç sona erdi; bu görev için aktif watchdog kalmadı. Yalnız provaya ait durdurma işareti doğrulanan tam yoluyla kaldırıldı.

## 5. Başarısızlık durumları ve giderilen yerel sorunlar

- CLI oturumunun bitmesi, bağlantı kesilmesi veya API hatası remote flag yazımını engelleyebilir. Araç en fazla üç deneme yapar; başarılı metadata ve HTTP kanıtı yoksa `SHUTDOWN_UNVERIFIED` üretir. Kapanmış gibi göstermez.
- Yerel incelemede, işletim sistemi alt süreci sonlandıramadığında CLI beklemesinin uzayabileceği bulundu. QA aracına sınırlı tamamlanma, pipe temizliği ve `CLI_TIMEOUT`/`CLI_OUTPUT_LIMIT` sonucu eklendi. Üç yeni test; kapanış olayı gelmemesi, çıktı sınırı ve normal kapanışı kapsar.
- İşletim sistemi sonlandırması başarısız olursa yalnız `false` yazabilen alt süreç kalabilir; bu durum remote kapatma garantisi değildir. Bilgisayar veya ağ tamamen kaybolursa hiçbir yerel araç remote secret yazımını mutlak garanti edemez. Sunucu süre kapısı bundan bağımsız etkin erişim sınırıdır.
- Süre bitmeden başlamış INSERT veritabanında tamamlanabilir. Sunucu süresi bu işlemi geri alamaz. Böyle bir durum sonraki onaylı testte yalnız kullanıcının kendi request UUID'siyle salt okunur uzlaştırılmalı; kayıt silinmemelidir.
- Erken prova sonrasındaki ilk yerel zaman karşılaştırmasında PowerShell'in ISO alanını otomatik DateTime'a dönüştürmesi nedeniyle parse hatası alındı. Doğrudan DateTimeOffset dönüşümüyle salt okunur doğrulama tekrarlandı ve 6,429 saniye sonucu doğrulandı; bunun için yeni canlı yazım yapılmadı. Kapatma sürecinin kendisi başarılıydı.

## 6. Otomatik doğrulama ve kanıtlar

Bu kapalı deployment çalışmasında yeniden çalıştırılan kontroller:

| Kontrol | Sonuç |
| --- | --- |
| Uygulama unit testleri | **173/173 PASS**, 0 başarısız/atlanan |
| Watchdog testleri | **7/7 PASS**, 0 başarısız/atlanan |
| TypeScript | **PASS**; uygulama ve Edge yapılandırması |
| ESLint | **PASS** |
| Watchdog sözdizimi / ağsız dry-run | **PASS** |
| Gerçek CORS/kapalı HTTP ve SDK tarayıcı kontrolü | **PASS**, yukarıdaki kapsamla |
| Gerçek bağımsız watchdog provası | **2/2 PASS**, yalnız kapalı false → false senaryoları |

Önceki hazırlıkta alınan **104 SQL/RLS**, production build, Capacitor sync, Gradle ve APK/imza sonuçları önceki hazırlık raporundadır. Bu kapalı deployment çalışmasında yeniden koşturulmadı; yeni çalışmış gibi sunulmaz. Android cihaz/emülatör testi yapılmadı. Burada uygulama arayüzü veya Android mimarisi değiştirilmedi.

Yerel kanıtlar (`report-qa` Git tarafından yok sayılır):

- `phase4-step43-closed-function.json`, `phase4-step43-closed-final-config.json`: son sürüm/flag/CORS kontrolü.
- `phase4-step43-closed-schema.json`: READ ONLY katalog, yetki ve sıfır satır kontrolü.
- `phase4-step43-closed-http-result.json`, `phase4-step43-closed-web-result.json`: HTTP ve gerçek tarayıcı sonuçları.
- `phase4-step43-closed-final-http.json`: son sürüm 8 metadata kontrolünden sonraki localhost preflight ve kapalı servis tekrarı.
- `phase4-step43-closed-watchdog-timer-result.json`, `phase4-step43-closed-watchdog-early-result.json`, `phase4-step43-closed-watchdog-early-verification.json`: iki gerçek kapatma provası.
- `phase4-step43-closed-{unit,watchdog,typecheck,lint}-review.log`: güncel otomatik kontrol çıktıları.

Bu görevde QA watchdog ve testleri düzeltildi; kapalı web doğrulama sayfası, güvenli sonuç dosyaları ve bu rapor oluşturuldu. Önceki hazırlığın süre koruması kaynakları onay kapsamında deploy edildi. Yeni bağımlılık eklenmedi. Mevcut Git değişiklikleri geri alınmadı; commit/push yapılmadı.

## 7. Kabul ve sonraki sınır

**Kapalı deployment, kesin CORS izinleri, geçerli SDK oturumuyla kapalı erişim ve bağımsız kapatma provası PASS.**

Gerçek Gemini yanıtı, JSON analizi, kalıcı kayıt/sahiplik, canlı yinelenen istek ve Android canlı analiz akışı bu görevde doğrulanmadı. STEP 4.3'ün tamamı PASS olarak işaretlenmedi. Fotoğrafın yolu, Gemini'ye gönderim/kalıcı kayıt izinleri ve en fazla 10 dakikalık etkinleştirme için kullanıcı ayrıca açık onay verecek. Bu izinler gelmeden analiz açılmayacak. STEP 5'e geçilmedi.
