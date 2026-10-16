# GitHub senkronizasyonu doğrulaması

**Tarih:** 16 Ekim 2026\
**Kapsam:** Phase 4 ve Phase 5 kaynak, migration, test ve dokümantasyon dosyalarının özel GitHub deposuna aktarılmadan önce doğrulanması.

## Proje ve Git ön kontrolü

Hedef depo yalnız `furkancincik/Akilli-Atik`; GitHub API üzerinden **PRIVATE**, varsayılan dal **main** olarak doğrulandı. Başlangıçta yerel HEAD ve güncel `origin/main` aynıydı: `f6b2915443483a85919e53fa0d18af31aaa69727`. Yerel/uzak fark **0/0**; beklenmeyen uzak commit veya dosya silme yoktu. Önceki commit edilmemiş geliştirmeler korundu.

Doğrulanan değişiklikler Auth ve parola kurtarma/429 akışı, JWT doğrulamalı güvenilir kayıt, kullanıcıya özel geçmiş, PostgreSQL/RLS, XP/profil/Arena ve ana sayfa etkileşimleriyle sınırlı. Yeni özellik veya mimari değişiklik yapılmadı. README'deki eski boş profil/defter ifadesi güncellendi; kategori XP değerleri, seviye eşikleri ve unvanlar mevcut SQL/TypeScript sözleşmesine göre belgelendi. Giriş ekranında geçmişin henüz hazır olmadığını söyleyen eski açıklama da mevcut işlevlerle tutarlı hale getirildi; ardından uygulama ve Android kontrolleri yeniden çalıştırıldı.

## Güncel terminal kontrolleri

| Kontrol | Sonuç |
| --- | --- |
| TypeScript | PASS |
| ESLint | PASS |
| Unit testleri | **303/303 PASS**, başarısız 0 |
| PostgreSQL/RLS | **212/212 PASS** |
| Bağımsız bağlantılı yarış/backfill kontrolleri | **17/17 PASS** |
| Production build | PASS |
| Capacitor Android sync | PASS |
| Android Gradle | `assembleDebug --offline` PASS |
| APK imzası ve üretim dosyaları | v2 imza PASS; dört üretim dosyası APK ile eşleşiyor |

İlk veritabanı koşumu sandbox'ın Docker named-pipe erişimini engellemesi nedeniyle başlayamadı. Gerekli süreç erişimiyle aynı test yeniden çalıştı ve geçti; ilk engel ayrı logda korundu. SQL testleri ağsız, geçici PostgreSQL ortamında sentetik veriyle çalıştı; rollback ve konteyner temizliği doğrulandı.

Son giriş metni düzeltmesinden sonra APK yeniden paketlendi: **9.896.425 bayt**, SHA256 `C2C8DBF70349A5191823F4EA9697147B4DCEA28549205BEFCF83BBC7CEB99E86`. Gradle 157 görevin 27'sini çalıştırdı; 130 görev günceldi. Yeni açıklamanın üretim paketinde ve APK'da bulunduğu, dört web varlığının eşleştiği ve QA ekranlarının APK'ya dahil olmadığı doğrulandı. Paket kimliği `com.akilliatik.app`, sürüm 1.0, min SDK 24, hedef SDK 36. Cihaz veya emülatörde işlev testi yapılmadı.

Son TypeScript, ESLint, unit, build, sync ve Android kontrolleri 18:43–18:45 UTC arasında tekrar çalıştı. SQL/RLS ve yarış testleri aynı görevde 18:28–18:29 UTC'de tamamlandı; yalnız giriş açıklaması değiştiği ve SQL kaynakları korunmuş olduğu için tekrar edilmedi.

Mevcut 612,14 kB JavaScript chunk ve Gradle `flatDir` uyarıları sürüyor; derlemeler exit code 0 ile tamamlandı.

## Tarayıcı kontrolleri

İlk push sırasında tarayıcı sonucu kullanıcı tarafından manuel PASS olarak bildirildi; collector raporu bulunmadığından bağımsız otomatik sayı verilmedi. IAB/Chrome bağlantıları kullanılamamış, kişisel Opera erişimi otomatik onay incelemesinde gizlilik gerekçesiyle reddedilmişti. Opera içeriği okunmadı veya değiştirilmedi. Bu ilk denemelerdeki **0 otomatik kontrol** ve önceki 377 tarihsel sonuç yeni koşum sayılmaz.

