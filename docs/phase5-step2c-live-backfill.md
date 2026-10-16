# Phase 5 STEP 2C Kontrollü backfill ve canlı profil doğrulaması

**Tarih:** 16 Ekim 2026 · **Rapor dönemi:** 19–23 Ekim 2026\
**Proje:** yalnız `Akilli-Atik` / `nyoxbwandadakfagoner`\
**Sonuç:** Onaylanan tek kayıt aktarımı, gerçek Profilim okuması, katılımı kapalı hesap kontrolü ve sonraki ayrı onayla **EkoGezgin** katılımı canlıda doğrulandı. Güncel durum **200 XP, Seviye 2, sıra #1, katılım açık**. Ayrılma kontrolü mevcut canlı katılım kapatılmadan izole testlerle değerlendirildi.

**Tekrarlanan onay sonrası salt okunur kontrol — 16 Ekim 2026, 21:24 Türkiye saati:** Hedef proje yeniden eşleştirildi. Canlı profil hâlâ EkoGezgin ve katılım açık; tek kazanım 200 XP, tek opt-in katılımcı mevcut. Profilin `updated_at` değeri, kazanım ve kaynak analiz manifesti önceki sonuçla aynı. `ANALYSIS_ENABLED=false`, Edge v12 ve `verify_jwt=true` metadata üzerinden yeniden doğrulandı. İkinci katılım kaydı veya XP aktarımı yapılmadı. Aşağıdaki tarayıcı ve otomatik testler aynı gün önceki koşumlardır; bu yeniden kontrolde çalıştırılmadı. Yeni kanıtlar `report-qa/phase5-step2c-arena-recheck-*` dosyalarında saklandı.

## 1. Backfill sonucu

Yalnız `02000bdb-61bb-41dd-877f-e0f9a1945a4f` analizine **200 XP** verildi. İşlem 16 Ekim 2026 **02:00:26 UTC / 05:00:26 Türkiye saati** itibarıyla CLI exit code 0 ile tamamlandı. Başarı, transaction içindeki sonuçla sınırlı tutulmadı; ayrı READ ONLY oturumunda commit edilmiş durum yeniden okundu.

Öncesinde yerel proje bağlantısı ve Management API proje adı/Ref'i eşleştirildi. Migration geçmişi yalnız `20261015000100_create_waste_analyses` ve `20261016000100_gamification` içeriyordu. Canlı şema, fonksiyon gövdeleri, RLS ve yetkiler son doğrulanan migration durumuyla aynıydı.

Gerçek uygulamanın mevcut Supabase oturumu `auth.getUser()` ile sunucudan doğrulandı. Yetkili test e-postası bellekte özet karşılaştırmasıyla eşleştirildi; kullanıcı kimliği özeti veritabanındaki kaynak sahibiyle aynıydı. Kullanıcı SDK'sı ilgili analiz kaydını okuyabildi. Kimlik, e-posta, JWT veya anahtar değeri raporlanmadı.

| Aktarım ön koşulu | Gerçek sonuç |
| --- | --- |
| Kaynak kayıt ve Auth sahibi | Mevcut, doğrulanan hesaba ait |
| Kategori | Plastik |
| Nesne sayısı / belirsizlik | `single` / `false` |
| Şema sürümü | `1` |
| Önceki kaynak/request/hesap kazanımı | `0` |
| Önceki profil | Yok |
| Kaynağın İstanbul günü / dolu slot | `2026-10-16` / `0` |

Hazırlanan tek kayda özel SQL önce izole PostgreSQL'de doğrulandı. Canlı transaction parent tabloda kısa bakım kilidi aldı; bağımsız sahiplik özeti, kaynak manifesti, uygunluk, geçmiş ve ödül fonksiyonunun onaylı gövdesini tekrar kontrol etti. Ardından yalnız `private.award_analysis(izinli_id)` bir kez çağrıldı. XP miktarını kategori kuralı sunucuda belirledi; istemciye puan yazma yolu eklenmedi. Beklenmeyen sonuç transaction'ı geri alacak şekilde sınırlandı.

Genel `scripts/backfill-xp.sql` aracının yerel ortam koruması değiştirilmedi. Canlıya toplu aktarım, yeni migration veya yeni SQL fonksiyonu uygulanmadı.

## 2. XP kazanım kayıt sayısı

