# Phase 4 STEP 4.1 Canlı migration ve deployment hazırlığı

**Çalışma tarihi:** 16 Ekim 2026. **Hedef:** yalnız Akilli-Atik, Project Ref `nyoxbwandadakfagoner`, Project URL `https://nyoxbwandadakfagoner.supabase.co`.

**Hazırlık sonucu: PASS.** Mevcut şema ile migration arasında çakışma bulunmadı; kapalı deployment için plan ve doğrulamalar hazır. Canlı migration ve deployment **yapılmadı; açık kullanıcı onayı bekliyor**. Canlı kayıt kabulü henüz PASS değildir.

## 1. Canlı veritabanının mevcut durumu

CLI **2.120.0**, mevcut oturumla hedef projede salt okunur sorguyu başarıyla çalıştırdı. Yerel link `nyoxbwandadakfagoner`. Branch `main`, HEAD `f6b2915443483a85919e53fa0d18af31aaa69727`; önceki çalışma ağacı değişiklikleri korundu.

Sorgu **BEGIN TRANSACTION READ ONLY / katalog SELECT'leri / ROLLBACK** kullandı; `transaction_read_only=on` doğrulandı. Kullanıcı satırları okunmadı veya değiştirilmedi.

| Bulgu | Güncel sonuç |
| --- | --- |
| PostgreSQL | 17.11 |
| `public` ilişkileri/tablo/index/view/sequence | Yok |
| `public` fonksiyonları | Yok |
| `public` RLS politikaları | Yok |
| `public.waste_analyses` | Yok |
| `supabase_migrations.schema_migrations` | Yok; kayıtlı migration geçmişi bulunmuyor |
| `auth.users(id)` | Mevcut, UUID primary key |
| `auth.uid()` / `gen_random_uuid()` | Mevcut |
| `anon`, `authenticated` | Superuser/BYPASSRLS değil; ek rol üyeliği yok |
| `service_role` | Superuser değil; BYPASSRLS var; ek rol üyeliği yok |
| Üç istemci/hizmet rolünün `public` şema yetkisi | USAGE var, CREATE yok |

Canlı default ACL, `postgres` ve `supabase_admin` tarafından oluşturulan public tablolara anon/authenticated/service_role için geniş yetkiler verebiliyor. Migration bu başlangıç yetkilerini **REVOKE ALL** ile kaldırıyor; ayrıca genel default privilege ayarı değiştirmek gerekmiyor. Fonksiyon/sequence default ACL'leri de envanterlendi; migration bu tür nesneler oluşturmaz.

Altı mevcut DDL event trigger görüldü: GraphQL placeholder, PostgREST DDL/drop izleyicileri ve pg_cron/pg_net/pg_graphql erişim işlemleri. Değiştirilmediler. Uygulama sonrasında etkin tablo yetkileri yeniden ölçülecek; yalnız migration metninden nihai canlı yetki varsayılmayacak.

**RLS şu anda bu tablo üzerinde canlı etkin değildir; tablo yoktur.** RLS'nin migration'da ve yerel PostgreSQL testlerinde hazır olması, canlıda uygulanmış olduğu anlamına gelmez.

## 2. Migration uyumluluğu

Tek yerel migration:

`supabase/migrations/20261015000100_create_waste_analyses.sql`

SHA256:

```text
466A4B46A5249CBCC4FD2C056B386666BD19A639FA3D57B1C6C3B1DF90ED27C9
```

Dosya önceki STEP 4 doğrulamasından beri aynı. Yeni migration veya uygulama kodu değişikliği gerekmiyor.

- 15 kolon, 12 constraint, PK/unique/listeleme olmak üzere üç index ve iki sahiplik politikası oluşturur.
- Sekiz kategori mevcut Gemini JSON sözleşmesiyle birebir eşleşir. Zorunlu alanlar boş olamaz; uzunluk, object_count ve schema_version doğrulanır.
- `(user_id,client_request_id)` unique; kullanıcı foreign key'i `ON DELETE CASCADE`.
- Fotoğraf/base64/token/ham Gemini yanıtı için kolon yoktur.
- Tek BEGIN/COMMIT içinde tablo oluşturma, RLS ve yetkiler tamamlanır. Başlangıçta geniş default grant'ların bulunduğu bir tablo ayrı transaction ile dışarıya açılmaz.
- UPDATE/DELETE/DROP/TRUNCATE biçiminde mevcut kullanıcı verisini değiştiren işlem yoktur; `auth.users` satırlarına dokunulmaz.
- Mevcut canlı public nesne veya migration ile ad çakışması saptanmadı. Aynı dosyayı tekrar yanlışlıkla uygulamak isim çakışmasında durur; `IF NOT EXISTS` ile şema farkı gizlenmez.

