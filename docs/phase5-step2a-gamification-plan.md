# Phase 5 / STEP 2A — Profilim, XP ve Eko Arena tasarımı

**Tarih:** 16 Ekim 2026. **Hedef proje:** yalnız Akıllı Atık / `nyoxbwandadakfagoner`.

**Kapsam:** İlk STEP 2 talebi ve sonraki kesin ürün revizyonu birlikte değerlendirilmiştir. Bu belge bir uygulama/deployment sonucu değildir. Yalnız tasarım yapılmıştır; STEP 2B geliştirmesi için onay beklenir. Mevcut StatisticsPage, rotalar, istatistik servisleri, testler, README ve canlı sistem değiştirilmemiştir.

## 1. Mevcut mimari incelemesi

| İncelenen alan | Bulgu ve tasarıma etkisi |
| --- | --- |
| Git | `main`, HEAD `f6b2915443483a85919e53fa0d18af31aaa69727`; önceki aşamalardan çok sayıda yerel değişiklik var, korunacak |
| Auth / App | Mevcut Supabase SDK, RequireAuth ve `user.id + identityVersion` ile kullanıcıya özel state temizliği hazır; yeni oturum sistemi gerekmiyor |
| Navigasyon | Panelim, Atık tara, Geçmiş, İstatistikler; son öğe ileride Profilim ve Eko Arena ile değişecek |
| İstatistik | `statisticsData/statistics/controller/useStatistics` tüm kayıtları sayfalı okuyup özetliyor. Bu kaynak yalnız dört kolon okuduğu için XP uygunluğu belirleyemez; XP burada hesaplanmayacak |
| Geçmiş | Sahiplik filtresi, mikro-saniyeli sayfalama, detay, onaylı silme ve geç yanıt izolasyonu mevcut; yeniden yazılmayacak |
| Analiz tablosu | `waste_analyses`: sahip, benzersiz kullanıcı/request, kategori, `uncertain`, `object_count`, güvenlik alanları ve şema sürümü mevcut |
| SQL yetkileri | Yerel migration'da RLS açık; authenticated yalnız kendi kayıtlarına SELECT/DELETE, service_role INSERT/SELECT; istemci INSERT/UPDATE kapalı |
| Edge Function | Platform JWT + sunucuda kullanıcı doğrulaması; başarılı JSON doğrulanıp kullanıcı ID'si sunucuda belirlenerek kaydediliyor. Başarılı analiz ve başarısız kayıt ayrımı hazır |
| Mevcut kanıtlar | Önceki STEP 1 kayıtları 269 unit, 104 SQL/RLS, 304 tarayıcı kontrolü ve imzalı debug APK içeriyor; bu plan aşamasında testler yeniden çalıştırılmadı |

Yerel link dosyası hedef Project Ref ile eşleşir. Bu adımda canlı şema, secret veya kullanıcı kayıtları yeniden sorgulanmadı. Önceki canlı doğrulamadaki tek plastik şişe kaydı, backfill için yalnız bilinen bir adaydır; canlı uygulama öncesinde yeniden salt okunur incelenecektir. `ANALYSIS_ENABLED=false` ayarına dokunulmadı.

**Kesin ürün kararı:** Bağımsız İstatistikler menüsü/ekranı yeni üründe bulunmayacak. Hesaplama servisleri korunacak ve Profilim'in kısa kişisel özetinde kullanılacak. Günlük/haftalık grafikler profilin ana içeriğine taşınmayacak.

## 2. XP veri modeli ve kazanım kuralları

### En küçük önerilen yapı: iki yeni tablo

`public.profiles` ve Data API'de açılmayan özel şemada `private.xp_awards`. Ayrı toplam puan, günlük sayaç, rozet, sezon veya liderlik tablosu oluşturulmaz. Aşağıdaki alanlar ve nesne adları henüz öneridir; SQL dosyaları STEP 2B'de hazırlanacaktır.

**`public.profiles`**

| Alan | Tasarım |
| --- | --- |
| `user_id` | UUID PK, `auth.users(id)` FK, ON DELETE CASCADE |
| `nickname` | Nullable varchar(24); kullanıcı kendisi belirler, e-posta/gerçek isimden üretilmez |
| `nickname_key` | Sunucunun belirlediği normalize anahtar; NULL değilse UNIQUE; istemci yazamaz |
| `arena_opt_in` | Boolean NOT NULL DEFAULT false; true için geçerli takma ad zorunlu |
| `created_at`, `updated_at` | Sunucu timestamptz alanları; istemci yazamaz |