### QA sunucusunun yeniden erişilebilir hale getirilmesi

Sonraki erişim sorununun nedeni, geçici QA sunucusunun önceki işlem sonunda kapatılmasıydı. İncelemede **5178 portunda dinleyen süreç yoktu**; HTML ve React test dosyaları mevcuttu. Sunucu doğru proje dizininden yeniden başlatıldı; kök dizin ve collector dosya yolu ayrıca yardımcı scriptin konumuna göre mutlaklaştırıldı. Böylece servis çalışma dizinine bağımlı bırakılmadı.

Doğrulanan adres: `http://localhost:5178/report-qa/github-sync-visible.html`. **20:29 UTC** kontrolünde hem HTML hem `github-sync-visible-runner.tsx` modülü HTTP **200** döndü; başlık, script yolu ve proje kökü eşleşti. Sunucu yalnız loopback üzerinde çalışır; normal uygulamanın 5173 sunucusundan ayrıdır. QA sunucusu bu işlem sonunda açık bırakılır; sunucu durdurulduğunda veya bilgisayar yeniden başlatıldığında tekrar çalıştırmak için proje kökünde:

```powershell
node report-qa/github-sync-serve.mjs
```

Bu yardımcı ve QA dosyaları yalnız yerel `report-qa/` klasöründe bulunur; Git'e ve APK'ya dahil edilmez. Public Supabase yapılandırması boş, dış bağlantılar CSP ile kapalıdır; giriş, parola veya e-posta gerekmez.

### Gerçek otomatik tarayıcı sonuçları

Kullanıcının mevcut test altyapısını kullanma talebi üzerine kurulu **Playwright 1.62.1** ve **Microsoft Edge** ile ayrı, geçici headless tarayıcı bağlamları açıldı. Yeni paket kurulmadı, kişisel profil kullanılmadı. Sayfa ağ istekleri yalnız `http://localhost:5178` origin'ine izin verir; service worker engellenir. Test düğmesine Playwright bastı; kullanıcıdan yeni bir manuel deneme istenmedi.

İlk gerçek koşum **48 PASS / 1 FAIL** ile 49 kontrolde durdu. Başarı mesajı kontrolü geçmişti; sonraki çıkış kontrolü zaman aşımına uğramış ve önceki aşamanın etiketini kullanmıştı. QA düzeneği, üretim `App` bileşeninin daha önce oturum açmış kullanıcıyı çıkışta `/` adresine yönlendiren durumunu taşımıyordu; varsayılan `/giris` yönlendirmesinde kalıyordu. Yalnız yerel test düzeneği üretim davranışıyla eşleştirildi ve çıkış aşamasının etiketi ayrıldı. Üretim kaynakları değiştirilmedi, hiçbir doğrulama kaldırılmadı; ilk başarısız JSON ve ekran görüntüsü saklandı.

| Güncel koşum | Görünüm / hareket | Sonuç |
| --- | --- | --- |
| Masaüstü tekrar koşumu | 1280 × 900, normal hareket | **61/61 PASS** |
| Mobil görünüm | 390 × 844, normal hareket | **61/61 PASS** |
| Azaltılmış hareket | 1280 × 900, `prefers-reduced-motion: reduce` | **61/61 PASS** |

Üç koşum **20:32 UTC**'de sırayla çalıştı: **61 kriter × 3 görünüm = 183 başarılı yürütüm**. Her raporda gerçek tarayıcı POST'u, collector **HTTP 200 / saved=true**, disk kaydı, zaman damgası ve aynı sonuç listesi karşılaştırıldı. Çalışma zamanı hatası, konsol hatası ve dış istek yoktu; koşum sonundaki sayfa genişliği her görünümde viewport sınırındaydı. Bütün geçici test tarayıcıları kapatıldı; QA sunucusu açık kaldı. QA düzeneğinin hedefli TypeScript ve ESLint kontrolleri de exit code 0 ile tamamlandı.