Başarısız uygulamada bağlantı/transaction durumu ve CLI migration geçmişi tekrar incelenmeli; yarım kalmışlık varsayımıyla migration repair, reset veya yeniden CREATE çalıştırılmamalı. Sonradan tabloyu DROP etmek biriken geçmişi siler; otomatik yıkıcı rollback planlanmadı.

## 3. JWT ve RLS güvenlik değerlendirmesi

| Koşul | Hazırlık değerlendirmesi |
| --- | --- |
| RLS | Migration açıkça ENABLE ROW LEVEL SECURITY içeriyor |
| Anonim erişim | PUBLIC/anon tablo yetkisi ve politika yok |
| Kendi kaydını okuma/silme | authenticated SELECT/DELETE; her iki politika `(SELECT auth.uid())=user_id` |
| İstemci INSERT/UPDATE | Yetki ve politika yok |
| Kayıt sahibi | Yalnız onaylı projenin Auth `/user` yanıtından doğrulanmış kullanıcı UUID'si |
| JWT doğrulama | Decode-only güven yok; eksik/geçersiz/expired token Auth doğrulama yolunda 401 |
| Service role | Yalnız sunucuda; adaptör sabit kolonlarla GET/POST, iki UUID ile filtre ve dönen sahiplik kontrolü |
| Başarılı sonuç/kayıt ayrımı | DB hatasında HTTP 200 + `persistence.failed`; geçerli sonuç korunur |
| Başarısız/no-waste/geçersiz JSON | Kaydedilmez |
| Süreli erişim ve limit | Test kodu, en fazla 15 dakika; 2 aktif, 30/saat, IP kovası başına 3/dakika korunuyor |

Service role anahtarının kendisi dar yetkili bir kullanıcı anahtarı değildir; proje genelinde ayrıcalıklıdır ve RLS'yi atlar. Kodun dar erişimi ile bu anahtarın gücü birbirine karıştırılmamalı. Migration söz konusu tablo için yalnız SELECT/INSERT verir; canlıdaki etkin izinler ayrıca doğrulanacak. Frontend bu anahtarı veya storage modülünü kullanmaz.

**Platform ve uygulama JWT katmanları:** Canlı fonksiyonda şu an `verify_jwt=false`, yerel deployment yapılandırmasında `true`. Onaylanan deployment bu yerel değeri taşımalı; `--no-verify-jwt` kullanılmamalı. Uygulama ayrıca Supabase Auth üzerinden kullanıcıyı doğrular; platform kontrolü tek başına sahiplik kaynağı değildir.

Güncel Supabase dokümanı, uyumluluk nedeniyle public API anahtarının platform kontrolünden kullanıcı JWT'siz geçebileceğini belirtiyor. Bu nedenle özellikle kapalı serviste “public key var, JWT yok, kesin 401 gelmeli” şeklinde bir kabul kriteri kurulmaz. Gerçek platform cevabı ölçülür. [Supabase Authorization headers](https://supabase.com/docs/guides/functions/auth-headers).

Handler sıra olarak public key'den sonra **SERVICE_DISABLED**, ardından test kodu/limit/Auth doğrulaması uygular. Kapalı handler'a ulaşan istek 503 ile sonlanır; Auth/Gemini/DB çağrısı yapmaz. Kapalı deployment sırasında bir bozuk JWT'nin 503 alması kullanıcı olarak kabul edildiğini kanıtlamaz. Uygulama katmanındaki 401 yolunun canlı kanıtı sonraki ayrı kontrollü açık teste aittir. [Supabase JWT doğrulama yöntemleri](https://supabase.com/docs/guides/auth/jwts).

## 4. Fonksiyon ve ortam hazırlığı

Canlı `analyze-waste`: **ACTIVE, sürüm 3, verify_jwt=false**. Yerel yeni kod henüz deploy edilmedi.

CLI üzerinden yalnız secret adları listelendi; değerler/digest'ler raporlanmadı. Gereken adların tamamı mevcut:

- `ANALYSIS_ENABLED`, `ANALYSIS_PUBLIC_KEY`, `ALLOWED_ORIGINS`.
- `ANALYSIS_TEST_TOKEN`, `ANALYSIS_TEST_EXPIRES_AT`.
- `GEMINI_API_KEY`, `GEMINI_MODEL`.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEYS`.

Bu envanter secret değerinin doğruluğunu veya test penceresinin hâlen geçerli olduğunu kanıtlamaz. Geçerli test kodu oluşturulmadı. Kapalı servis davranışı aşağıdaki HTTP kontrolüyle doğrulandı; secret değeri okunmadı. Frontend public yapılandırması doğru hedef URL'ye ait ve mevcut fonksiyondan SERVICE_DISABLED alabiliyor. Gemini modelinin uzak secret değeri açığa çıkarılmadı ve model çağrısı yapılmadı.

### Bu adımda ölçülen canlı HTTP başlangıç durumu

Tüm POST gövdeleri boş, fotoğraf/test kodu/kullanıcı JWT'si yok. Hatalı bearer yalnız sentetik geçersiz test metnidir. Gerçek Gemini çağrısı başlatılmadı.

| Kontrol | Ölçülen sonuç |
| --- | --- |
| Auth public ayarları | 200; e-posta doğrulaması gerekli |
| `https://localhost`, `http://localhost`, `capacitor://localhost` OPTIONS | 204, doğru allow-origin |
| `http://localhost:5173`, `http://127.0.0.1:5173` OPTIONS | 403; canlı CORS'ta izinli değiller |
| Yabancı origin OPTIONS | 403 |
| Anahtarsız POST | 403 / UNAUTHORIZED |
| Yanlış public key POST | 403 / UNAUTHORIZED |
| Doğru public key, JWT yok | **503 / SERVICE_DISABLED** |
| Doğru public key, bozuk bearer | **503 / SERVICE_DISABLED**; eski canlı sürümün kapalı yolu |
| Yasak origin POST | 403 / ORIGIN_DENIED |

Hiçbir cevap analiz veya başarılı kayıt payload'ı içermedi. Eski canlı preflight başlıklarında Authorization ve x-client-request-id izni yok; yeni yerel handler bunları içeriyor. Yeni deployment sonrasında bunun ölçülmesi zorunlu.

## 5. Deployment öncesi riskler ve durma koşulları

1. **Geniş default ACL:** REVOKE/GRANT sonrası etkin izin matrisi ve rol/owner kontrolü beklenenden farklıysa deploymenta devam edilmez. Tablo sahibi istemci rolü olmamalı.
2. **Canlı şema değişmesi:** Bu rapor anlık envanterdir. Yeni tablo, migration veya isim çakışması görülürse dosya zorla uygulanmaz.
3. **CLI yan etkileri:** Kurulu CLI yardımına göre `db push`, Vault secret'larını migration öncesinde güncelleyebilir. Plan `--skip-vault` içerir. Hazırlıkta dry-run dahil hiçbir push çalıştırılmadı. [CLI migration referansı](https://supabase.com/docs/reference/cli/supabase-db-push).
4. **Migration geçmişi:** İlk push CLI'nin migration geçmişi şemasını/tablosunu da oluşturabilir; bu beklenen uygulama yan etkisi onay kapsamına dahildir. Test/bootstrap SQL'leri canlıya gönderilmez.
5. **JWT/gateway/CORS:** Gerçek kullanıcı JWT'sinin yeni platform kontrolüyle çalışması ve tarayıcının preflight'ı canlıda henüz kanıtlanmadı. Sorunu gidermek için JWT kontrolü kapatılmaz.
6. **Yerel web origin'i:** Vite adresleri canlıda engelli. Web canlı testinden önce gerekiyorsa yalnız kesin kullanılan geliştirme origin'i için ayrı CORS onayı alınmalı; wildcard kullanılmamalı.
7. **İstemci/Edge sürüm farkı:** Yeni istemci kayıt durumu sözleşmesi bekler. Kapalı dönemde deployment yapılmalı; gerçek testten önce güncel istemci kullanılmalı.
8. **İdempotency ve kota:** DB unique tek satır sağlar; farklı isolate'larda çift Gemini çağrısı ve instance belleğinde limitler sınırı sürer. Bu deployment sınırsız anonim açılış değildir.
9. **Çıkış sonrası JWT:** İstemci eski işlemi/sonucu engeller; verilmiş access JWT'nin anlık sunucu iptali garanti edilmez.
10. **Geri dönüş:** Mevcut public veriler üzerinde silme işlemi yok. Gelecekte DROP TABLE geçmişi siler. Uygulama öncesi yedek/geri dönüş imkânı doğrulanmalı; veri oluşunca ileri düzeltme tercih edilmeli. ON DELETE CASCADE gelecekte hesap silmenin geçmişi de sileceği anlamına gelir.

