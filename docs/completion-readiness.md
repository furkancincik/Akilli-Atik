# Tamamlama çalışması — 17 Ekim 2026

Bu kayıt yeni yerel geliştirmeleri açıklar; önceki teknik/haftalık raporlar değiştirilmedi. Canlı analiz açılmadı, deployment/migration uygulanmadı, gerçek Gemini/e-posta isteği veya kullanıcı verisi değişikliği yapılmadı.

## Kodsuz normal analiz akışı

Mevcut süreli pilot varsayılandır ve korunur. İki açık yapılandırma gerekir:

- Sunucu: `ANALYSIS_ACCESS_MODE=authenticated`. Eksik/tanınmayan değer `test` modudur.
- Web/APK derlemesi: `VITE_ANALYSIS_ACCESS_MODE=authenticated`. Bu public bayrak yalnız arayüzü değiştirir; sunucu yetkisi sağlamaz.
- `ANALYSIS_ENABLED=false` her iki modu da kapalı tutar. JWT/platform kontrolü, Auth `/user` doğrulaması, public anahtar, kesin CORS, JPEG doğrulaması ve XP/RLS kuralları korunur.

Normal modda test kodu alanı/başlığı yoktur. Pilot modunda mevcut kod ve en fazla 10 dakikalık mutlak süre kapısı devam eder. Normal isteğin yürütme süresi en fazla 90 saniyedir; bu süre canlı enable secret'ını değiştirmez.

## Kalıcı API maliyet kotası

Yerel migration: `20261017000100_analysis_quota.sql`. Yeni `private.analysis_requests` tablosu kullanıcı/istek kimliği, fotoğrafın SHA-256 özeti, sunucu lease kimliği ve zamanları içerir. Fotoğraf/base64, modelin ham yanıtı, JWT veya anahtar saklanmaz. Özet tekrar kimliğini fotoğrafa bağlayan özel veridir; public API'ye açılmaz.

| Sınır | Muhafazakâr başlangıç değeri |
| --- | --- |
| Kullanıcı aktif isteği | 1 |
| Proje aktif isteği | 2 |
| Kullanıcı / kayan dakika | 1 |
| Kullanıcı / kayan saat | 3 |
| Kullanıcı / kayan 24 saat | 5 |
| Proje / kayan saat | 30 |
| Proje / kayan 24 saat | 100 |

Bunlar ücretli analiz denemesi sınırlarıdır; İstanbul günündeki üç **XP kazanımı** sınırından bağımsızdır. Reddedilen admission kota tüketmez; kabul edilmiş fakat sağlayıcı/kayıt hatasıyla biten deneme tüketir. Otomatik ücretli tekrar veya kota iadesi yapılmaz. Limitler SQL'de sabittir, istemci tarafından değiştirilemez. Bunlar istek sayısını sınırlar; kesin parasal bütçe garantisi değildir. Üretim için sağlayıcı projesindeki bütçe/alarm ayarları ayrıca hesap sahibiyle değerlendirilmelidir.

`reserve_analysis_request` global transaction advisory lock altında atomik sayar ve rezerve eder. Ağ/Gemini çağrısı sırasında transaction açık tutulmaz. Kullanıcı kimliği yalnız sunucuda doğrulanmış JWT'den gelir. Aynı kullanıcı/istek tekrar kabul edilmez; farklı fotoğrafla aynı kimlik reddedilir. Mevcut kayıt varsa tekrar Gemini yerine kullanıcıya ait kayıt okunur. Önceki denemede kayıt yoksa HTTP 409 döner. Böylece crash/timeout/başarısız kayıt sonrasında belirsiz bir sağlayıcı isteği otomatik yinelenmez.

`finish_analysis_request` yalnız doğru sahip/istek/lease birleşimini kapatır. Kapatma RPC'si başarısız olursa sonuç kaybolmaz; iki dakikalık lease doğal olarak sona erer, tüketilmiş bütçe ve tekrar engeli kalır. Yeni farklı istek de süre/kota kontrollerinden geçer. Defter satırlarını silen rutin/istemci yetkisi yoktur; hesap silinmesi FK cascade uygular. Gelecekte saklama süresi tasarlanırken tekrar engeli korunmalıdır.