Profil ilk tercih kaydında dar kapsamlı sunucu fonksiyonuyla oluşturulur. `auth.users` kayıt tetikleyicisi eklenmez; profil problemi hesap kaydını bloke etmemeli. XP tetikleyicisi de gerektiğinde varsayılan özel profili oluşturabilir. Kendi profilini okumak tek başına INSERT yapmaz: profil bulunmuyorsa sunucu bu yokluğu doğrulayıp takma adsız, katılımı kapalı ve aktif kazanımı olmayan başlangıç durumunu döndürür. Bağlantı hatası bu durumla karıştırılmaz. Profilde `total_xp` veya değiştirilebilir `level` kolonu tutulmaz.

Takma ad önerisi: NFC normalizasyonu sonrası 3–24 karakter; Latin/Türkçe harfler, rakam ve alt çizgi, başlangıçta harf. Boşluk, HTML işaretleri, URL/e-posta biçimi, görünmez ve yön değiştiren karakterler kabul edilmez. Sunucu, sabit dönüşümle büyük/küçük harfleri ve Türkçe eşdeğerlerini tek anahtara çevirir: örneğin `Işık` ve `ISIK` aynı anahtardır. `nickname_key` C karşılaştırmasıyla benzersiz tutulur; frontend kontrolü yeterli sayılmaz. Türkçe karakterler için ek eklenti kurulmaz. React metin olarak gösterir; HTML olarak işlenmez. Çakışma mesajı başka kullanıcının kimliğini veya profilini açıklamaz. Seçilen takma adın liderlik katılımında paylaşılacağı açıkça bildirilir; gerçek adları semantik olarak kusursuz tespit etme iddiası yoktur.

**`private.xp_awards`**

| Alan | Tasarım |
| --- | --- |
| `id` | UUID PK, sunucu üretir |
| `user_id` | UUID NOT NULL; profile FK, ON DELETE CASCADE |
| `analysis_id` | Nullable UUID; aktif analiz bağlantısı, tekil |
| `source_analysis_id` | UUID NOT NULL UNIQUE; silmeden sonra da kalan ilk kaynak kimliği |
| `client_request_id` | UUID NOT NULL; UNIQUE(user_id, client_request_id) |
| `award_day` | Date NOT NULL; analiz `created_at` değerinin Europe/Istanbul takvim günü |
| `daily_slot` | Smallint NOT NULL CHECK 1–3; UNIQUE(user_id, award_day, daily_slot) |
| `xp` | Smallint NOT NULL; sürüm 1 için pozitif izinli puanlardan biri |
| `rule_version` | Smallint NOT NULL, başlangıç 1; kazanım anındaki puan kuralı |
| `created_at` | Sunucuda kazanım kaydı oluşturulma zamanı, timestamptz |

