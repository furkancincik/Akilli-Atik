# Phase 5 / STEP 2B — XP, Profilim ve Eko Arena

**Tarih:** 16 Ekim 2026 · **Rapor dönemi:** 19–23 Ekim 2026\
**Kapsam:** Onaylanan STEP 2A tasarımının yalnız yerel geliştirmesi. Canlı hedef, ayrı onay verildiğinde yalnız `nyoxbwandadakfagoner` olacaktır.

## 1. Uygulanan yapı

`20261016000100_gamification.sql` yeni bir şema migration'ıdır. Önceki `waste_analyses` migration'ı değiştirilmez. İki yeni tablo ve üç dar istemci RPC'si içerir:

| Nesne | Sorumluluk / erişim |
| --- | --- |
| `public.profiles` | Auth kullanıcı kimliği, isteğe bağlı benzersiz takma ad, varsayılan kapalı Arena katılımı ve tarihler. Kendi profilini okuma; doğrudan istemci yazma kapalı. |
| `private.xp_awards` | Kaynak analiz, sahip ve request ilişkisi; İstanbul günü, günlük slot, XP kural sürümü. API rollerine doğrudan okuma/yazma kapalı. |
| `get_my_profile()` | Doğrulanmış çağıranın aktif XP, seviye, rozet, güncel kota ve isteğe bağlı sıralaması. Salt okunur; profil oluşturmayan boş durum. |
| `save_my_profile(p_nickname,p_arena_opt_in)` | Yalnız çağıranın takma adı ve katılımı. Kullanıcı/XP/seviye girdisi almaz. |
| `get_eco_arena(p_offset)` | Giriş yapmış kullanıcıya gönüllü katılımcıların kısıtlı, 20 kişilik sıralama çıktısı. |

Kamuya açık RPC'ler `SECURITY INVOKER` sarmalayıcılardır. Özel yardımcılar dar `SECURITY DEFINER` yetkisi, boş sabit `search_path` ve tam nitelikli nesne adları kullanır. Varsayılan `PUBLIC EXECUTE` izinleri aynı transaction içinde kaldırılır. Auth rolü, `auth.uid()`, anonim hesap durumu ve kullanıcı varlığı sunucuda denetlenir. Auth kullanıcı tablosu veya özel kazanım defteri API'ye açılmaz. `service_role` için doğrudan XP defteri yazma izni bulunmaz.

## 2. XP ve işlem tutarlılığı

| Kategori | XP |
| --- | ---: |
| Organik | 50 |
| Kâğıt/Karton | 75 |
| Cam | 100 |
| Metal | 150 |
| Plastik | 200 |
| Pil | 250 |
| Elektronik | 300 |
| Diğer | 0 |

`waste_analyses` üzerindeki `AFTER INSERT` tetikleyicisi XP'yi **aynı PostgreSQL transaction'ında** oluşturur. Mevcut Edge Function yalnız sunucuda doğrulanmış başarılı analizleri bu tabloya ekler; istemcinin tabloya INSERT/UPDATE yetkisi yoktur. İki ayrı HTTP çağrısı atomikmiş gibi kullanılmaz. XP altyapısındaki beklenmedik hata kaynak INSERT'i de geri alır; mevcut analiz başarılı / kayıt başarısız ayrımı korunur. Kota dolması veya uygun olmayan analiz ise kayıt başarısını engellemez, XP üretmez.

Uygunluk: geçerli kayıt, şema sürümü 1, tek nesne, `uncertain=false`, pozitif kategori puanı. Sahiplik tetikleyicide kaynak satırın sunucuda belirlenmiş `user_id` alanından alınır; service role oturumunun `auth.uid()` değeri kullanıcı sahibi gibi kullanılmaz.

Kullanıcının profil satırı `FOR NO KEY UPDATE` ile kilitlenir; tekrar ve kota kontrolleri kilit altında yeniden yapılır. Gün `created_at AT TIME ZONE 'Europe/Istanbul'` ile hesaplanır. `(user_id, award_day, daily_slot)` benzersizliği günde üç slotu; kaynak analiz ve kullanıcı/request benzersizlikleri tekrar ödülü sınırlar.

Kaynak analiz silindiğinde birleşik sahiplik/request dış anahtarı yalnız `analysis_id` alanını NULL yapar. Kaynak UUID, kullanıcı/request ve kullanılmış slot özel defterde kalır. Aktif toplam ve rozetler düşer; günlük hak geri açılmaz ve eski kaynak/request yeniden puanlanmaz. Hesap silinince ilişkili defter de CASCADE ile temizlenir. Fotoğraf, base64, JWT, API anahtarı ve ham Gemini cevabı bu tablolarda bulunmaz.

## 3. Seviye, rozet ve takma ad

