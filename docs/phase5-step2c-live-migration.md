# Phase 5 / STEP 2C — Onaylı canlı migration sonucu

**Sonraki işlem notu, 16 Ekim 2026:** Bu belge migration işleminin tarihsel sonucudur. Daha sonraki ayrı onaylarla tek kayda 200 XP aktarıldı, gerçek Profilim ve katılmamış Arena okumaları, ardından EkoGezgin Arena katılımı doğrulandı. Güncel sonuç [canlı backfill raporundadır](phase5-step2c-live-backfill.md); aşağıdaki 0/0 sayıları migration tamamlandığı andaki durumu belirtir.

**Tarih:** 16 Ekim 2026 · **Rapor dönemi:** 19–23 Ekim 2026\
**Hedef:** yalnız `Akilli-Atik` / `nyoxbwandadakfagoner`\
**Sonuç:** **Onaylanan migration ve canlı katalog/bütünlük doğrulaması PASS.** Backfill ve gerçek Profilim/Eko Arena kabulü yapılmadı; bütün STEP 2C tamamlandı olarak işaretlenmez.

## 1. Ön kontroller ve uygulama

Branch `main`, HEAD `f6b2915443483a85919e53fa0d18af31aaa69727`; mevcut commit edilmemiş çalışmalar korundu. Yerel link, Management API proje kimliği ve adı yeniden eşleştirildi. PostgreSQL 17.11/UTF8 canlı şema, tablo/rol/ACL/migration geçmişi ve tek analiz kaydı önceki hazırlık envanteriyle aynıydı; beklenmeyen değişiklik bulunmadı. `private` şeması henüz yoktu.

Yalnız [`20261016000100_gamification.sql`](../supabase/migrations/20261016000100_gamification.sql) uygulandı. Dosya SHA256 değeri uygulamadan önce ve sonra aynı:

`073D71FCDE974A432C4C58CCB3AEF97CC77BB9AF35136DE851575EAB3AB7E27C`

Mevcut önbellekteki Supabase CLI **2.120.0** kullanıldı; yeni kurulum yapılmadı. Önce `--skip-vault --dry-run` yalnız bu tek dosyayı seçtiğini gösterdi. Sonra aynı hedef ve `--skip-vault` ile uygulama exit code **0** döndürdü. Seed, roles, include-all, reset, repair veya deployment seçeneği kullanılmadı.

```powershell
supabase db push --linked --project-ref nyoxbwandadakfagoner --skip-vault --dry-run
supabase db push --linked --project-ref nyoxbwandadakfagoner --skip-vault --yes
```

Gerçek çağrı sabit CLI dosya yolu ve JSON çıktı seçeneğiyle yapıldı. Migration işlemi **16 Ekim 2026 01:33:18 UTC / 04:33:18 Türkiye saati** itibarıyla başarılı raporlandı. `--skip-vault` kullanılarak CLI'nin Vault güncelleme yolu atlandı.

Canlı migration geçmişi son durumda:

| Sürüm | Ad |
| --- | --- |
| `20261015000100` | `create_waste_analyses` |
| `20261016000100` | `gamification` |

## 2. Oluşturulan tablolar ve veri korunması

| Tablo | Sahip | Kolon | Kısıt | İndeks | RLS | Satır |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| `public.waste_analyses` | postgres | 15 | 13 | 4 | Açık | **1** |
| `public.profiles` | postgres | 6 | 5 | 2 | Açık | **0** |
| `private.xp_awards` | postgres | 10 | 11 | 6 | Açık | **0** |

Toplam **29 kısıt doğrulanmış**, **12 indeks geçerli ve hazır**. Tüm 31 kolonda ek kolon bazlı yetki yok. Beklenen üç tablo ve on iki indeks dışında public/private şemalarda yeni ilişki yok; yalnız beklenen 13 fonksiyon var. Mevcut public default ACL, istemci rollerinin özellikleri ve rol üyelikleri değişmedi.

**Profiles:** Auth kullanıcısına CASCADE bağlı UUID primary key; nullable `nickname` varchar(24); sunucuda üretilen benzersiz `nickname_key`; `arena_opt_in NOT NULL DEFAULT false`; sunucu oluşturma/güncelleme zamanları. NFC, Türkçe/ASCII harf-rakam-alt çizgi biçimi ve 3–24 karakter kısıtı var. Katılım için takma ad gerekli. Üretilen anahtarın kolasyonu deterministik olarak doğrulandı.