| Alan | Commit sonrası değer |
| --- | --- |
| Kazanım ID | `114c3aa9-2413-4d4f-a5a0-e194ffeb512c` |
| Kaynak analiz | `02000bdb-61bb-41dd-877f-e0f9a1945a4f` |
| Kaynağa ait kazanım | **1** |
| Hesabın toplam kazanımı / aktif kazanımı | **1 / 1** |
| XP / kural sürümü | **200 / 1** |
| Gün / günlük slot | **2026-10-16 / 1** |
| Sahip, request ve aktif kaynak eşleşmesi | Üçü de doğru |

Kaynak analiz, request ve günlük slot UNIQUE kısıtları canlı katalogdan doğrulandı. Tekrar engeli canlıda **salt okunur kısıt, gövde ve kayıt sayısı kontrolüyle** değerlendirildi; aynı ödül fonksiyonu canlıda ikinci kez çalıştırılmadı. Tekrar ve yarış davranışları izole PostgreSQL testlerinde ayrıca geçti. Tarihsel gün kaynağın `created_at` değerinden alındı; bugün için yeniden tarihlenmedi.

## 3. Kullanıcı toplam XP değeri

Aktif veritabanı toplamı **200 XP**. Gerçek kullanıcı SDK'sının `get_my_profile` sonucu ve üretim sayfasındaki **200 XP** aynı. Başka analiz veya kullanıcıya ödül verilmedi: global analiz/Auth sayıları **1/1**, profil/kazanım sayıları **0/0 → 1/1** oldu.

## 4. Seviye ve ilerleme sonucu

| Gösterge | Canlı RPC ve uygulama |
| --- | --- |
| Seviye | **2** |
| Unvan | **Geri Dönüşüm Çırağı** |
| Mevcut seviye tabanı / sonraki eşik | **100 / 250 XP** |
| Sonraki seviyeye kalan | **50 XP** |
| Seviye içi ilerleme | **%66,67** |
| Puanlı aktif analiz | **1** |
| Bugün kullanılan hak | **1 / 3**, Europe/Istanbul günü 16 Ekim |
| Rozet | **İlk Tanıma** (`first_recognition`) |

İlerleme `(200−100)/(250−100)` üzerinden hesaplandı; kullanıcı arayüzündeki progress değeri `66.67` olarak okundu. XP fiziksel geri dönüşümün veya ölçülmüş çevresel katkının kanıtı değildir.

## 5. Profilim canlı doğrulaması

Gerçek tarayıcıda `http://localhost:5173/profil` açıldı. Varsayılan uygulama servisleri ve mevcut hesap kullanıldı; mock port, sahte cevap veya ağ yanıtı değiştirme yoktu. Yenileme sonrasında XP, seviye, unvan, kalan XP, ilerleme ve rozet yukarıdaki gerçek değerleri gösterdi; hata mesajı yoktu.

Kısa analiz özeti **1 kayıt, 1/8 kategori, en sık Plastik** gösterdi. Son analiz bağlantısı korunan kayda ve **Plastik Su Şişesi** adına gidiyordu. Analiz kaydı kullanıcı SDK'sıyla da yeniden okundu.

Gerekli profil yalnız ödül transaction'ında varsayılanlarla oluşturuldu: **nickname=NULL, arena_opt_in=false**. İlk okumada “Takma adını belirle” ve “Sıralama dışında” görünüyordu; okuma işlemleri profil tarihini veya kazanımı değiştirmedi.

Daha sonra kullanıcıdan **EkoGezgin takma adı ve Arena katılımı için ayrı, açık onay** alındı. Gerçek Profilim formu bu değerlerle bir kez kaydedildi; uygulama “Profil tercihlerin kaydedildi.” sonucunu gösterdi. Canlı profil `nickname=EkoGezgin`, `arena_opt_in=true`, güncelleme zamanı **02:05:49.990935 UTC** oldu. Profilim gerçek sıra **#1** gösteriyor; XP/seviye/ilerleme/analiz özeti değişmedi. Takma ad gerçek ad veya e-postadan üretilmedi.

## 6. Eko Arena gizlilik doğrulaması

Katılım açılmadan önce gerçek `/eko-arena` ekranı ve aynı hesabın SDK çağrısı **0 katılımcı**, **Sıralama dışında**, `myRank=null`, boş podium ve boş liste döndürdü. Bu sonuç o andaki **0 opt-in profil** ile eşleşti; hesap rızası olmadan yayınlanmadı.

Kullanıcının sonraki onaylı katılımından sonra gerçek ekran ve SDK sonucu **1 katılımcı / myRank=1** döndürdü. Podiumda tek gerçek satır **#1 EkoGezgin, Seviye 2, Geri Dönüşüm Çırağı, 200 XP**, “Sen” işaretiyle gösterildi. Genel listede aynı kullanıcı ikinci kez render edilmedi. Sıra, canlıda tek katılımcı olmasıyla tutarlı; çok kullanıcılı sıra/eşitlik davranışının canlı deneyi olarak sunulmaz.