Seviye eşikleri 0 / 100 / 250 / 500 / 1.000 / 1.750 / 2.750 / 4.000 XP'dir. SQL toplamdan seviye, unvan ve ilerlemeyi üretir; istemci sözleşmesi tutarlılığı tekrar denetler. Sekizinci seviyede sonraki eşik NULL, kalan XP 0, ilerleme %100 olur; XP birikimi devam edebilir.

Rozetler aktif kayıtlardan türetilir: **İlk Tanıma** en az bir puanlı analiz, **Kategori Kaşifi** en az üç farklı puanlı kategori, **Yeşil Öncü** en az 1.000 XP. Kazanılmayan rozet kazanılmış gibi gösterilmez.

Takma ad 3–24 karakter, harfle başlayan Türkçe/ASCII harf, rakam veya alt çizgidir. NFC normalizasyonu ve Türkçe harflerin açık eşlemesiyle benzersizlik sağlanır; örneğin `Işık` ve `ISIK` çakışır. E-posta veya Auth profilinden isim türetilmez. Arena için takma ad ve açık katılım şarttır. Bu filtre, kullanıcının izinli karakterlerle gerçek adını kendisinin yazmasını önleyemez.

## 4. Arayüz ve oturum

- **Profilim `/profil`:** Sunucudan doğrulanmış XP/seviye/unvan, etiketli ilerleme, kalan XP, kazanılmış rozetler, kendi sırası, bugünkü kullanılan hak, takma ad ve açık katılım tercihi. Mevcut istatistik servisiyle kısa toplam/farklı kategori/en sık kategori özeti ve geçmiş servisinden son üç kayıt.
- **Eko Arena `/eko-arena`:** En çok üç gerçek katılımcıyla podium, sonraki sıralar, kendi satırı, 20 kişilik sayfalama, boş durum ve yenileme. Toplam XP azalan; eşitlikte normalize benzersiz takma adın `C` sırası kullanılır. DTO'larda e-posta, Auth UUID'si veya özel analiz kimliği bulunmaz.
- **Navigasyon:** Panelim / Atık tara / Geçmiş / Profilim / Eko Arena. Eski `/istatistikler` adresi `replace` ile `/profil` adresine yönlenir. Önceki bağımsız grafik ekranı üründe render edilmez. `StatisticsPage.tsx`, mevcut 44 izole regresyon kontrolünün doğrudan bağımlılığı olduğu için bu adımda kaynak olarak korunur; üretim rotası veya import'u yoktur. Hesaplama servisleri ve testleri korunur.
- **Gizlilik:** Katılım varsayılan kapalı; checkbox tek başına istek oluşturmaz, kaydetme açık kullanıcı eylemidir. RPC henüz canlıda bulunmuyorsa altyapının alınmadığı belirtilir; sahte sıfır XP veya örnek kullanıcı gösterilmez.
- **Oturum:** SDK oturumu API öncesi/sonrası doğrulanır. Hesap/kimlik nesli değişince yeni boş bellek deposu kullanılır; eski istekler iptal edilir ve geç yanıt reddedilir. Token veya profil kalıcı cache'e yazılmaz.

XP, doğrulanmış atık tanıma ve çevresel farkındalık etkinliğidir. Fiziksel geri dönüşüm, maddi ödül veya ölçülmüş çevresel katkı kanıtı değildir.

## 5. Canlı geçiş için ayrı kabul kapısı

Bu çalışma canlı migration, backfill veya deployment yapmaz; `ANALYSIS_ENABLED=false` ayarını değiştirmez. Canlı kullanıcıya mevcut tarihi analizinden XP verildiği iddia edilmez.

1. Ayrı STEP 2C onayında hedef Ref, PostgreSQL sürümü/UTF-8, migration geçmişi, tablo/rol/politika envanteri ve private şemanın API'ye kapalı oluşu salt okunur yeniden incelenir. Beklenmeyen nesnede durulur. Yedek ve bakım penceresi belirlenir.
2. Yalnız yeni şema migration'ı uygulanır. Var olan analiz satırları değiştirilmez ve tarihsel puan aktarımı otomatik başlamaz. RPC'ler, RLS, yetkiler ve analiz servisinin kapalı oluşu kontrol edilir. Mevcut Edge INSERT'i tetikleyiciyi çalıştırdığı için bu tasarım yeni Edge deployment gerektirmez.
3. Tarihi kayıtlar için ayrı dry-run, aday listesi/sayı/beklenen XP raporu ve **ayrı backfill izni** gerekir. Onaylı bakımda kaynak tablo yazma kilidi ilk alınır; kilit altında kapsam yeniden karşılaştırılır. Kapsam farkında rollback ve yeni değerlendirme yapılır. Tarihsel gün/sıra, mevcut slotlar ve silinmiş izler korunur.
4. Canlı takma ad/katılım yazma ve yeni gerçek fotoğraf analizi, kalıcı kayıt, kota veya silme senaryoları ayrıca izin gerektirir. Gerçek Android cihaz doğrulaması bu adımda yapılmaz.
5. Yeni kullanıcı/kazanım oluştuğunda otomatik DROP veya defter silme bir geri dönüş yöntemi değildir. Hata halinde transaction rollback; uygulanmış sistemde dar işlev düzeltmesi ve arayüzün kontrollü kapatılması değerlendirilir.