Yerel kanıtlar: `report-qa/github-sync-playwright-summary.json`, senaryo bazlı JSON/collector/ekran görüntüleri `report-qa/github-sync-playwright-artifacts/` altında; son collector kaydı `report-qa/github-sync-browser-current.json`. Önceki manuel bildirim ve başarısız denemeler bu yeni PASS sonuçlarıyla değiştirilmedi.

Bu koşumlar gerçek tarayıcıda mock servisli bileşen testleridir. İç focus/click/input kontrolleri sentetik DOM olayları kullanır; gerçek klavye kapsamı iddia edilmez. 390 px görünüm fiziksel Android testi değildir. Canlı Supabase, Gemini, e-posta veya gerçek kullanıcı verisi kullanılmadı. Üretim kaynakları değişmediği için önceki 303 unit, 212 SQL/RLS + 17 ek kontrol ve APK kanıtları korunur; bu QA düzeltmesinde tekrar çalıştırılmış sayılmaz.

## Güvenlik ve dışlanan dosyalar

Kaynaklar, testler, teknik raporlar, ortam şablonları ve yerel QA metinleri anahtar, JWT, private key, parolalı bağlantı ve secret ataması desenleriyle tarandı; eşleşmeler kod/test bağlamında incelendi. Gerçek API anahtarı, oturum tokenı veya private key bulgusu yok. `.env.example` dosyalarının credential alanları boş; model adı, proje URL'si ve kesin origin listesi gizli değer olarak değerlendirilmedi.

Tarama matematiksel yokluk kanıtı değildir: metin dosyaları ve mevcut Git metin nesneleri denetlendi, görsel/binary QA çıktıları OCR ile taranmadı. Yeni binary dosya commit adayı değil. Son aşamada yalnız izin verilen kaynak, migration, test ve dokümantasyon dosyaları stage edilerek index içeriği ayrıca denetlenir; gizli bilgi veya beklenmeyen uzak değişiklik halinde commit/push durdurulur.

Git dışında kalanlar: `.env.local`, diğer gerçek ortam dosyaları, Supabase yerel bağlantı/oturum dosyaları, `report-qa/` yedekleri ve çıktıların tamamı, keystore/imzalama dosyaları, APK/AAB, `dist/`, Android build/cache ve yerel SDK ayarları. Yerel analiz yedeği kullanıcıya özel kimlik alanları içerir; yedek ve hiçbir QA çıktısı stage edilmeyecek. Değerler raporlanmadı.

## Korunan canlı durum ve kabul sınırları

Son onaylı STEP 2C sonucunda tek kazanım **200 XP**, **Seviye 2 / Geri Dönüşüm Çırağı**, **%66,67** ilerleme, kalan **50 XP** ve EkoGezgin'in tek katılımcı arasında **#1** sırası doğrulandı. Katılım tercihi açık bırakıldı; ayrılma kontrolü canlı katılımı değiştirmeden yerel SQL ve mock arayüzde yapıldı. Ayrıntılar [STEP 2C raporundadır](phase5-step2c-live-backfill.md).

**ANALYSIS_ENABLED=false**; analiz kapalıdır. Bu senkronizasyon görevi canlı migration, Edge deployment, Gemini/e-posta çağrısı veya kullanıcı/profil verisi değişikliği içermez. Gerçek Android kamera/galeri, çok kullanıcılı canlı sıralama, mevcut hesabı çıkaran canlı ayrılma ve ilgili raporlarda açık bırakılmış Auth/e-posta kontrolleri PASS olarak gösterilmez.

İlk kaynak/dokümantasyon commit'i `2a1ac9f7124547a25703a64d1f739a08210f1b9e` PRIVATE deponun main dalına başarıyla aktarıldı; uzak hash ve temiz çalışma ağacı doğrulandı. Yeni otomatik QA kanıtını belgeleyen README/rapor güncellemesi de mevcut açık onay kapsamında son güvenlik/Git denetiminden sonra normal main push'u ile aktarılır; force push kullanılmaz. Son hash ayrıca raporlanır; commit kendi hash'ini belgeye eklemek için yeniden yazılmaz.
