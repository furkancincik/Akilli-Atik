# Kimliği doğrulanmış kullanıcı modu: kapalı deployment

Doğrulama tarihi: 17 Ekim 2026 (Europe/Istanbul). Hedef yalnız `nyoxbwandadakfagoner`.

## Canlı sonuç

Kullanıcının açık onayıyla `ANALYSIS_ACCESS_MODE=authenticated` ayarlandı; `ANALYSIS_ENABLED=false` korundu. Supabase CLI 2.120.0 API bundler ile `analyze-waste` deploy edildi. Önce v12, ayar sonrasında v13, kod deployment sonrasında **v14 / ACTIVE / verify_jwt=true** doğrulandı. Diğer secret envanterinin özeti değişmedi; değerleri çıktıya alınmadı.

Üç migration ve mevcut tablo/kısıt/izin yapısı yeniden kontrol edildi. Deployment öncesi/sonrası veritabanı ve mevcut kullanıcı/analiz/XP/profil veri parmak izleri eşleşti. Özel kota defteri boş kaldı. İki kota RPC'sinin canlı gövdeleri test edilen SQL ile eşleşiyor. Anon ve authenticated rolleriyle iki RPC ve defter SELECT denemeleri **6/6 kez 42501** ile reddedildi. SECURITY DEFINER işlevleri boş search_path kullanıyor; EXECUTE yalnız service_role'a açık, istemci tablo yetkisi yok.

Kullanıcı doğrulaması uygulamada `/auth/v1/user` üzerinden, kota kabulünden önce yapılır. Kalıcı kota RPC'leri transaction/advisory lock ile eşzamanlı kabulü sınırlar; kullanıcı/istek kimliği ve görsel özeti tekrar kabulünü engeller. Yerel önceki koşum 235 SQL/RLS ve ayrıca 23 bağımsız bağlantı kontrolüdür; bu deployment adımında yerel SQL paketi yeniden çalıştırılmadı. Canlı doğrulama kaynak/yetki kontrolleridir; kota tüketen canlı kabul veya Gemini testi değildir.

## Gerçek HTTP kontrolleri

| İstek | Sonuç |
| --- | --- |
| Dört izinli origin OPTIONS | Her biri 204, tam origin ACAO |
| İzin verilmeyen origin OPTIONS / POST | İkisi de 403 ORIGIN_DENIED, ACAO yok |
| Doğru public anahtar, JWT yok, servis kapalı | 503 SERVICE_DISABLED |
| Bozuk / sahte JWT | İkisi de platform 401 |
| Yanlış / eksik public anahtar | İkisi de platform 401 |
| Anonim iki kota RPC çağrısı | İkisi de 401 / 42501 |

Toplam **13 beklenen HTTP sonucu** doğrulandı. Platformun 401 yanıtları `Access-Control-Allow-Origin: *` içeriyor; bu gateway davranışıdır. Fonksiyonun kendi CORS listesi dört kesin origin ile sınırlı kaldı. Kapalı servis denetimi uygulama Auth denetiminden erken döndüğünden **JWT'siz 503, JWT doğrulandığının kanıtı değildir**. Bu koşumda geçerli kullanıcı JWT'siyle test yapılmadı.

Fotoğraf gönderilmedi, Gemini çağrılmadı, analiz/kota kaydı oluşturulmadı. Normal mod canlıya deploy edildi; analizler kullanıma açılmadı.

## Bağımsız yerel tamamlama

Public arayüz modu `.env.example` ve Git dışındaki mevcut yerel yapılandırmada authenticated olarak seçildi; diğer yerel değerler korundu. Bu public bayrak sunucuyu açmaz. Eski süreli pilot arayüzü açıkça `test` seçilerek kullanılabilir.

SDK oturum okuması beklerken iptal/çıkışın isteği serbest bırakamaması giderildi. İlk oturum okuması, çıkış ve son kimlik kontrolü için üç regresyon testi önce zaman aşımıyla başarısız oldu; düzeltmeden sonra 3/3 geçti. Abonelikler temizleniyor; geç yanıt taşıma/sonuç gösterimini başlatamıyor. Normal istemci zaman aşımı, 90 saniyelik sunucu bütçesine pay bırakmak için 100 saniye; pilot 75 saniye kaldı. Bu değişiklik Edge deployment gerektirmiyor.

Güncel koşum: **333/333 unit**, uygulama/Edge TypeScript, ESLint ve production build PASS. Normal ScanPage iki görünümde **14/14** sentetik kimlik/fotoğraf kontrolünü dış istek olmadan geçti. Capacitor sync, çevrimdışı Gradle assembleDebug ve APK v2 imza kontrolü geçti. Son APK mevcut emülatöre kuruldu; **9/9 anonim gerçek WebView kontrolü**, dış istek 0. Test aracındaki URL/render bekleme yarışı giderilerek son koşum tekrarlandı; ilk başarısız deneme başarı sayılmadı.

APK: `android/app/build/outputs/apk/debug/app-debug.apk`, **9.897.335 bayt**. SHA256: `D910706A99B1F04A5350CFF0F0FC98B3A4AA0E61DD0B86AC51C14801DC6E61E2`.

## Açık kabul maddeleri

Gerçek kullanıcı JWT'siyle normal aktif analiz/kota/kayıt akışı henüz sınanmadı. Etkinleştirme, yeni fotoğraf gönderimi ve kalıcı kayıt için ayrıca izin gerekir. Fiziksel Android cihaz, oturum açılmış native uçtan uca akış ve tüm gerçek e-posta kurtarma senaryoları açık. Önceki native kamera/galeri kontrolleri bu koşumda tekrarlanmadı. Ana JS 500 kB ve Gradle flatDir uyarıları sürüyor; gizlenmedi. Canlı analiz kapalı kalmıştır.