## 6. Sınırlar ve riskler

Aynı fotoğraf farklı request ID'leri veya farklı hesaplarla yeniden analiz edilebilir. Günlük üç hak ve idempotency bunu tamamen engellemez. Eşzamanlı işlemlerde kilit bekleme/timeout mümkündür; hata güvenli rollback ile sonuçlanır. Arena sırası sayfalar arasında değişebilir; yenileme ilk sayfaya döner. Dinamik SUM ve sıralama büyük ölçekte ayrıca ölçülmelidir. Opt-out sunucudaki sonraki okumadan kaldırır; başka cihazın önceden aldığı ekran görüntüsünü veya bellekteki eski cevabı uzaktan silemez.

## 7. Doğrulama

| Kontrol | Gerçek çalıştırma sonucu |
| --- | --- |
| TypeScript, uygulama + Edge | PASS |
| Tam ESLint | PASS |
| Unit | **303/303 PASS:** mevcut 269 + yeni 20 veri/sözleşme ve 14 controller testi |
| PostgreSQL 17 / SQL / RLS | **212/212 PASS:** mevcut 104 + yeni 108 |
| Gerçek çok bağlantılı yarışlar / yerel backfill aracı | **17/17 PASS**; SQL ile birlikte toplam **229 DB kontrolü** |
| SQL JSON → TypeScript doğrulayıcıları | PASS; gerçek izole SQL profil ve Arena çıktıları sözleşmeyle uyumlu |
| Yeni Profilim / Eko Arena mock tarayıcı | **72/72 PASS**, 24 senaryo, runtime hatası ve dış servis isteği 0 |
| Nihai tarayıcı regresyonları + yeni ekranlar | **377/377 PASS:** Auth 21, kurtarma 40, 429/istek 29, UX 48, analiz 18, geçmiş 48, eski istatistik 44, animasyon 57, oyunlaştırma 72 |
| Production build | PASS; Vite ana JS 612,12 kB için 500 kB chunk uyarısı verdi; hata değildir, ayrı performans iyileştirme adayıdır |
| Capacitor sync / Android Gradle | PASS; `npm run android:apk`, 157 görev, Gradle `BUILD SUCCESSFUL` |
| Debug APK v2 imzası | PASS; tek imzalayan, uygulama kimliği `com.akilliatik.app`, 1 / 1.0, min API 24 / hedef 36 |
| Fiziksel Android / emülatör | **YAPILMADI** |
| Canlı XP migration / backfill / profil tercihi / Arena kabulü | **YAPILMADI — bu adımın dışında** |

20 bağımsız PostgreSQL bağlantısı 20 analiz kaydedip yalnız 3 ödül oluşturdu. Sekiz aynı request yarışı bir commit ve yedi `23505` ret verdi. Paralel Türkçe normalize takma ad yarışında bir commit ve bir benzersizlik reddi oluştu. Silme/backfill yarışı, bakım kilidinin DELETE'i bekletmesi ve defter izinin kotayı korumasıyla doğrulandı. Hesap/backfill yarışında son koşumun iki işlemi de commit etti; bu koşumda deadlock gözlendiği iddia edilmez. Beklenmeyen XP yazma hatası enjekte edilerek analiz INSERT rollback'i ayrıca doğrulandı.

Veritabanı testleri ağsız (`network:none`), `tmpfs` kullanan geçici Docker konteynerinde sentetik hesaplarla çalıştı. Fixture'ların boşaldığı ve konteynerin kaldırıldığı doğrulandı. Ana veri tabanına veya Supabase hesabına bağlanmadı. Backfill aracı yanlış/eksik manifest ve izole ortam koruması olmayan bağlantıyı reddetti.

Yeni tarayıcı senaryoları 0/200/4.000 XP, üst seviye, rozetler, takma ad çakışması, açık katılım/ayrılma, checkbox'ın kaydetmeden yazmaması, sayfalama/eşitlik/kendi sırası, backend eksikliği, çıkış/hesap değişimi ve geç okuma/kaydetme yanıtlarını kapsar. Kaydedilmemiş taslak sekme dönüşünde korunur; eski hesaba ait kayıt başarı mesajı yeni hesaba taşınmaz. Masaüstü ve 320/390 px görüntüler incelendi; yatay taşma yok, bağımsız kontroller en az 44 px hedefe sahip. Metin içindeki Profilim bağlantısı doğal satır boyutunda kalır ve klavyeyle erişilebilir.