Canlı, dolu SDK yanıtı uygulamanın katı JSON doğrulamasından geçti; satır alanları tam olarak **rank, nickname, totalXp, level, levelTitle, isMe**. E-posta, gerçek ad, kullanıcı UUID'si, token veya özel profil alanı yok. Gerçek Arena DOM'unda da e-posta/UUID/token biçimi bulunmadı; görünen satır yalnız izin verilen EkoGezgin bilgilerini içeriyordu.

Kullanıcı mevcut katılımını koruyarak ayrılma işlevini test etmemizi istedi. Canlıda kutu kaldırılmadı veya `arena_opt_in=false` yazılmadı. Güncel izole PostgreSQL koşumunda `save_my_profile(...,false)` sonrası profil sırasının NULL ve katılımcı sayısının 25'ten 24'e düştüğü iki kontrol PASS oldu. Bunlar canlı kullanıcı çıkışı değil, gerçek SQL fonksiyonlarının sentetik veriyle testidir.

Gerçek Profilim/Eko Arena bileşenleriyle, harici bağlantıları CSP ile engellenmiş ayrı bir mock tarayıcı senaryosu da çalıştırıldı. Kutuyu kaldırmak tek başına kayıt başlatmadı. Kaydet'e basınca yalnız bir `arenaOptIn=false` isteği oluştu; beklerken form kilitlendi. Mock başarı yanıtı sonrasında “Sıralama dışında”, işaretsiz kutu ve **korunan 200 XP** görüldü; mock Arena boştu. Bu işlem gerçek Supabase'e istek göndermedi.

Ardından gerçek Arena yenilendi ve canlı veritabanı tekrar salt okunur incelendi: **EkoGezgin / katılım açık / #1 / 200 XP / tek kazanım** değişmedi. Profilin güncelleme zamanı hâlâ `02:05:49.990935 UTC`; kaynak analiz ve Auth koruma parmak izleri aynı. Canlı ayrılıp yeniden katılma işlemi yapılmadı.

## 7. RLS ve güvenlik kontrolü

Üç tablonun RLS, 29 doğrulanmış kısıt, 12 geçerli indeks, 72 tablo/rol/yetki ölçümü, 13 fonksiyon gövdesi ve 39 rol bazlı EXECUTE ölçümü aktarım öncesi/sonrası aynı kaldı. SECURITY DEFINER sahipleri postgres ve arama yolları boş; `private` şeması Data API'ye açık değil.

- authenticated profilini yalnız kendi satırı üzerinden okuyabilir; doğrudan profil veya XP yazma yetkisi yok.
- Anonim gerçek `get_my_profile`, `get_eco_arena` ve profil SELECT istekleri **HTTP 401 / PostgreSQL 42501** ile reddedildi.
- İstemci ve service role için XP defterine doğrudan INSERT/UPDATE yok; ödül fonksiyonunu API rolleri çalıştıramıyor. Canlı yazma denemesi yapılmadan etkin yetkiler ve onaylı gövdeler kontrol edildi.
- Tam kaynak analiz parmak izi ve korunan Auth kimlik alanlarının parmak izi önce/sonra aynı. Analiz veya kullanıcı silinmedi/güncellenmedi.
- **ANALYSIS_ENABLED=false**, Edge **v12 ACTIVE / verify_jwt=true** korundu. Secret değerleri/digestleri çıktı veya kanıt dosyalarına yazılmadı.
- Fotoğrafsız kapanış isteği **503 / SERVICE_DISABLED**; dört izinli web/mobil origin OPTIONS **204**, izinsiz origin **403**. 503 kullanıcı doğrulama kanıtı sayılmadı; hesap doğrulaması gerçek Auth ve kullanıcı RPC/SDK okumalarıyla yapıldı.

Fotoğraf, base64, JWT, API anahtarı veya ham Gemini cevabı kaydedilmedi. Gemini çağrısı, deployment, migration veya canlı güvenlik ayarı değişikliği yok.

## 8. Otomatik test sonuçları

Aşağıdaki regresyonlar **backfill commit'inden sonra**, 02:01:59–02:02:39 UTC aralığında yeniden çalıştırıldı:

| Kontrol | Sonuç |
| --- | --- |
| `npm run typecheck` | PASS, exit 0 |
| `npm run lint` | PASS, exit 0 |
| `npm test` | **303/303 PASS**, fail/skip/cancel 0 |
| `npm run test:db` | **212/212 SQL/RLS PASS + 17/17 bağımsız bağlantılı yarış/araç kontrolü**, toplam 229 |
| `npm run build` | PASS, exit 0 |

SQL/RLS testleri ağsız, geçici PostgreSQL ortamında sentetik kullanıcılarla çalıştı; fixture rollback ve konteyner temizliği doğrulandı. Canlı kullanıcılar üzerinde iki hesap izolasyon/yazma/silme testi yapılmadı.

Bu tek kayda özel canlı aktarım SQL'i ayrıca işlemden önce **8/8 izole kontrolü** geçti: SHA uyumu, doldurulmamış izin, yanlış sahip/manifest, çoklu nesne reddi, hata halinde rollback, doğru tek aktarım ve tekrar reddi. Bu sekiz kontrol ana 229 sayısına eklenmedi. Bu koşumun ham log dosyası saklanmadı; senaryolar ve exit 0 sonucu araç çıktısından ayrı kanıt özetine alındı.

Önceki **377 mock tarayıcı kontrolü bu işlemde yeniden çalıştırılmadı**. Sonraki kullanıcı talebi için **bir hedefli mock ayrılma senaryosu** gerçek tarayıcıda yeniden çalıştırılıp geçti; yukarıdaki unit/DB veya eski 377 toplamına eklenmedi. Canlı Profilim/Arena ekran kontrolleri gerçek servis kanıtıdır; mock ayrılma ayrı değerlendirilir. APK veya Android cihaz testi bu görevde yapılmadı. Production build'deki **612,12 kB / 500 kB** chunk uyarısı sürüyor; hata değil, ileride ele alınacak boyut konusu.

## 9. Değiştirilen dosyalar ve kalan eksikler

Uygulama, migration ve Edge kaynak kodları değiştirilmedi. Bu sonuç raporu eklendi; README'nin güncel durum ve test bölümleri güncellendi; tarihsel hazırlık/migration raporlarına sonucun bağlantısı eklendi. Mevcut commit edilmemiş çalışmalar korundu; Git branch `main`, HEAD `f6b2915443483a85919e53fa0d18af31aaa69727` olarak kaldı.

Git dışında `report-qa/phase5-step2c-*` altında ön/son snapshot, kaynak/Auth bütünlük özeti, katalog ve metadata, tek çalıştırma sonucu, gerçek SDK/arayüz JSON'ları, Profilim/Arena JPG'leri, anonim HTTP/kapanış kanıtları ve test logları saklandı. Ayrılma için QA amaçlı `phase5-step2c-optout-ui.html/.tsx` eklendi; önceki 72 mock tarayıcı kontrolünün dosyaları değiştirilmedi, üretim paketine test ekranı eklenmedi. Mevcut yerel inceleme yardımcılarına ayrı backfill/Arena kanıt aşamaları eklendi. İcra aracı önceki çalıştırma işareti varsa yeniden yazmayı engeller; belirsiz commit sonucu otomatik tekrar edilmez. Onaylı SQL'in yerel test SHA256'sı `AD8DBC092345C8E24584CF80EF4F02411F9318CEEF778C5CB5C2ACEBFB68F292`.

Kalanlar: kullanıcının katılımını kapatan canlı ayrılma işlemi talep gereği yapılmadı; birden çok gerçek katılımcıyla sıra/eşitlik/sayfalama ve gerçek Android cihaz testi yapılmadı. Analiz yanıtındaki işlem başına XP/kazanılmama nedeni sözleşmesi önceki hazırlık raporunda açıklanan ayrı geliştirme konusudur; bu backfill onu değiştirmedi.

## 10. STEP 2C kabul durumu

**Onaylanan kontrollü backfill, Profilim, katılmamış hesap gizliliği ve EkoGezgin canlı Arena katılımı PASS.** Veritabanı tek ödül/200 XP, doğru sahiplik, Seviye 2, kalan 50 XP ve korunan kaynak kaydı gösteriyor; gerçek uygulama aynı değerleri ve sıra #1'i okuyor. Analiz servisi kapalı; Arena katılımı kullanıcının son tercihiyle açık.

Ayrılma fonksiyonu izole ortamda doğrulandı; mevcut hesabı sıralamadan çıkaran canlı senaryo **kullanıcının isteğiyle yapılmadı**. Bütün olası canlı senaryolar tamamlandı iddiası yok. Başka projede işlem, başka kullanıcıya ödül, kayıt silme, Git commit/push, sonraki aşama veya haftalık Word raporu yapılmadı.