**Özel XP defteri:** UUID primary key, profil sahibi, nullable aktif analiz bağlantısı, kalıcı kaynak analiz kimliği, request kimliği, İstanbul günü, 1–3 günlük slot, pozitif izinli XP, kural sürümü 1 ve oluşturma zamanı. Fotoğraf, base64, JWT, API anahtarı veya ham Gemini cevabı için kolon yok.

Mevcut analiz tablosunda yalnız `UNIQUE(id,user_id,client_request_id)` ve onun indeksi eklendi. Eski kolonlar, kısıtlar, iki sahiplik politikası ve istemci/hizmet yetkileri korundu.

Korunan kayıt: `02000bdb-61bb-41dd-877f-e0f9a1945a4f`. Migration öncesi/sonrası bütün analiz satırının parmak izi aynı; kayıt sayısı **1 → 1**. Auth kullanıcı sayısı **1 → 1**, kimlik/oluşturma/doğrulama/anonimlik alanlarının koruma parmak izi aynı ve analiz sahibinin hesabı mevcut. Hiçbir kullanıcı hesabı veya analiz silinmedi/güncellenmedi.

Tek analiz satırının yerel veri yedeği `report-qa/phase5-step2c-analysis-backup.local.json` dosyasına, Git dışında alındı; içeriği terminale veya rapora basılmadı. Bu dar analiz export'u tam veritabanı/Auth yedeği veya restore provası olarak sunulmaz. Auth parolaları/tokenları okunmadı veya yedeklenmedi.

Yeni tabloların **0/0** olması; eski kayda XP verilmediğini, profil oluşturulmadığını ve otomatik Arena katılımı yapılmadığını ayrıca doğrular.

## 3. Günlük sınır, tekrar ve transaction kısıtları

Canlı katalogda şunlar doğrulandı:

- Günlük slot CHECK **1–3** ve `UNIQUE(user_id,award_day,daily_slot)`.
- Request için `UNIQUE(user_id,client_request_id)`.
- Aktif `analysis_id` ve kalıcı `source_analysis_id` için ayrı UNIQUE.
- Aktif kaynak ilişkisini koruyan CHECK: bağlantı NULL veya aynı kaynak kimliği.
- Birleşik FK: `(analysis_id,user_id,client_request_id)` → `waste_analyses(id,user_id,client_request_id)`; silmede **yalnız `analysis_id` SET NULL**, MATCH SIMPLE.
- Profil/Auth FK'lerinde ON DELETE CASCADE.
- XP izinli pozitif değerleri **50,75,100,150,200,250,300**; kural sürümü yalnız **1**.
- Parent üzerinde yalnız bir özel `AFTER INSERT` tetikleyicisi: **`waste_analyses_award_xp`**, etkin **O**; hedef `private.award_inserted_analysis()`.

Tetkik edilen fonksiyon gövdeleri onaylanan SQL ile 13/13 eşleşiyor. Dolayısıyla kaynak satırın güvenilir sahipliği, profil satırındaki `FOR NO KEY UPDATE` kilidi, kilit altında tekrar/kota denetimi ve `Europe/Istanbul` gün hesabı deploy edilen tanımlarda mevcut. Analiz INSERT'i ve XP aynı PostgreSQL transaction'ında; XP altyapısındaki beklenmeyen hata kaynak INSERT'i de geri alır. Kota dolması/uygunsuz analiz, başarılı analiz kaydını engellemeden XP üretmez.

Silme sonrası özel slot/request izi kalır; aktif toplam düşer fakat günlük hak açılmaz. Bu davranışın canlı veri oluşturan/silen deneyi **yapılmadı**. Daha önceki izole PostgreSQL yarış kanıtları tarihsel olarak korunur; mevcut inceleme canlı **kısıt/kod doğrulamasıdır**, yeni bir canlı eşzamanlılık veya kota davranış testi değildir.

## 4. RLS politikaları ve etkin tablo yetkileri