## 6. Onay sonrası uygulama sırası

Komutlar **yalnız plan**dır. Mevcut CLI global kurulu değilse aynı komutlar doğrulanmış `npm exec --offline --yes --package supabase@2.120.0 -- supabase` önekiyle çağrılır; npm önekindeki `--yes` yalnız mevcut paket yürütücüsüne aittir, Supabase'in onaylarını atlayan `--yes` seçeneği eklenmez.

### A — Tek migration

1. Proje ref/link, migration SHA256 ve yalnız tek bekleyen dosya yeniden kontrol edilir. Şema envanteri tekrarlanır; yedek/geri dönüş imkânı doğrulanır.
2. Açık migration onayından sonra plan önizlemesi alınır:

```powershell
supabase db push --linked --project-ref nyoxbwandadakfagoner --skip-vault --dry-run
```

3. Yalnız `20261015000100_create_waste_analyses.sql` göründüğünde, onaylanan kapsamda uygulanır:

```powershell
supabase db push --linked --project-ref nyoxbwandadakfagoner --skip-vault
```

Seed, roles, include-all, reset, repair veya otomatik `--yes` seçenekleri kullanılmaz. Bağlantı/parola gerekiyorsa güvenli CLI akışı kullanılır; parola chat'e/komut argümanına yazılmaz. Beklenmeyen ek işlem isteği varsa durulur.

### B — Migration sonrası katalog doğrulaması

Hazırlanan salt okunur `report-qa/phase4-step41-post-migration.sql` çalıştırılır:

- 15 kolon ve tür/uzunluk/default/NOT NULL sözleşmesi.
- 12 geçerli constraint, auth.users FK CASCADE, unique kullanıcı/istek çifti.
- Üç geçerli/hazır index ve doğru listeleme sırası.
- RLS açık; tam iki own-select/own-delete politikası.
- Etkin izin matrisi aşağıdaki gibi; ayrıca TRUNCATE/REFERENCES/TRIGGER/MAINTAIN kapalı.
- Yetkisiz ek grant, beklenmeyen kullanıcı trigger'ı veya istemci owner'ı yok.
- Migration geçmişinde yalnız onaylanan sürüm `20261015000100` var.

| Rol | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| anon | Hayır | Hayır | Hayır | Hayır |
| authenticated | Evet, RLS kendi satırı | Hayır | Hayır | Evet, RLS kendi satırı |
| service_role | Evet | Evet | Hayır | Hayır |

Gerçek kullanıcı satırı oluşturulmaz veya silinmez. Anonim HTTP erişiminin ACL nedeniyle permission-denied vermesi beklenebilir; yalnız boş liste dönmesi kabul kriteri değildir.

### C — Kapalı Edge deployment

Migration doğrulamaları geçince, ayrı deployment onayı kapsamında yalnız şu fonksiyon deploy edilir:

```powershell
supabase functions deploy analyze-waste --project-ref nyoxbwandadakfagoner
```

Fonksiyon adı atlanmaz; başka fonksiyonlar deploy edilmez. `--prune` ve `--no-verify-jwt` kullanılmaz. Secret set/unset/config push yapılmaz; analiz kapalı durumu korunur. Yeni sürüm ACTIVE ve `verify_jwt=true` metadata ile doğrulanır.

### D — Kapalı deployment testleri

| Senaryo | Beklenen / nasıl değerlendirilecek |
| --- | --- |
| Native origin OPTIONS | 204, doğru origin ve apikey/authorization/content-type/test kodu/istek UUID başlık izinleri |
| Anahtar ve bearer yok | Platform veya handler reddi; 401/403, analiz payload'ı yok |
| Yanlış public key | Platform veya handler reddi; 401/403 |
| Doğru public key, JWT yok/bozuk | Gerçek gateway 401 veya handler kapalı gate 503; katman ayrımı kaydedilir |
| Gerçek SDK kullanıcı JWT + doğru public key | **503 / SERVICE_DISABLED**; Gemini/DB/test kodu aşamasına ulaşmamalı |
| Geçerli JWT + yanlış public key | Handler'a ulaşırsa 403 / UNAUTHORIZED |
| Geçerli JWT + yasak origin | Handler'a ulaşırsa 403 / ORIGIN_DENIED |