İlk QA denemelerindeki fixture yönlendirme farkı, metin içi bağlantının bağımsız buton gibi ölçülmesi ve geliştirme sırasında HMR'ın eski fixture'ları yeniden yüklemesi nihai kanıt olarak kullanılmadı. Bu kayıtlar korundu; temiz kaynakla yeni 72 kontrol tekrar çalıştırılıp geçti. Mock kullanıcılar yalnız izole testlerde bulunur; gerçek kullanıcı veya XP olarak sunulmaz.

## 8. APK ve kanıt dosyaları

APK: `C:\Users\gg\Desktop\Akilli-Atik\android\app\build\outputs\apk\debug\app-debug.apk`\
Boyut: **9.896.425 bayt**\
SHA256: `FBA32A0FEDECDF6F5AADD445A0654F7B9081DE6C5B4AE48EE01CD5F31F11787F`

Üretimdeki dört web dosyasının byte hash'leri APK içindeki karşılıklarıyla eşleşti. Üretim JS'i yeni profil/Arena RPC'lerini içerir; eski grafik ekranı ve QA kullanıcıları/araçları paketlenmez. APK oluşturmak ve imzayı doğrulamak gerçek cihazda işlev testi yerine geçmez. Yeni RPC'ler canlıya uygulanmadan bu APK da XP/rank üretmez, anlaşılır altyapı hatası gösterir.

Migration SHA256: `073D71FCDE974A432C4C58CCB3AEF97CC77BB9AF35136DE851575EAB3AB7E27C`.

Yerel kanıtlar Git dışında `report-qa/phase5-step2b-*` altında: unit/typecheck/lint ve DB logları, DTO doğrulama JSON'u, yeni tarayıcı `summary.json` / `results.json` ve masaüstü/mobil PNG'leri, APK build/imza/manifest logları ve APK asset/artifact JSON'ları. Bu dosyalarda gizli anahtar veya oturum tokenı raporlanmaz.

Nihai toplu tarayıcı özeti `report-qa/phase5-step2b-browser-summary.json` dosyasındadır. Önceki 304 kontrol korunmuş; beşli menü beklentisi güncellenmiş ve gerçek uygulama rotasıyla eski istatistik adresinin Profilim'e replace yönlenmesi yeni UX kabulü olarak eklenmiştir (47 → 48). Eski 44 istatistik kontrolü doğrudan bağımlı izole ekran üzerinden çalışır; o grafik ekranının üründe hâlâ erişilebilir olduğu anlamına gelmez.

## 9. Değişen dosyalar

| Grup | Bu adımda oluşturulan / düzenlenen dosyalar |
| --- | --- |
| SQL / test altyapısı | `supabase/migrations/20261016000100_gamification.sql`, `supabase/tests/gamification.test.sql`, `supabase/tests/bootstrap.sql`, `scripts/test-database.mjs`, `scripts/test-gamification-concurrency.mjs`, `scripts/backfill-xp.sql` |
| Veri ve durum | `src/services/gamificationData.ts`, `gamification.ts`, `gamificationController.ts`, `src/hooks/useGamification.ts` |
| Ekran / navigasyon | `src/pages/ProfilePage.tsx`, `EcoArenaPage.tsx`, `DashboardPage.tsx`, `src/App.tsx`, `src/components/Layout.tsx`, `src/styles.css` |
| Unit testler | `tests/gamificationData.test.ts`, `tests/gamificationController.test.ts` |
| Dokümantasyon | `README.md`, bu rapor |

Yeni paket eklenmedi. Auth, parola kurtarma, Home animasyonu, Edge Function, istatistik hesaplama ve eski migration kaynakları bu adımda değiştirilmedi. Capacitor sync'in ürettiği native dosyalar normal derleme çıktılarıdır. Önceden var olan commit edilmemiş değişiklikler korundu. Çalışılan branch `main`, HEAD `f6b2915443483a85919e53fa0d18af31aaa69727`; commit/push yapılmadı.

## 10. Kabul sonucu

**STEP 2B: yerel kapsam PASS.** XP veri modeli, atomik kayıt/kota/silme kuralları, Profilim ve Eko Arena, navigasyon geçişi, regresyonlar ve APK doğrulaması tamamlandı. SQL, unit ve mock tarayıcı başarıları canlı XP entegrasyonu olarak sunulmaz. Fiziksel cihaz ve canlı katılım/backfill kabulü açık kalır. Sonraki STEP 2C işlemleri için kullanıcı onayı beklenir; bu adımda hiçbir canlı ayar, kullanıcı kaydı, migration, Edge deployment veya Gemini çağrısı yapılmadı.