RLS açık, politikalar varsayılan ret yönündedir. `anon`, `authenticated` ve `service_role` doğrudan tablo erişimine sahip değildir. Yalnız service role iki dar RPC'yi çağırabilir; `SECURITY DEFINER`, boş `search_path`, nitelikli nesne adları ve parametreli SQL kullanılır. Mevcut oyunlaştırma yardımcıları nedeniyle `private` şemasında USAGE bulunması tablo erişimi vermez. Gemini çağrısından önce kota RPC'si başarısız olursa HTTP 503 ile kapalı kalır.

## Gerçekleştirilen doğrulamalar

- Başlangıç 303/303 unit test; yeni normal istemci, admission adapter ve handler regresyonlarıyla güncel 330/330 unit test PASS. TypeScript, ESLint ve production build PASS.
- Mevcut 212 SQL/RLS + 17 yarış/backfill kontrolü korundu. Yeni 23 SQL kota/yetki kontrolü ve 6 gerçek çok bağlantılı yarış kontrolü geçti: toplam 235 SQL ve 23 eşzamanlılık kontrolü. Gerçek PostgreSQL 17, ağsız/geçici Docker konteyneri; fixture rollback/temizlik doğrulandı. Gerçek Supabase Auth/PostgREST testi değildir.
- Mevcut tarayıcı regresyonu: 61 kriter × masaüstü, 390 px ve reduced-motion = 183 yürütüm PASS. Yeni normal ScanPage: iki görünümde 14 kontrol PASS; gerçek tarayıcıda sentetik görsel hazırlama, önizleme, kod alanının yokluğu, kaldırma ve taşma. Supabase yapılandırması boş/mock kimlik; canlı entegrasyon olarak sayılmaz.
- JDK 21, SDK 36, Capacitor sync, offline Gradle debug APK ve v2 imza doğrulaması geçti. Paket `com.akilliatik.app`.
- Mevcut Android Studio ve API 37 Google APIs/Play Store AVD kullanıldı; yeni SDK/Studio kurulmadı. Bilgisayar yaklaşık 16 GB RAM/16 mantıksal çekirdek. Emülatör dört çekirdekle başlatıldı; sistem imajı istenen 2 GB'ı 4 GB'a yükseltti. WHPX çalıştı; cold boot yaklaşık 190 saniye sürdü.
- Gerçek emülatör/kurulmuş APK/WebView: 9 anonim kontrol PASS (karşılama, kart seçimi, giriş/kayıt navigasyonu, geçersiz form, native kurtarma yönlendirmesi, korumalı profil ve ekran taşması). Dış HTTP isteği yok. Gerçek hesap oturumu, kişisel geçmiş/Profilim/Arena okumaları ve native kamera/galeri henüz bu kabulün parçası değildir.
- Ek native eklenti kontrolleri: Capacitor Camera doğrudan emülatör debug WebView'ından çağrıldı. Sanal kamera çekimi ve yalnız sentetik görselin galeriden seçimi JPEG/path/webPath döndürdü; galeri iptali kullanıcı iptali hatasıyla döndü. Bu üç kontrol başarılıdır; oturum açılmış ScanPage üzerinden uçtan uca fotoğraf alma veya fiziksel kamera/izin reddi kabulü yerine sayılmaz. Hiçbir fotoğraf Gemini'ye gönderilmedi.

Kanıtlar Git dışındaki `report-qa/completion-*.log/json/png` dosyalarındadır. Testlerde ilk yanlış schema-USAGE beklentisi, tarayıcı düzeneği sorunları (kart başlığının harf büyüklüğü, sandbox/host loopback ayrılığı) ve test giriş dosyasının Fast Refresh lint koşulu düzeltildi; ürün güvenliği gevşetilmedi.

Son APK: `android/app/build/outputs/apk/debug/app-debug.apk`, 9.896.425 bayt, v2 imza geçerli. SHA-256: `1F16AABB1192D4805A366587DB19D488C05DD60CD16C8B9F46F7B608C0173E2E`. Varsayılan pilot arayüzüyle üretilmiştir; normal modun ayrı yerel tarayıcı testi APK'da etkinleştirme olarak yorumlanmaz.