Hazırlanan `report-qa/phase4-step41-closed-check.mjs --after`, fotoğraf/kullanıcı JWT'si/test kodu kullanmadan güvenli kapalı kontrolleri yapar. Platform public-key-only isteğini 401 ile keserse script tek başına kapalı handler yolunu kanıtlayamaz; kontrol tamamlanmış sayılmaz. Gerçek kullanıcı SDK oturumuyla, tokenı dosyaya/chat'e/komuta kopyalamadan ayrı bir 503 kontrolü gerekir. Testte secret/token kaydedilmez; hata kodu, HTTP ve güvenli boolean sonuçları kaydedilir.

Handler'ın kendi geçersiz/expired kullanıcı doğrulama yolu, kapalı gate yüzünden bu aşamada canlı kanıtlanamaz. Gerçek expired-token testi için token üretme/oturum manipülasyonu yapılmadı. İlgili yerel unit testleri mevcut; canlı kabul E aşamasına bırakılır.

### E — Daha sonraki ayrı canlı analiz testi

Fotoğraf yolu/gönderim izni, kullanılacak test hesabı ve en fazla 15 dakikalık erişim için **ayrı açık onay** alınır. Ancak bundan sonra kontrollü etkinleştirme, gerçek Gemini sonucu, JSON doğrulama, kalıcı kayıt, tekrar isteği ve kullanıcı izolasyonu test edilir. Başarısızlık veya test bitişinde servis tekrar kapatılıp doğrulanır. Test kullanıcıları/verileri izinsiz temizlenmez. Bu aşama için şu anda izin veya test erişimi oluşturulmadı.

## 7. Bu adımda yapılan doğrulamalar

- CLI/ref/link ve canlı READ ONLY şema/rol/default ACL/env-adı/fonksiyon metadata kontrolleri tamamlandı.
- Altı origin OPTIONS ve beş boş POST başlangıç ölçümü tamamlandı; sonuçlar `report-qa/phase4-step41-closed-before.json` içinde. Gerçek fotoğraf/e-posta/Gemini yok.
- JWT/handler/storage/yanıt sözleşmesi odaklı unit testleri **57/57 PASS** olarak yeniden çalıştırıldı; mock servisler kullanıldı.
- Hazırlanan migration sonrası katalog SQL'i, ağsız/tmpfs geçici PostgreSQL **17.11** üzerinde **PASS**: 15 kolon, 12 constraint, üç geçerli index, iki politika, 24 rol/yetki sonucu ve sıfır özel trigger. Yerel sentetik migration geçmişi kullanıldı; gerçek Supabase/Auth/PostgREST kabul testi değildir. Mevcut imaj kullanıldı, konteyner kaldırıldı. Runner: `report-qa/phase4-step41-local-sql.mjs`.
- Önceki **162 unit, 104 SQL/RLS, 168 tarayıcı ve Android** sonuçları STEP 4'ün kayıtlarıdır; bu hazırlıkta tamamı yeniden çalıştırılmış gibi sunulmaz.
- Uygulama kaynakları, migration, secret/ayarlar değiştirilmedi. Yalnız bu rapor ve Git dışında yerel kontrol dosyaları hazırlandı.

## 8. Onay gerektiren işlemler ve sonuç

**A/B:** Yalnız belirtilen migration ve gerekli CLI migration geçmişi oluşturma; ardından salt okunur doğrulama.

**C/D:** Yalnız `analyze-waste` kapalı deployment, yerel `verify_jwt=true` ayarının taşınması ve fotoğrafsız erişim/kapalı servis kontrolleri. Secret değişikliği veya CORS genişletme kapsamda değildir.

**E:** Daha sonra ayrı onayla fotoğraf gönderimi, süreli erişim ve gerçek analiz/kayıt testi. Yerel web origin eklenmesi gerekirse o değişiklik de ayrıca onaylanmalı.

**STEP 4.1 hazırlığı PASS; canlı uygulama ve uçtan uca kabul bekliyor.** Migration/deployment, analiz etkinleştirmesi, gerçek Gemini çağrısı, kullanıcı verisi değişikliği, Git commit/push, Android Studio/emülatör testi, STEP 5 ve haftalık Word raporu yapılmadı.