Aktif bağlantının `source_analysis_id` ile eşleşmesi CHECK ile korunur. Sahiplik/request ilişkisini DB'de de korumak için mevcut analiz tablosuna UNIQUE(id, user_id, client_request_id) eklenmesi, ledger'dan bu üç alana composite FK önerilir. Silmede yalnız `analysis_id` NULL yapılır; kullanıcı/request ve kaynak kimliği kalır. Normal MATCH SIMPLE kullanılır. Bu yaklaşım parent PK yanında ek bir indeks maliyeti getirir; karşılığında farklı kullanıcının analizine yanlış XP bağlamak FK ile reddedilir. Hedef PostgreSQL sürümü ve sütun seçmeli SET NULL desteği canlı uygulama öncesinde kontrol edilecektir. [PostgreSQL kısıt kuralları](https://www.postgresql.org/docs/17/ddl-constraints.html).

Gerekli indeksler benzersizlik kısıtlarıyla büyük ölçüde oluşur. Kullanıcı bazlı aktif SUM için `(user_id) WHERE analysis_id IS NOT NULL` indeksi ve parent'ın mevcut kullanıcı/tarih indeksi kullanılabilir. Performans testi gerektirmeden yeni cache/materialized view eklenmez.

### Kategori puanları ve uygunluk

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

XP yalnız mevcut güvenilir sunucu tarafından doğrulanıp kaydedilen, sürüm 1 sözleşmesine uygun analizden gelir. **İlk sürüm için önerilen ek muhafazakâr uygunluk:** `uncertain=false` ve `object_count=single`. `multiple` JSON sözleşmesinde otomatik olarak belirsiz demek değildir; buna rağmen ilk XP sürümünde puan dışı bırakılması açık bir ürün/güvenlik önerisidir. Diğer, belirsiz, çok nesneli, başarısız veya kaydedilememiş sonuçlar slot tüketmez. Pil/Elektronik için güvenlik uyarıları aynen korunur; `hazardous=true` ayrıca bonus üretmez ve bu iki kategorinin istenen puanlarını tek başına iptal etmez.

### Atomik kazanım

1. Mevcut Edge Function kullanıcı JWT'sini ve Gemini sonucunu doğrular; mevcut INSERT yolunu kullanır.
2. Analiz INSERT'inin AFTER ROW tetikleyicisi, aynı transaction içinde XP uygunluğunu kontrol eder. Mevcut Edge service role isteğinde `auth.uid()` gerçek kullanıcı değildir; burada kaynak yalnız güvenilir `NEW.user_id` ve parent analizdir. Kullanıcıya açık profil RPC'leri ise kimliği daima `auth.uid()` üzerinden alır.
3. Profil gerekirse özel varsayılanlarla oluşturulur. Kullanıcının profil satırı `FOR NO KEY UPDATE` ile kilitlenir; kilit alındıktan sonra tekrar/request/slot kontrolü yeniden yapılır.
4. İstanbul günündeki tüketilmiş slotlar, silinmiş kazanım izleri dahil sayılır. En çok üç pozitif kazanıma izin verilir; ilk uygun boş slot kullanılır. XP istemciden parametre olarak alınmaz.
5. Kota doluysa analiz normal kaydedilir, XP verilmez. Uygun olmama da analiz hatası değildir. Beklenmeyen XP altyapı hatası ise transaction'ı rollback eder: analiz kaydı ve XP ayrışmaz. Mevcut Edge bu durumda geçerli Gemini sonucu ile `persistence.failed` ayrımını korur.
6. Tekrar INSERT parent benzersizliğinde reddedilir; mevcut duplicate dönüşü yeni XP doğurmaz. Silinmiş bir isteğin tekrar kazanımı da ledger'ın kalıcı tekillik kontrolüyle engellenir; bu kayıt yeniden etkinleştirilmez.

Kilit, sayı hesabı ve benzersiz 1–3 slotlar birlikte kullanılacaktır; yalnız COUNT alıp istemcide karar verilmez. `ON CONFLICT DO NOTHING` tüm çakışmaları sessiz başarı saymak için kullanılmaz. [PostgreSQL satır kilitleri](https://www.postgresql.org/docs/17/explicit-locking.html), [INSERT tetikleyici zamanı](https://www.postgresql.org/docs/17/sql-createtrigger.html).

### Analiz silinmesi

Analiz silinince FK aktif bağlantıyı NULL yapar. Toplam XP, halen mevcut ve aynı sahibin analizine bağlı kazanımların SUM değeridir; ilgili XP, seviye ilerlemesi ve türetilmiş rozetler sonraki okumada düşer. Ayrı toplam cache'i olmadığı için sonradan düzeltilecek ikinci bir sayaç yoktur.

Ledger satırı tamamen silinmez: kaynak/request kimliği, puan kuralı ve günlük slot, tekrar kazanımı engellemek için özel şemada kalır. Fotoğraf, analiz açıklaması, ham yanıt veya token tutulmaz; bu iz dışarıya yayınlanmaz. Günlük slot silmeyle geri açılmaz. Kullanıcı hesabı silinirse FK cascade profil ve tüm ledger izlerini kaldırır. Hesap silme özelliği bu kapsamda geliştirilmeyecektir.

## 3. Seviye ve rozet kuralları

| Seviye | Unvan | Alt toplam XP eşiği |
| --- | --- | ---: |
| 1 | Doğa Meraklısı | 0 |
| 2 | Geri Dönüşüm Çırağı | 100 |
| 3 | Çevre Dostu | 250 |
| 4 | Eko Kaşif | 500 |
| 5 | Yeşil Öncü | 1000 |
| 6 | Doğa Koruyucusu | 1750 |
| 7 | Sürdürülebilirlik Elçisi | 2750 |
| 8 | Çevre Şampiyonu | 4000 |

Sunucu aktif toplamın ulaştığı en yüksek eşiği seçer. İlerleme `(toplam − mevcut eşik) / (sonraki eşik − mevcut eşik)`; kalan XP `sonraki eşik − toplam`dır. Seviye 8'de sonraki seviye/eşik NULL, kalan 0, ilerleme %100; toplam XP artabilir. Silme sonrası seviye düşebilir. Eşikler sürümlü SQL sabitleriyle tutulur; dinamik yönetim tablosu kurulmaz. UI, sunucunun total/level/title/remaining/progress DTO'sunu gösterir; istemci hesapları otorite değildir.

İlk rozet önerileri: **İlk Tanıma** (en az bir aktif pozitif kazanım), **Kategori Kaşifi** (en az üç farklı aktif puanlı kategori), **Yeşil Öncü** (en az 1000 aktif XP). Koşullar sunucuda aktif kazanım/analizlerden türetilir; rozet tablosu veya kalıcı kazanıldı tarihi gerekmez. İlgili kayıt silinip koşul kaybolursa rozet de kaldırılır. Rozetler gerçek geri dönüşüm sertifikası değildir.

## 4. Liderlik tablosu veri modeli

Kalıcı liderlik tablosu yerine yalnız katılmış profiller ve aktif kazanımlar birleştirilir. **Önce `arena_opt_in=true` ve geçerli takma ad filtresi, sonra sıralama** uygulanır. Opt-out kullanıcı için genel sıra NULL'dır; varsayımsal gizli sıra gösterilmez. Opt-in olup XP'si 0 olan gerçek kullanıcı geçerli katılımcıdır.

Sıralama `total_xp DESC, nickname_key COLLATE C ASC`; benzersiz anahtar eşit XP'de deterministik sıra sağlar. Görünen konum ROW_NUMBER mantığında 1,2,3... olur; aynı puanın aynı sırayı paylaşması yerine takma ad kuralı kullanıldığı açıklanır. Takma ad değişince eşit XP içindeki sıra değişebilir.

Tek dar okuma RPC'si bir sorgu snapshot'ında ilk üçü, en çok 20 kişilik sayfayı, mevcut kullanıcının kendi sırasını, devam bilgisi ve okuma zamanını döndürür. İlk sayfa genel 1–20 aralığıdır: ilk üç podiumda, 4–20 listede gösterilir. Sonraki sayfa 21–40'tır; podium korunabilir ama ilk üç sonraki listelerde tekrarlanmaz. 1–2 katılımcı varsa yalnız mevcut kişiler görünür. Başlangıç için doğrulanmış offset + sabit üst sınırlı limit yeterlidir. Ayrı sayfalar arasında puan/katılım değişirse sıralama değişebilir; Yenile ilk sayfaya döner. Atomik çok sayfalı snapshot vaadi verilmez.

**İzin verilen arena satırı:** `rank, nickname, totalXp, level, levelTitle, isMe`. E-posta, gerçek isim, Auth UUID, kaynak analiz/request kimliği, özel profil bilgisi DTO/cursor/HTML içine konmaz. `isMe` sunucuda mevcut JWT kullanıcısı için üretilir. Profilin kendi sırası aynı görünür katılım havuzuna göre hesaplanır. İstek başına sayfa boyutu, parametre tipleri ve sorgu süre sınırı test edilir; büyümeden önce EXPLAIN ve yük ölçümü yapılır.

## 5. RLS ve güvenlik tasarımı

| Kaynak | Anon / anonim Auth hesabı | Normal authenticated kullanıcı | Güvenilir sunucu yolu |
| --- | --- | --- | --- |
| Mevcut analizler | Mevcut erişim yasağı korunur | Mevcut kendi SELECT/DELETE | Mevcut dar INSERT/SELECT korunur |
| `profiles` | Erişim yok | RLS ile yalnız kendi SELECT; doğrudan INSERT/UPDATE/DELETE yok | Dar profil oluşturma/tercih fonksiyonu |
| `private.xp_awards` | Erişim yok | Doğrudan SELECT/INSERT/UPDATE/DELETE yok | Yalnız kontrollü trigger/backfill iç yolu |
| Arena RPC | Erişim yok | Yalnız opt-in dar yayın alanları | Sunucu toplaması |
| Kendi profil RPC | Erişim yok | Yalnız `auth.uid()` sahibi; anonim olmayan geçerli oturum | Sunucu toplaması |

Yeni tablolarda RLS açıkça etkinleştirilir. Kendi profil SELECT politikası sahipliğin yanında JWT'nin `is_anonymous=true` olmadığı koşulunu da içerir; aynı kontrol kullanıcı RPC'lerinde yapılır. Böylece `authenticated` rolü taşıyan anonim Auth hesabı, normal e-posta hesabı yerine geçmez. `PUBLIC`, `anon`, `authenticated`, `service_role` üzerindeki varsayılan tablo/fonksiyon yetkilerine güvenilmez; yeni nesnelerde açık REVOKE/GRANT uygulanır. Mevcut nesnelerin tüm yetkilerini topluca değiştiren komutlar kullanılmaz. Özellikle service_role'a XP tablosunda doğrudan yazma verilmez; mevcut parent INSERT tetikleyiciye yeterlidir. [Supabase RLS rehberi](https://supabase.com/docs/guides/database/postgres/row-level-security).

Üç dış sözleşme yeterlidir: kendi profilini/XP'yi okuma, yalnız kendi takma adı + katılım tercihini kaydetme, arena sayfasını okuma. Dış fonksiyonlar `SECURITY INVOKER` sarmalayıcı olur; ayrıcalıklı iş özel şemadaki dar `SECURITY DEFINER` yardımcıda yapılır. Her yardımcı sabit boş `search_path`, tam şema adları, izinli alanlar ve kimlik/katılım filtreleri kullanır. Dinamik SQL, istemciden user_id/XP/seviye kabulü yoktur. Fonksiyon oluşturma ve varsayılan EXECUTE kaldırma aynı transaction'dadır; yalnız gerekli authenticated çağrısına sınırlı izin verilir. Trigger/backfill fonksiyonları istemciye EXECUTE açmaz. `private` şemasının Data API exposed schemas listesinde olmadığı 2C öncesinde doğrulanır. Definer'in RLS'yi aşabilmesi nedeniyle sahiplik ve opt-in denetimi fonksiyon gövdesinde zorunludur. [Supabase fonksiyon güvenliği](https://supabase.com/docs/guides/database/functions).

Katılım kapatılırken özel XP korunur, yayın durur. İstemci eski arena/profil isteklerini iptal edip nesil numarasıyla geç yanıtları reddeder; kendi satırı geri getirilemez. Diğer kullanıcıların daha önce gördüğü/kaydettiği bilgi geri alınamaz; sonraki okumada opt-out uygulanır. Liderlik verisi başka üyelerin seçerek paylaştığı veri olduğundan kalıcı/offline cache'e yazılmayacaktır.

## 6. Kullanıcı arayüzü değişiklikleri

**Profilim `/profil` — Auth zorunlu:** Üstte takma ad ve düzenleme; XP/seviye/unvan rozeti; etiketli progressbar ve kalan XP; kendi arena sırası veya katılım kapalı açıklaması; anlamı açıklanmış rozetler. Katılım varsayılan kapalı, açık kullanıcı eylemiyle etkinleşir. Alt kısımda korunmuş istatistik hesaplamalarından toplam analiz/farklı kategori/en sık kategori ve geçmiş servisinden son üç kayıt + tüm geçmiş bağlantısı bulunur. Toplam analiz sayısı puan kazandıran analiz sayısıyla karıştırılmaz. Günlük/haftalık grafikler ana içerik olmayacak; ilk Profilim sürümünde taşınmaları önerilmez.

**Eko Arena `/eko-arena` — Auth zorunlu:** Üç kişiye kadar sade podium, ardından 4. sıradan sayfalı liste; nickname, XP, seviye/unvan ve kendi satırı vurgusu. Boş veya tek kişilik liste sahte üyelerle tamamlanmaz. Katılmadan diğer gönüllü üyeleri görmek mümkündür; kendi sıra alanı katılım seçeneğini açıklar.

Her iki ekranda gerçek yükleme/boş/hata/yenileme durumları bulunur. RPC henüz deploy edilmemişse sahte 0 XP, örnek profil veya temsili lider listesi gösterilmez; altyapının kullanılamadığı açıkça belirtilir. "XP, doğrulanmış atık tanıma ve çevresel farkındalık etkinliğini temsil eder; gerçek geri dönüşümün kanıtı değildir." açıklaması görünür olur.

**Kontrollü geçiş — yalnız STEP 2B'de:** Menü Panelim / Atık tara / Geçmiş / Profilim / Eko Arena olur. Yeni sayfalar RequireAuth altında açılır; eski `/istatistikler` adresi geçmiş bağlantıları için `/profil` adresine replace yönlendirir, bağımsız ekran render etmez. Profil kabul testleri geçtikten sonra kullanılmayan `StatisticsPage` ve grafik JSX/stilleri hedefli kaldırılır. İstatistik saf hesaplama, adapter, controller, hook ve testleri korunur. Mevcut istatistik tarayıcı senaryolarının faydalı özet/güvenlik kontrolleri Profilim'e uyarlanır; kaldırılan grafik ekranı beklentileri körlemesine PASS yapılmaz. Bu adımda bunların hiçbiri uygulanmadı.

Mobil beş öğe için 320/390 px testleri, en az 44 px hedefler, alt menü/safe-area payı ve ekran dışına taşmama kontrolü gerekir. Klavye, form etiketleri, progressbar değerleri, tablo başlıkları ve reduced-motion davranışı korunur. Yeni grafik/animasyon bağımlılığı eklenmez.

## 7. Migration ve eski kayıt aktarım planı

**STEP 2B — yalnız yerel/test:** Sürüm kontrollü tek şema migration taslağı hazırlanır: iki tablo, doğrulamalar/indeksler, parent composite unique, dar fonksiyonlar, trigger, RLS/yetkiler. Mevcut migration düzenlenmez. Backfill bu otomatik şema migration'ına gizlenmez; ayrı, varsayılan çalışmayan bakım betiği ve salt okunur dry-run raporu hazırlanır. Yerel PostgreSQL testinde tekrar uygulama/boş rollback/sürümler denetlenir.

**STEP 2C — ayrı canlı onayı gerektiğinde:**

1. Hedef Ref, canlı şema/migration geçmişi, PostgreSQL sürümü/UTF-8, ilgili roller ve private API ayarları salt okunur tekrar kontrol edilir. Beklenmeyen nesnede durulur. ANALYSIS_ENABLED=false korunur; okunabilir yedek ve doğrulanmış geri dönüş planı hazırlanır.
2. Onaylanan yalnız şema migration'ı uygulanır; mevcut analiz satırı içeriği değişmez. Yeni profil varsayılan katılımı false'tur. Trigger/yetki/RLS/RPC ve kapalı analiz davranışı doğrulanır. Başlangıçta yeni Edge Function deployment'ı gerekmemesi beklenir; ihtiyaç doğarsa ayrıca sunulur.
3. Ayrı backfill izni için adaylar, tarihsel uygunluk, beklenen XP ve değişecek yeni ledger/profil satır sayısı dry-run ile raporlanır. Kullanıcı onayı olmadan eski kayda puan eklenmez.
4. Onaylı backfill analiz kapalıyken, kısa bakım transaction'ında yapılır. Parent tabloya en başta yazmaları engelleyen uygun kilit alınır; kilit/sorgu zaman aşımı ve hata halinde rollback uygulanır. Kilit alındıktan sonra onaylanan aday ID listesi, kayıt sayısı ve beklenen XP yeniden karşılaştırılır; kapsam değişmişse yeni adaylar otomatik puanlanmaz, işlem durur ve güncel plan/onay gerekir. Sonra kullanıcı kilidi ve tarihsel gün başına `created_at ASC, id ASC` sırasıyla en çok üç uygun kazanım işlenir. Mevcut slot/request/kaynak kayıtları, silinmiş izler dahil yeniden dağıtılmaz.
5. Tarihsel gün, **aktarım günü değil analiz günü**dür. Aynı betiğin tekrarı yeni XP üretmez; atlanan/uygun olmayan kayıtlar raporlanır. Kaynak analiz değişmez. Mevcut ödüllerle yarış veya hesap silme tespit edilirse zorlayıcı onarım yapılmaz; rollback ve inceleme gerekir.
6. Önceki tek plastik şişe kaydı hâlâ mevcut ve uygun çıkarsa **beklenen** backfill 200 XP, seviye 2, sonraki seviyeye 50 XP ve yaklaşık %66,7 seviye ilerlemesidir. Bu mevcut kullanıcının şimdi XP kazandığı anlamına gelmez. Liderlik katılımı ayrıca açılmaz.

Rollback için ilk tercih fonksiyon/trigger düzeltmesi ve yeni UI'yı kontrollü kapatmaktır. Canlı ledger/profil oluşmuşsa tablo DROP veya kazanım silme otomatik geri alma yöntemi değildir. Eski analizlerin, kimliklerin ve mevcut kullanıcı verilerinin korunması önceliklidir.

## 8. Test planı ve kabul kriterleri

| Alan | Zorunlu senaryolar / kabul |
| --- | --- |
| Puanlama | Sekiz puan; Diğer 0; belirsiz/multiple/başarısız/kayıtsız 0; Pil/Elektronik uyarıları ve puanları |
| Günlük sınır | İlk üç pozitif kazanım; dördüncüde analiz kaydı başarılı ama XP 0; İstanbul gece yarısı; Diğer/belirsiz slot tüketmez |
| Tekrar | Aynı analiz, aynı kullanıcı/request, farklı oturum/Edge isolate, tekrarlanan backfill; silinmiş source/request yeniden etkinleşmez |
| Atomiklik | XP altyapı hatasında analiz INSERT rollback; Gemini sonucu/kayıt hatası UI ayrımı korunur |
| Silme | Aktif XP düşer; günün slotu açılmaz; seviye/rozet/sıra yeniden hesaplanır; FK kaynak/user/request eşleşir |
| Gerçek DB eşzamanlılığı | İki veya daha fazla bağımsız bağlantıda dört uygun INSERT, aynı request yarışı, DELETE/backfill yarışı, account cascade; sırf tek transaction/mock testi yeterli sayılmaz |
| Yetki/RLS | Anon ve anonim Auth hesabı reddi; A/B kendi profili; başka profil DML reddi; istemci ve service_role doğrudan XP yazma reddi; EXECUTE ve search_path saldırıları |
| Takma ad | Türkçe büyük/küçük/NFC-NFD, görünmez/kontrol/HTML karakterleri, uzunluk, aynı isim için eşzamanlı kaydetme ve genel hata |
| Seviye | Her eşiğin altı/eşiti/üstü; bir işlemde seviye atlama; XP silme ile düşme; L8'de NULL sonraki eşik ve sıfıra bölmeme |
| Gizlilik / arena | Varsayılan kapalı; opt-in/opt-out; özel UUID/e-posta/analiz alanları DTO ve cursor'da yok; eşit XP sırası ve sayfalar; 0/1/2 kullanıcıda sahte podium yok |
| Oturum/UI | Çıkış, hesap değişimi, geç yanıt, eski opt-in yanıtı, hata/boş/yenileme, 320/390 px, klavye ve etiketler |
| Mevcut regresyon | Auth/kurtarma/429/Gemini/kayıt/geçmiş/istatistik hesaplama/karşılama animasyonları; TS, ESLint, unit, SQL/RLS, tarayıcı, build, Capacitor ve APK/imza |

STEP 2B kabulü için bütün yeni testler gerçekten çalıştırılmış olmalı; eski testlerin çıkarılan ekran beklentileri gerekçeli uyarlanmalı, kapsam azaltılarak başarı sayısı korunmaya çalışılmamalıdır. STEP 2C canlı kabulü ayrıca gerçek kullanıcı tercihleri/aktarım onayına ve salt okunur doğrulamaya bağlıdır. Plan belgesi, henüz yazılmamış SQL veya arayüz için PASS kanıtı değildir.

## 9. Teknik riskler ve sınırlar

- Aynı fotoğraf farklı request ID'leriyle yeniden gönderilebilir. İdempotency + günlük üç sınırı bunu ve çoklu hesap suistimalini tamamen engellemez. Fotoğraf/fingerprint saklama, ödül/ödeme, fiziksel geri dönüşüm doğrulaması veya sahteciliksiz yarışma iddiası bu sürümde yoktur.
- Gemini sözleşmesinin doğrulanması insan doğrulaması değildir; yanlış sınıflandırma mümkün olduğundan XP maddi/çevresel ölçüm olarak kullanılmaz.
- Özel şema tek başına güvenlik değildir: yetki, RLS, fonksiyon gövdesi ve yayın filtresi birlikte test edilmelidir. Definer kodunun dar kalması kritiktir.
- Günlük kota kilidi, composite FK ve hesap cascade'i deadlock riski taşır. Tutarlı kilit sırası ve iki bağlantılı test zorunlu; backfill bakım kilidi kısa tutulur. Timeout/deadlock hata halinde rollback olur; bu aşamada güvenli çalıştığı iddia edilmez.
- Dinamik SUM/rank ilk sürümü basitleştirir, büyüdükçe maliyet yaratır. İndeks ve gerçekçi yük ölçümü yapılmadan sınırsız ölçek vaadi yoktur. Önceden snapshot alınmış diğer kullanıcı ekranlarının opt-out ile uzaktan silinmesi mümkün değildir.
- Silinmiş analiz için kalan özel kota/tekrar izi, saklama politikasında açıkça belirtilmelidir. Hesap tamamen silinince iz de silinir. Takma adın gerçek kişiyle ilişkilendirilmesini teknik filtreler tamamen engelleyemez.
- Canlı PostgreSQL sürümü ve şema yeniden doğrulanmadan migration üretilmiş varsayılmaz veya uygulanmaz. Mevcut ANALYSIS_ENABLED, JWT, CORS ve süreli test koruması değiştirilmez.

## 10. Uygulanabilir geliştirme sırası ve gerekli dosyalar

| Sıra | STEP 2B işi | Planlanan dosyalar | Kabul kapısı |
| --- | --- | --- | --- |
| 1 | Puan/seviye/profil/arena sözleşmeleri, SQL şeması ve roller | Yeni `supabase/migrations/<yeni_sürüm>_gamification.sql`, özel SQL yardımcıları | Yerel migration, RLS ve yetki incelemesi |
| 2 | Atomik ödül, silme/kota ve tekrar; ayrı backfill/dry-run | Yeni `supabase/tests/gamification*.sql`, `scripts/backfill-xp.*` ve concurrency test aracı | İki bağlantılı yarışlar ve tekrar/rollback |
| 3 | Mevcut SDK üzerinden dar profil/arena adapter'ları ve hesap kapsamlı state | Yeni `src/services/profile*.ts`, `arena*.ts`; `src/hooks/useProfile.ts`, `useArena.ts` | Şema, oturum, hata/iptal ve geç yanıt testleri |
| 4 | Önce Profilim ve kısa gerçek özet; sonra Eko Arena | Yeni `src/pages/ProfilePage.tsx`, `EcoArenaPage.tsx`; gerekirse küçük ortak rozet/progress bileşeni | Mock tarayıcı + mobil/klavye, sahte fallback yok |
| 5 | Kabul sonrası navigasyon ve eski ekran geçişi | `App.tsx`, `Layout.tsx`, `DashboardPage.tsx`, `styles.css`; sonrasında `StatisticsPage.tsx` hedefli kaldırma | Eski adres replace yönlenir; hesaplamalar/testler korunur |
| 6 | Regresyon, üretim paketi ve dokümantasyon | Yeni `tests/profile*.test.ts`, `arena*.test.ts`, yerel browser QA; README | TS/ESLint/unit/SQL-RLS/tarayıcı/build/sync/Gradle/imza raporu |
| 7 | Ayrı STEP 2C hazırlığı ve onay | Canlı envanter/dry-run/uygulama raporu | Migration, backfill ve gerekiyorsa deployment için ayrı açık izin |

Mevcut `statisticsData.ts`, `statistics.ts`, `statisticsController.ts`, `useStatistics.ts` ve 45 unit testi korunur. Auth, parola kurtarma, Camera/Capacitor mimarisi ve mevcut geçmiş yazılmaz/silinmez. Mevcut Edge JSON sözleşmesine XP alanı eklemek başlangıç için gerekli değildir; profil yenilemesi sunucunun sonucunu okur. Sonradan Edge değişikliği gerekirse kapsam ve deployment onayı ayrıca sunulur.

**STEP 2A sonucu:** Mimari ve geçiş planı hazır. Yalnız bu belge ve yerel değişmezlik kontrol kaydı oluşturuldu; uygulama kaynak kodu, migration dosyaları veya canlı sistem değiştirilmedi. 2B/2C uygulanmış veya test edilmiş sayılmaz. Yerel geliştirmeye başlamadan önce kullanıcı onayı bekleniyor.