Canlı salt okunur ön inceleme: bağlı ref tam olarak `nyoxbwandadakfagoner`. CLI 2.120.0 migration listesinde yalnız iki mevcut uzak sürüm ve yeni yerel bekleyen kota sürümü var. Veri içermeyen public/private şema çıktısı yalnız `waste_analyses`, `profiles`, `private.xp_awards`, beklenen 13 fonksiyon ve sahiplik politikalarını gösteriyor; kota nesneleriyle isim çakışması yok. CLI schema dump için resmi `public.ecr.aws/supabase/postgres:17.11.0.003` Docker imajını önbelleğe aldı; host PostgreSQL/SDK/CLI kurulmadı. RLS/SELECT-DELETE ve sunucu INSERT yetkileri mevcut şemada korundu. Şema dosyası Git dışındadır; hiçbir canlı veri satırı dışa aktarılmadı.

Güncel secret isim/digest metadatası `ANALYSIS_ENABLED=false` ile eşleşti; Gemini secret'ı mevcut. Secret veya digest değerleri çıktılanmadı. Edge sürüm 12, ACTIVE ve `verify_jwt=true`. CLI 2.120'ın digest alanı `value` adını kullandığından yerel kontrol yardımcısının alan eşlemesi düzeltildi; hiçbir secret yazımı yapılmadı. Bu metadata kontrolü, geçerli oturumla yeni canlı HTTP kabulünün yerine sayılmaz.

## Mimari denetimi

Mevcut hook/servis/JSON sözleşmesi korundu; yeni bağımlılık veya backend eklenmedi. Admission HTTP adaptörü Edge Function'a özeldir, frontend paketine server anahtarı taşımaz. Fotoğraf doğrulanmadan kota harcanmaz. Aynı fotoğraf için istemci UUID'si korunur; normal moddaki kayıt hatası metni yeni tekrar davranışıyla uyumludur. Auth/parola kurtarma kodu değiştirilmedi. İstatistik hesaplayıcıları ve eski test bağımlılıkları gerekçesiz silinmedi.

Mevcut yaklaşık 612 kB ana JavaScript parçası ve Gradle `flatDir` uyarısı açık performans/bakım maddeleridir. Bunlar derleme hatası değildir; güvenli kota tamamlanmasını engelleyen yeni katman/refactoring yapılmadı. Yeni normal modun canlı JWT/platform uyumluluğu ayrıca doğrulanmadan pilot kaldırılmayacaktır.

## Canlıya geçiş için ayrı onay

1. Yalnız `nyoxbwandadakfagoner`: mevcut şema/migration geçmişini tekrar salt okunur doğrula. Beklenmeyen nesne veya geçmişte dur.
2. Yalnız `20261017000100_analysis_quota.sql` için dry-run; mevcut CLI destekliyorsa `--skip-vault`. Yeni tablo/iki RPC dışında mevcut analiz, XP, profil veya katılım verisi değişmez.
3. Açık onayla migration uygula; katalog/RLS/ACL/search_path/indeksleri doğrula.
4. Ayrı onayla güncel Edge Function'ı **kapalı** deploy et; gerekiyorsa sunucuda normal mod ayarını yapılandır. `verify_jwt=true`, CORS ve `ANALYSIS_ENABLED=false` korunur. Gizli anahtar değiştirilmez.
5. Geçerli kullanıcı oturumuyla kapalı HTTP kontrolleri; yeni gerçek giriş gerekiyorsa kullanıcı parolayı kendi formuna girer. Public anahtar kimlik yerine sayılmaz; 503 tek başına JWT kabul kanıtı değildir.
6. Gerçek fotoğraf/ücretli çağrı/kayıt ve süreli açılış için ayrıca açık izin. Kota sayacı, tek çağrı, XP, sahiplik, SDK okuması ve kapatma ayrı değerlendirilir.

Canlı migration, deployment, yeni e-posta, hesap/katılım/veri değişikliği veya ücretli API çağrısı için bu belge uygulama izni değildir. Fiziksel Android cihaz kabulü, gerçek kurtarma e-postası, izinli canlı DELETE ve çok kullanıcılı Arena kabulü açık kalır. Hiçbiri mock sonuçlarla PASS sayılmaz.

Referanslar: [PostgreSQL transaction advisory lock](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS), [Supabase Authorization başlıkları](https://supabase.com/docs/guides/functions/auth-headers). İmzalı kullanıcı JWT'si ile publishable proje anahtarı ayrı kalır; platform JWT kontrolü uyumluluk problemi çıkarsa kapatılarak aşılmayacaktır.