| Tablo | Politika |
| --- | --- |
| waste_analyses | `waste_analyses_select_own`, `waste_analyses_delete_own`; authenticated, `auth.uid()=user_id`; önceki tanımlarla aynı |
| profiles | `profiles_select_own`; authenticated, kendi user_id ve anonim Auth hesabı olmayan kullanıcı |
| xp_awards | İstemci politikası yok; varsayılan ret |

| Kaynak | anon | authenticated | service_role |
| --- | --- | --- | --- |
| waste_analyses | Yetki yok | SELECT, DELETE | SELECT, INSERT |
| profiles | Yetki yok | Yalnız SELECT, RLS ile kendi satırı | Yetki yok |
| xp_awards | Yetki yok | Yetki yok | Yetki yok |

**72 tablo/rol/yetki kombinasyonu** etkin `has_table_privilege` ile kontrol edildi: SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN. Beklenen matrisle fark yok. Kullanıcılar doğrudan XP ekleyemez/güncelleyemez; tabloda veya istemci RPC parametrelerinde XP yazma yolu yok. Service role da deftere doğrudan yazamaz; güvenilir parent INSERT'i sahibi postgres olan dar tetikleyiciyi çalıştırır.

`private` şeması sahibi postgres; authenticated yalnız **USAGE**, CREATE yok. PUBLIC/anon/service_role için private şema erişimi yok. Data API exposed listesi hâlâ **public, graphql_public**; private açılmadı. Bu sonuç SQL oturum ayarı varsayımından değil, ayrı Management API GET'inden alındı.

İzin ölçümleri katalog tabanlıdır. Canlı INSERT/UPDATE denemesi, test hesabı, sahte JWT claim'i veya kullanıcıya özel RPC çağrısı yapılmadı.

## 5. RPC ve SECURITY DEFINER güvenliği

Kullanıcıya açık üç RPC oluşturuldu:

| RPC | Sorumluluk | Güvenlik türü |
| --- | --- | --- |
| `public.get_my_profile()` | Yalnız çağıranın profil/XP/rozet/kota/sırası; okumak profil oluşturmaz | INVOKER |
| `public.save_my_profile(text,boolean)` | Yalnız takma ad ve katılım tercihi; user_id/XP girdisi almaz | INVOKER |
| `public.get_eco_arena(integer)` | Yalnız opt-in kullanıcıların 20 kişilik sınırlı yayın DTO'su | INVOKER |

Altı özel DEFINER: `require_game_user`, `award_analysis`, `award_inserted_analysis`, `my_profile`, `save_profile`, `eco_arena`. Kalan dört özel INVOKER: `nickname_key`, `xp_for_category`, `level_info`, `arena_rows`. Public sarmalayıcılarla toplam **6 DEFINER + 7 INVOKER = 13 fonksiyon**.

Tüm fonksiyonların sahibi **postgres**, tümünde sabit boş **`search_path=''`** var. Gövde hash'leri onaylanan kaynakla eşleşiyor; tam nitelikli nesne isimleri ve sunucu kimlik denetimleri korunmuş. Kullanıcı yolu `auth.uid()`, JWT authenticated rolü, anonimlik ve Auth kullanıcısı varlığını denetler. Ödül yolu kullanıcıyı service role oturumundan değil güvenilir kaynak analiz satırından alır.

**39 fonksiyon/rol EXECUTE ölçümü** ve genişletilmiş ACL kontrolünde:

- authenticated yalnız üç public RPC ile `private.my_profile/save_profile/eco_arena` yardımcılarını çalıştırabilir.
- authenticated diğer yedi özel fonksiyonu doğrudan çağıramaz.
- anon, PUBLIC ve service_role için 13 fonksiyonun tamamında doğrudan EXECUTE kapalı.
- Beklenmeyen başka alıcı veya istemciye grant option yok.
- Fonksiyon sahibinin örtük yönetim yetkisi normal kullanıcı yetkisiyle karıştırılmadı.

Arena'nın takma ad/XP/seviye/sıra/isMe dışındaki özel hesap alanlarını yayınlamayan tanımı onaylı kaynakla aynı. Gerçek kullanıcı tercihi veya Arena sonucu bu aşamada çağrılmadı; uygulama ekranları için ayrı izin bekleniyor.

## 6. Analiz servisi ve güvenlik sınırları

