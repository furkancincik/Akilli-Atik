# Kalıcı analiz kotası — canlı migration doğrulaması

**Tarih:** 17 Ekim 2026. **Tek hedef:** `nyoxbwandadakfagoner`.

Kullanıcının açık onayıyla yalnız `20261017000100_analysis_quota.sql` uygulandı. Deployment, gerçek Gemini çağrısı, analiz açılışı, backfill veya kullanıcı kaydı değişikliği yapılmadı. Önceki teknik/haftalık raporlar değiştirilmedi.

## Ön kontrol ve uygulama

- Temiz `main`, yerel/uzak HEAD `82e1b895716da4c39e96c3352cdc6bd72696f8f9` ile başladı.
- Bağlı proje ref'i sabit hedefle eşleşti. Yeni salt okunur public/private şema çıktısı önceki çıktıyla aynıydı; yalnız pg_dump'ın rastgele restrict işaretleri karşılaştırma dışında tutuldu.
- Uzakta yalnız `20261015000100` ve `20261016000100` vardı. Beklenmeyen tablo/fonksiyon bulunmadı.
- Dosya SHA-256: `0CFDA337C009A96853E3CFCB247C267B18D4D946FDF1FC58A6A2AC9969FF77A4`. Yerel testteki ve uygulanan içerik aynı.
- CLI 2.120.0 `--dry-run --skip-vault` yalnız onaylanan dosyayı seçti. Sonra `db push --linked --project-ref nyoxbwandadakfagoner --skip-vault --yes` exit **0** ile tamamlandı. Seed, reset, repair veya başka migration kullanılmadı.
- Uygulama niyeti önce yerel dosyaya yazıldı; belirsiz sonuçta otomatik tekrar engellendi. Uzak geçmiş sonrasında tam olarak üç beklenen sürümü içeriyor.

## Canlı nesne ve güvenlik kontrolleri

| Kontrol | Gerçek sonuç |
| --- | --- |
| `private.analysis_requests` | 7 kolon, başlangıçta 0 satır |
| Kısıtlar | 5 doğrulanmış kısıt: bileşik PK, Auth FK/cascade ve 3 CHECK |
| İndeksler | PK dahil 4 indeks, tamamı valid |
| RLS | Etkin; istemciye izin veren politika yok |
| Doğrudan tablo yetkileri | anon/authenticated/service_role için SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER kapalı |
| RPC | `reserve_analysis_request`, `finish_analysis_request` |
| RPC sahibi | postgres |
| SECURITY DEFINER / search_path | Her ikisi true / boş search_path |
| EXECUTE | PUBLIC, anon, authenticated kapalı; service_role açık |
| Canlı/test edilmiş gövde | Normalize edilmiş iki `prosrc` özeti onaylanan SQL gövdeleriyle aynı |

Salt okunur transaction içinde gerçekten `SET LOCAL ROLE anon` ve `authenticated` yapıldı. Her rol için iki RPC çağrısı ve özel tablo SELECT denemesi **42501 insufficient_privilege** ile reddedildi: **6/6**. Bu sadece katalog boolean kontrolü değildir; gerçek veritabanı rol yetkileri kullanıldı. Kullanıcı JWT'siyle HTTP testi olarak sunulmaz. Read-only transaction beklenmeyen bir grant durumunda da kayıt yazımını engelleyecek şekilde kuruldu.

Kota, bellek sayacına değil kalıcı admission defterindeki zaman/sahiplik/istek kayıtlarına dayanır. Kullanıcı için kayan 24 saatte 5, proje için 100 deneme; diğer dakika/saat ve aktif lease sınırları sunucudadır. XP'nin İstanbul günündeki üç kazanım sınırı ayrıdır. Transaction advisory lock, kontrol ve rezervasyonu süreçler arasında atomik yapar; kullanıcı/istek PK'si aynı çağrının yeniden kabulünü önler. Başarısız/sona ermiş denemeler bütçeyi geri açmaz.

## Veri korunması

Migration öncesi ve sonrası tüm mevcut satırlar sunucuda sıralanmış JSON üzerinden özetlendi; satır içerikleri, e-posta, parola/token veya secret değerleri dışa aktarılmadı.

| Korunan nesne | Önce / sonra | Bütünlük |
| --- | --- | --- |
| waste_analyses | 1 / 1 | Aynı |
| private.xp_awards | 1 / 1 | Aynı |
| profiles | 1 / 1 | Aynı |
| auth.users | 1 / 1 | Aynı |

Mevcut tabloların kolon/kısıt/indeks/RLS/politika/tetikleyici tanımları, eski 13 fonksiyonun kaynak/yetkileri ve önceki migration satırlarının özetleri değişmedi. Yeni deftere canlı test satırı oluşturulmadı; mevcut kullanıcının kotası tüketilmedi.

## Yeniden çalıştırılan testler ve servis durumu

- Ağsız/geçici PostgreSQL 17: **235 SQL/RLS** ve **23 eşzamanlılık/backfill** kontrolü PASS. Bunların yeni kotaya ait bölümü **23 SQL + 6 çok bağlantılı yarış** kontrolüdür.
- Gerçek 8 bağlantıda aynı kullanıcı için tek admission; aynı request yarışında tek rezervasyon; 8 farklı kullanıcıda en fazla iki aktif admission doğrulandı. Bunlar izole test verisidir; canlı kullanıcıyla yarış testi değildir. Canlı RPC gövdeleri bu test edilen gövdelerle eşleştirildi.
- TypeScript/unit/tarayıcı/Android testleri sırf canlı DDL için yeniden yapılmış sayılmadı; önceki yerel kabul kayıtları kendi kapsamlarında kalır.
- Secret ad/digest metadatası işlem öncesi/sonrası **ANALYSIS_ENABLED=false** ile eşleşti. Gemini secret değeri görüntülenmedi. Fonksiyon **v12 ACTIVE / verify_jwt=true** kaldı; ACTIVE analiz özelliğinin açık olduğu anlamına gelmez.

**Sonuç: Onaylanan migration kapsamı PASS.** Normal kullanıcı analizi henüz canlıya açık değildir. Güncel Edge Function'ın kapalı deployment'ı/mod ayarı ve daha sonraki ücretli çağrı için ayrı onay gerekir.

Kanıtlar Git dışındaki `report-qa/quota-migration-*` dosyalarındadır. Salt okunur snapshot, yetki denemeleri, dry-run/uygulama seçimi ve kaynak eşlemesi ayrı kaydedildi.