Migration sonrası mevcut secret metadatası bellekte karşılaştırılarak **ANALYSIS_ENABLED=false** yeniden doğrulandı; secret değeri veya digest dosyaya/çıktıya yazılmadı. `analyze-waste` **ACTIVE, sürüm 12, verify_jwt=true** olarak kaldı. Deployment veya bayrak değiştirme komutu yok.

Fotoğrafsız kapanış kontrolü:

| HTTP kontrolü | Sonuç |
| --- | --- |
| localhost:5173 ve üç mobil origin OPTIONS | 204, yalnız istenen izinli origin |
| İzin verilmeyen origin OPTIONS | 403, allow-origin yok |
| Public anahtar, test kodu/JWT/fotoğraf olmadan boş POST | 503, SERVICE_DISABLED; analiz içeriği yok |

503 kendi başına kullanıcı JWT doğrulama veya yeni RPC/RLS davranış kanıtı değildir. Gerçek Gemini isteği, fotoğraf aktarımı veya yeni analiz kaydı yok. Mevcut analiz yanıtının işlem başına XP/gerekçe içermemesi [hazırlık raporunda](phase5-step2c-live-preparation.md) açıklanan ayrı sözleşme eksiği olarak sürüyor; bu migration bunu değiştirmedi.

## 7. Hatalar, doğrulama sınırı ve kalan onaylar

Canlı migration exit code 0; güvenlik veya veri kaybı sorunu saptanmadı. İlk yerel gövde-karşılaştırma aracının regex'i `arena_rows()` başlığındaki satır sonunu ayıramadığı için iki fonksiyonu yanlış eşleştirdi. Kaynak ayrıştırıcısı düzeltildi ve aynı canlı katalog çıktısında **13/13 gövde eşleşmesi** ayrıca bağımsız doğrulandı. Bu bir canlı SQL değişikliği değildi; migration tekrar uygulanmadı, veritabanında onarım yapılmadı. İlk kontrol sonucu `migration-initial-parser-check.json` ile korundu.

Önceki **303 unit, 212 SQL/RLS +17 yarış/araç, 377 mock tarayıcı**, TS/ESLint/build/APK sonuçları bu adımda yeniden çalıştırılmadı. Yeni APK üretilmedi. Bu işlemde yapılanlar canlı ön kontrol, onaylı tek migration, salt okunur katalog/bütünlük ve kapalı HTTP doğrulamasıdır. Gerçek veri kullanan kota/tekrar/silme, Profilim/Eko Arena SDK/arayüzü veya Android cihaz testi başarılı olarak sunulmaz.

Son durum: **onaylanan migration kapsamı PASS**. Bekleyenler:

1. Eski tek kayıt için güncel kilitli önizleme ve **ayrı 200 XP backfill izni**; şu anda verilmiş XP yok.
2. Gerçek oturumla Profilim/Eko Arena okuma doğrulaması için ayrı izin; profil tercihi/takma ad/katılım yazmaları ayrıca açıkça belirlenmeli.
3. İstenirse analiz yanıtındaki XP/gerekçe sözleşmesi için ayrı yerel geliştirme ve daha sonra ayrı deployment onayı.
4. Yeni gerçek fotoğraf ve analiz için ayrı gönderim/kayıt/süreli etkinleştirme izni.

Hiçbir sonraki aşamaya geçilmedi. Git commit/push, başka Supabase projesi işlemi, kullanıcı/analiz silme, backfill, profil tercihi, otomatik katılım, Edge deployment, Android Studio/emülatör veya haftalık Word raporu yok.

## 8. Kanıt dosyaları

Git dışında `report-qa/phase5-step2c-*` altında:

- `migration-preflight.json`, `migration-dry-run.json`, `migration-apply.json`.
- `migration-before/after-live-inventory.json`, `migration-before/after-live-config.json`, `migration-before/after-live-metadata.json`.
- `migration-before/after-preservation.json`, yerel analiz yedeği.
- `migration-after-security.json`, `migration-verification-summary.json`, `migration-namespace-check.json`.
- `migration-after-closed-http.json`, salt okunur SQL ve yerel doğrulama araçları.

Rapor/CLI çıktılarında secret değerleri, anahtarlar, doğrulama kodları veya oturum tokenları bulunmaz. Önceki [hazırlık raporu](phase5-step2c-live-preparation.md) ve [yerel geliştirme raporu](phase5-step2b-gamification.md) kendi tarihsel kapsamlarını korur.
