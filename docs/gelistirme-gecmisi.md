# Geliştirme Geçmişi

Bu belge önceki aşamaların tarihsel teknik raporlarını korur. Eski eksiklikler güncel durum değildir; güncel kapsam ve doğrulama sonuçları için [README](../README.md) esas alınmalıdır. Kullanıcıya özel yerel yollar genelleştirilmiştir.

# Smart Waste AI

Yapay zekâ destekli akıllı atık ayrıştırma ve geri dönüşüm asistanı. Phase 1 web arayüzü ve Phase 1.1 Capacitor Android paketleme altyapısı. Android uygulama adı **Akıllı Atık**, uygulama kimliği **com.akilliatik.app**.

## Kurulum

Node.js 22.12+ veya 24 LTS ve npm gerekir. Bu çalışma Node.js 24.18.0 / npm 11.16.0 ortamında hazırlanmıştır.

```powershell
cd <PROJE_DIZINI>
npm install
npm run dev
```

Terminalde gösterilen yerel adresi açın (varsayılan: http://localhost:5173). Phase 1 için `.env` veya herhangi bir harici hesap gerekmez.

```powershell
npm run typecheck
npm run lint
npm run build
npm run preview
```

`preview`, üretim çıktısını yerelde gösterir; production sunucusu değildir. Yayın ortamında tüm uygulama rotaları `index.html` dosyasına yönlendirilmelidir (SPA fallback).

## Teknolojiler

React, TypeScript strict mode, Vite, Tailwind CSS (resmî Vite eklentisi), React Router, Lucide React ve Supabase JavaScript istemcisi. ESLint, React Hooks ve React Refresh kontrolleri geliştirme bağımlılıklarıdır. Kilit dosyası oluşturulduğunda sonraki tekrarlanabilir kurulumlar için `npm ci` kullanılabilir.

## Dosya yapısı

```text
src/
  components/       # Layout, PageIntro, EmptyState
  data/             # Sekiz temel atık kategorisi
  pages/            # Ana sayfa, tarama, geçmiş, istatistikler, giriş, 404
  services/         # Supabase istemci fabrikası
  App.tsx           # Uygulama rotaları
  main.tsx          # React başlangıç noktası
  styles.css        # Tailwind importu ve responsive arayüz stilleri
.env.example
.gitignore
eslint.config.js
index.html
package.json
tsconfig*.json
vite.config.ts
capacitor.config.ts  # Android adı, kimliği, dist ve safe area ayarları
android/            # Native Android / Gradle projesi
```

## Phase 1 kapsamı

- `/`: Ana sayfa, geri dönüşüm bilgilendirmesi ve kategori kartları.
- `/tara`: Devre dışı kamera ve yükleme kontrolleri; fotoğraf alınmaz.
- `/gecmis`: Açıklayıcı boş durum; sorgu yapılmaz.
- `/istatistikler`: Veri kaynağının henüz bağlı olmadığını gösterir; sahte sayılar veya grafikler yoktur.
- `/giris`: Devre dışı giriş alanları; kullanıcı bilgisi alınmaz.
- Bilinmeyen adresler için 404 ekranı.
- Mobil navigasyon, ortak düzen, klavye odak stilleri ve içeriğe geç bağlantısı.

Gerçek analiz, dosya yükleme, veritabanı tabloları, authentication ve kullanıcı işlemleri uygulanmamıştır. Supabase istemcisi modül importunda oluşturulmaz; `createConfiguredSupabaseClient()` eksik/geçersiz ayarlarda `null` döndürür ve uygulama bu fonksiyonu Phase 1'de çağırmaz.

## Sonraki aşama yapılandırması

Gerektiğinde `.env.example` dosyasını `.env.local` olarak kopyalayın. Yalnızca Supabase proje URL'sini ve herkese açık publishable/anon anahtarını ekleyin. `VITE_` değişkenleri tarayıcı paketine dahil edilir. Gemini API anahtarı ve Supabase secret/service_role anahtarı frontend'e eklenmemelidir. `.env*` dosyaları `.env.example` dışında Git tarafından yok sayılır.

## Phase 2 önerisi (onay sonrası)

1. Supabase projesini yapılandırın; e-posta/parola kayıt, giriş ve oturum yönetimini ekleyin.
2. Analiz tablosunu ve kullanıcıya özel Row Level Security politikalarını hazırlayın; farklı kullanıcıların birbirinin kayıtlarına erişemediğini doğrulayın.
3. Gemini çağrılarını kimlik doğrulaması, dosya boyutu/türü sınırları ve hata yönetimi olan Supabase Edge Function üzerinden yapın. API anahtarını yalnızca sunucu secret olarak saklayın.
4. Fotoğraf yükleme/kamera, analiz sonucu, belirsizlik uyarısı ve kullanıcı düzeltmesini ekleyin; doğrulanmamış güven yüzdesi üretmeyin.
5. Gerçek kayıtlardan geçmiş ve kategori istatistiklerini gösterin.

Harita, puan/rozet ve topluluk sıralaması bu aşamaların dışındadır. Phase 2 kullanıcı onayı olmadan başlatılmaz.

## Phase 1 doğrulama raporu — 9 Ekim 2026

- Çalışma klasörü başlangıçta boştu; Node.js, npm ve Git kontrol edildi.
- `npm create vite` ilk denemesi sandbox DNS kısıtlaması nedeniyle başarısız oldu. Vite proje dosyaları doğrudan oluşturuldu; ağ erişimiyle `npm install` başarıyla tamamlandı ve `package-lock.json` üretildi.
- `npm run typecheck`: başarılı.
- `npm run lint`: başarılı.
- `npm run build`: başarılı; üretim çıktısı `dist/` altında oluşturuldu.
- `npm run dev`: sunucu başarıyla başladı. Tarayıcı doğrulaması için http://127.0.0.1:5174 adresinde çalıştırıldı.
- Tarayıcıda ana sayfa ve dört navigasyon bağlantısı doğrulandı; tarama ve giriş kontrolleri devre dışı. Kontrol edilen sayfalarda console error/warn görülmedi.
- Ana sayfa 390 × 844 mobil görünümde kontrol edildi; yatay taşma görülmedi.
- Supabase, Gemini ve authentication entegrasyonları kapsam gereği çalıştırılmadı; harici kimlik bilgisi gerekmiyor.
- Otomatik birim veya uçtan uca test paketi bu aşamada eklenmedi.

## Kaynaklar

- [Vite kurulum dokümantasyonu](https://vite.dev/guide/)
- [Tailwind CSS Vite entegrasyonu](https://tailwindcss.com/docs/installation/using-vite)

## Phase 1.1 — Android uygulaması

Mevcut React, TypeScript, Vite ve BrowserRouter korunmuştur. Capacitor `core`, `android` ve geliştirme bağımlılığı `cli` aynı **8.5.3** sürümündedir. Resmî `@capacitor/app` **8.1.2**, Android geri düğmesinin WebView / React Router geçmişine dönmesini sağlayan varsayılan native işleyicisi için eklenmiştir; özel bir backButton dinleyicisi varsayılan davranışı değiştirmez. Cihaz üzerinde geri düğmesi davranışı henüz test edilmedi.

`capacitor.config.ts` içindeki `webDir: "dist"` nedeniyle uygulama web çıktısını APK içine alır. `server.url`, açık HTTP veya live reload yapılandırması yoktur; arayüz açılmak için bilgisayardaki Vite sunucusuna ihtiyaç duymaz. İlerideki Supabase ve Gemini işlemleri internet gerektirecektir. Android minimum API 24 (Android 7), compile/target API 36'dır.

### Bu bilgisayarda gerekli kurulum

Kontrol sırasında Java/ADB komutları ve `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT` bulunmadı; Android Studio ve SDK standart konumlarda mevcut değildi. Bu araçlar otomatik kurulmadı.

1. [Resmî Android Studio indirme sayfasından](https://developer.android.com/studio) **2025.2.1 veya üzeri** Android Studio kurun. Kurulumun sağladığı JDK'yı kullanın; bu proje Java 21 hedefler.
2. Android Studio → **SDK Manager** içinde **Android SDK Platform 36**, **Android SDK Build-Tools 36.0.0**, **Android SDK Platform-Tools** ve **Android SDK Command-line Tools (latest)** kurun. Lisans adımlarını tamamlayın. Emülatör kullanacaksanız Android Emulator ve uygun bir sistem imajı da gerekir.
3. Android Studio'da **Open** ile bu projenin `android` klasörünü açın. Gradle JDK ayarını Java 21 uyumlu kurulu JDK'ya yönlendirin ve Gradle sync tamamlanmasını bekleyin. SDK yolunu Android Studio belirler; `android/local.properties` yerel ayardır ve Git'e dahil edilmez.
4. Terminalde APK üretmek için `JAVA_HOME` kurulu JDK dizinine, `ANDROID_HOME` SDK dizinine işaret etmelidir. `PATH` içine JDK `bin` ve SDK `platform-tools` dizinlerini ekleyin. Gerçek yolları Android Studio ayarlarından kontrol edin. Ortam değişkenleri değiştikten sonra yeni bir terminal açın; `java -version` ve `adb version` ile doğrulayın.

SDK/JDK kurulumu sonrasında:

```powershell
cd <PROJE_DIZINI>
npm ci
npm run android:sync
npm run android:open
```

`android:sync`, önce TypeScript ve Vite build çalıştırır, ardından web çıktısını ve eklentileri Android'e kopyalar. Her web veya eklenti değişikliğinden sonra tekrar çalıştırın. `android:open` yalnızca Android Studio'yu açar.

### Telefon veya emülatörde çalıştırma

Telefonun geliştirici seçeneklerinden **USB hata ayıklama** açın, USB ile bağlayın ve telefondaki bilgisayar yetkilendirmesini onaylayın. Windows'ta cihaz üreticisinin USB sürücüsü gerekebilir. `adb devices` çıktısında cihazın `device` durumunda olduğunu kontrol edin. Emülatör kullanıyorsanız önce Device Manager üzerinden başlatın.

Android Studio'da cihazı seçip **Run** düğmesine basın veya:

```powershell
npm run android:run
```

Bu komut güncel web çıktısını senkronize eder ve Capacitor üzerinden cihaz seçerek derleme/kurulum başlatır. APK üretmek için Windows'ta:

```powershell
npm run android:apk
```

Debug APK, başarılı derleme sonrasında `android/app/build/outputs/apk/debug/app-debug.apk` altında oluşur. Bağlı cihazınıza `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` ile kurulabilir. Bu debug paketidir; mağaza dağıtımı için release imzalama daha sonraki aşamada yapılmalıdır. Gradle wrapper projeye dahildir; ayrıca global Gradle kurulumu gerekmez. İlk native derlemede Gradle/Maven indirmeleri için internet gerekir.

### Safe area ve dokunmatik kullanım

- `viewport-fit=cover` ve Capacitor'ın yerleşik SystemBars CSS inset desteği etkin. Gövdeye üst/alt/sağ/sol safe area boşlukları uygulanır; web için `env(safe-area-inset-*)` yedeği vardır. Eski WebView sürümlerindeki native padding yönetimi Capacitor tarafından yapılır.
- `100dvh` ile ekran yüksekliği izlenir. Yatay görünümde yan navigasyon kaydırılabilir. Android sistem çubukları açık tema ile uyumludur.
- Ana navigasyon, butonlar ve üst/istatistik bağlantıları en az 48 px yüksekliğe sahiptir. Dokunma için `touch-action: manipulation` kullanılır; yakınlaştırma engellenmez. Giriş alanları 16 px yazı ve 48 px minimum yükseklik kullanır.
- Beş ekran 320 × 740, 390 × 844 ve 844 × 390 tarayıcı görünümlerinde kontrol edildi: yatay taşma yok, ölçülen ana dokunma hedefleri en az 48 px, console error/warn kaydı yok. Bu kontroller native WebView, çentik veya Android sistem çubuklarının gerçek cihaz testinin yerine geçmez.

SDK kurulduktan sonra gerçek cihazda kontrol edin: çentik ve sistem çubukları altında içeriğin görünmesi, dikey/yatay dönüş, beş ekran arasında gezinme, Android geri düğmesi, uygulamayı kapatıp yeniden açma, büyük sistem yazı boyutu ve ağ olmadan arayüz açılışı. Kamera ve giriş bu aşamada devre dışı kalmalıdır.

### Phase 1.1 sırasında sonraki kamera entegrasyonunun gereksinimleri (tarihsel)

Camera eklentisi henüz kurulmadı; kamera veya galeri izinleri manifeste eklenmedi. Onaylanan sonraki aşamada Capacitor 8 ile uyumlu `@capacitor/camera@8` kurulup `npm run android:sync` çalıştırılmalıdır.

Resmî Camera eklentisi sistem kamera uygulamasını/Photo Picker'ı kullanır; varsayılan olarak galeriye kaydetmeden ek Android izni gerektirmez. `saveToGallery: true` seçilirse sürüme bağlı storage izinleri gerekir; eski Android için READ izin sınırı API 32, WRITE sınırı API 29'dur. Bunları yalnızca gerçekten gereken özellik için ekleyin. Photo Picker bulunmayan cihazlarda sistem dosya seçicisi yedeği kullanılabilir.

Kamera işlemi uygulamanın dışında Activity açar. İşletim sistemi uygulamayı kapatırsa sonucu geri almak için App eklentisinin `appRestoredResult` olayı ele alınmalıdır. Kullanıcının iptal etmesi, erişimin reddedilmesi, kameranın bulunmaması, fotoğraf boyutu/türü ve geçici URI ömrü de yönetilmelidir. Fotoğraf edinme ile güvenli sunucu analizi ayrı servisler olarak tasarlanmalı; Gemini anahtarı APK içine konmamalıdır. Bu işlevler henüz uygulanmadı.

### Phase 1.1 doğrulama raporu — 9 Ekim 2026

| Kontrol | Sonuç |
| --- | --- |
| Capacitor npm kurulumu / sürüm uyumu | Başarılı |
| `npx cap add android` | Başarılı; Android projesi üretildi |
| TypeScript (`npm run typecheck`) | Başarılı; Capacitor config kontrol kapsamına dahil |
| ESLint (`npm run lint`) | Başarılı |
| Production build (`npm run build`, sync scripti içinde) | Başarılı |
| `npm run android:sync` | Başarılı; güncel dist ve App eklentisi senkronize |
| Android `gradlew.bat assembleDebug` | Başarısız: JAVA_HOME ayarlı değil ve java PATH'te yok |
| APK / emülatör / gerçek cihaz testi | Yapılmadı; SDK/JDK araçları mevcut değil |

Git commit/push yapılmadı. Gemini, authentication, gerçek fotoğraf analizi veya sonraki aşama başlatılmadı. Native Gradle şablonunun test dosyaları üretildi ancak çalıştırılmadı.

### Mobil kaynaklar

- [Capacitor ortam gereksinimleri](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Capacitor yapılandırması](https://capacitorjs.com/docs/config)
- [Capacitor App eklentisi](https://capacitorjs.com/docs/apis/app)
- [Capacitor Camera gereksinimleri](https://capacitorjs.com/docs/apis/camera)

## Phase 1.2 — İlk debug APK, 9 Ekim 2026

Android debug APK üretildi. `npm run android:apk` komutu web build, Capacitor sync ve Gradle `assembleDebug` adımlarını tamamladı: **BUILD SUCCESSFUL**, 123 görev, 4 dakika 11 saniye. Çıktı:

```text
<PROJE_DIZINI>\android\app\build\outputs\apk\debug\app-debug.apk
```

Dosya boyutu **4.228.953 bayt** (yaklaşık 4,03 MiB). SHA256:

```text
3C555F5730436F7AE7FDB4748D6217E713ABC92D9F1C37F489CACBDF410C1223
```

Android `apksigner verify --verbose` kontrolü başarılı (v2 imzası). `aapt dump badging` ile uygulama adı **Akıllı Atık**, kimlik **com.akilliatik.app**, minimum SDK **24**, hedef SDK **36** ve MainActivity doğrulandı. Bu, derleme ve paket doğrulamasıdır; cihazda çalışma testi yapılmadı.

### Kurulu ortam

| Bileşen | Sürüm / konum |
| --- | --- |
| Temurin JDK | 21.0.12.1+1; winget paket sürümü 21.0.12.101 |
| Android Studio | 2026.2.1.8; build AI-262.9437.185.2621.16467767 |
| SDK Command-line Tools | 19.0, Java tabanlı sdkmanager |
| SDK Platform | Android 16 / API 36, revizyon 2 |
| SDK Build-Tools | 35.0.0 ve 36.0.0 |
| SDK Platform-Tools | 37.0.1; ADB 1.0.41 |
| Gradle / AGP | 8.14.3 / 8.13.0 |
| JAVA_HOME (kullanıcı) | <JDK21_DIZINI> |
| ANDROID_HOME (kullanıcı) | <ANDROID_SDK_DIZINI> |

JDK `bin`, SDK `platform-tools` ve Command-line Tools `19.0/bin` kullanıcı PATH'ine eklendi. Eski açık terminaller değişiklikleri otomatik almaz; yeni terminal açın. `android/local.properties` SDK yolunu içerir ve Git tarafından yok sayılır. Android Studio'nun beraberindeki Java 25 yerine **projenin Gradle JDK ayarını Temurin 21** olarak seçin.

### Kurulum sorunları ve doğrulamalar

- JDK winget ile kuruldu. Android Studio'nun winget indirmesi Google yönlendirme adresinde takıldı; aynı resmî paket `dl.google.com` adresinden indirildi ve winget manifestindeki SHA256 ile doğrulandı.
- Android Studio sessiz kurulum işlemi **1223** (iptal) çıkış kodu verdi. Buna rağmen IDE'nin Windows kurulum kaydı, `studio64.exe`, product-info, başlatma JAR dosyaları ve beraberindeki Java runtime mevcut ve doğrulandı. IDE grafik arayüzü bu çalışmada açılarak test edilmedi; çıkış kodu başarılı olarak kabul edilmedi.
- Command-line Tools 23'ün yeni Android CLI başlatıcısı Windows'ta başarısız oldu. Google deposundaki kararlı Tools 19 arşivi sağlama değeriyle doğrulanıp kullanıldı. SDK bileşenleri bununla başarıyla kuruldu; kullanıcının önceki açık onayıyla gerekli `android-sdk-license` kabul edildi.
- TypeScript, ESLint, production build, Capacitor sync ve Gradle APK üretimi başarılı. Native birim/instrumentation testleri çalıştırılmadı.
- Capacitor şablonundan kaynaklanan `flatDir` ve Java unchecked-operation uyarıları görüldü; APK derlemesini engellemedi.
- ADB cihaz listesi boş; emülatör ve sanal cihaz mevcut değil. Telefon/emülatör çalıştırma testi **yapılmadı**. Kamera, Gemini ve authentication geliştirilmedi; commit/push yapılmadı.

### APK'yı telefona kurma

Android 7 veya üzeri telefonunuzda geliştirici seçenekleri ve USB hata ayıklamayı etkinleştirin. Bilgisayara bağlayıp telefondaki yetkilendirme isteğini onaylayın. Yeni PowerShell terminalinde:

```powershell
cd <PROJE_DIZINI>
adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Cihaz `device` durumunda görünmelidir. Alternatif olarak APK'yı telefona aktarın, dosyayı açın ve kullandığınız dosya yöneticisinin uygulama yükleme iznini verin. Bu debug APK'dır; release/mağaza imzalama henüz yapılmadı.

## Phase 2 — Kamera ve fotoğraf seçimi, 9 Ekim 2026

`@capacitor/camera` 8.2.5 eklendi. Atık Tarama ekranında Android sistem kamerasından fotoğraf çekme, sistem galerisinden tek fotoğraf seçme, önizleme, değiştirme ve kaldırma uygulanmıştır. Tarayıcıda dosya seçicisi kullanılır; kamera açılması tarayıcı/cihaz desteğine bağlıdır. Tasarım ve mevcut rotalar korunmuştur.

Fotoğraflar bu oturumda bellekte tutulur; sayfalar arasında gezinirken korunur, uygulama yeniden açılınca saklanmaz. Sunucuya yükleme, Gemini analizi, sahte analiz sonucu veya Supabase işlemi eklenmedi. Android kamera Activity'si sırasında işletim sistemi uygulamayı kapatırsa `appRestoredResult` ile dönen fotoğraf ele alınır. Bu kurtarma akışı gerçek cihazda henüz test edilmedi.

### Fotoğraf kontrolleri

- JPG, PNG ve WebP dosya imzaları kontrol edilir; uzantıya güvenilmez. Bozuk görüntüler Türkçe hata ile reddedilir.
- Okunan dosya en fazla 20 MiB olabilir. Native dönen dosyanın metadata boyutu ve okuma sırasında toplam bayt sayısı kontrol edilir. Eklenti orijinali önceden küçültebilir; sınır uygulamanın okuduğu dosya içindir.
- Görüntü oranı korunur; uzun kenar en fazla 1600 px, JPEG kalitesi %85 ve çıktı en fazla 5 MiB'dir. 64 milyon pikseli aşan görüntüler reddedilir; küçük fotoğraflar büyütülmez.
- İptal veya başarısız değiştirme mevcut fotoğrafı korur. İzin reddi, kamera bulunmaması ve dosya hataları Türkçe mesajlarla ele alınır. İşlem sürerken düğmeler devre dışıdır; kaldırılan/değiştirilen önizleme URL'leri serbest bırakılır.
- Fotoğraf galeriye kaydedilmez (`saveToGallery: false`). Sistem kamera/Photo Picker kullanımına gereksiz CAMERA veya storage manifest izni eklenmedi.

### Değişen kaynaklar

`src/services/photos.ts` fotoğraf edinme ve hazırlama; `src/services/photoValidation.ts` dosya/ölçü/hata kontrolleri; `src/hooks/usePhotoCapture.ts` durum, önizleme ve native kurtarma; `src/pages/ScanPage.tsx` kullanıcı arayüzü. Ayrıca `src/App.tsx`, `src/pages/HomePage.tsx`, stil dosyası, `package.json`, `package-lock.json`, `eslint.config.js` ve bu README güncellendi. `tests/photoValidation.test.ts` doğrulama testleri eklendi. Capacitor sync Camera eklentisinin Android kayıtlarını güncelledi.

### Doğrulama sonuçları

| Kontrol | Sonuç |
| --- | --- |
| `npm run typecheck` | Başarılı |
| `npm run lint` | Başarılı; üretilen Android çıktıları lint kapsamından çıkarıldı |
| `npm test` | Başarılı, 6 test; Node.js 24 ile çalıştırıldı |
| Production build | Başarılı, `android:apk` içindeki sync adımında |
| Capacitor sync | Başarılı; Camera 8.2.5 dahil |
| Gradle `assembleDebug` / `npm run android:apk` | Başarılı; son derleme 157 görev, 5 saniye |
| APK dosyası / `apksigner verify` | Dosya mevcut, imza doğrulaması başarılı |
| Tarayıcı dosya seçimi ve önizleme | 2400 × 1200 px test PNG'si 1600 × 800 px JPEG olarak önizlendi |
| Android cihaz / emülatör kamera, galeri, izin ve kurtarma | Yapılmadı; ADB cihaz listesi boş, emülatör yok |

Altı test dosya boyutu sınırlarını, gerçek dosya imzalarını, oran/boyut sınırlarını, iptal durumlarını, izin/kamera hatalarını ve platform hata ayrıntılarının kullanıcıya gösterilmemesini kapsar. Native birim/instrumentation testleri çalıştırılmadı. Gradle `flatDir` ve native kitaplıkların strip edilmeden paketlenmesi uyarıları derlemeyi engellemedi.

### Güncel Phase 2 APK

```text
<PROJE_DIZINI>\android\app\build\outputs\apk\debug\app-debug.apk
```

Boyut: **9.896.425 bayt** (yaklaşık **9,44 MiB**). SHA256:

```text
FF45B716479E5131E5CA5D75D335FEFC42934B1318616A49CC03681C0BC4F5AA
```

Yeniden üretmek için `npm run android:apk`; USB hata ayıklama ile bağlı telefona kurmak için `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` kullanın. Yukarıdaki Phase 1.2 APK boyutu ve hash'i eski pakete aittir.

Telefonda Atık Tara ekranında şu akışları kontrol edin: fotoğraf çekme ve iptal, galeriden seçim ve iptal, önizleme yönü/oranı, fotoğraf değiştirme/kaldırma, sayfalar arası gezinme, erişim reddedildiğinde mesaj, büyük/bozuk dosya, dikey/yatay ekran ve kamera açıkken uygulamanın işletim sistemi tarafından kapatılması. Özellikle kamera ve galeri erişimi ancak bu testlerden sonra cihazda doğrulanmış sayılabilir.

Git commit/push yapılmadı. Phase 3 başlatılmadı; kullanıcı onayı beklenir.

## Phase 3 — Gemini ile atık analizi, 9 Ekim 2026

**Kod ve debug APK hazır; canlı Supabase deployment ve gerçek Gemini çağrısı henüz yapılmadı.** Depoda yalnız `.env.example` var. Supabase proje URL/ref bilgisi, public publishable/anon anahtarı ve sunucuda `GEMINI_API_KEY` secret eksik. Önceki aşamaların yukarıdaki notları tarihsel raporlardır.

### Mimari ve çalışma akışı

Fotoğraf → mevcut Phase 2 hazırlama servisi (JPEG, en fazla 1600 px/5 MiB) → kullanıcı **Yapay Zekâ ile Analiz Et** düğmesi → HTTPS ile `analyze-waste` Supabase Edge Function → Gemini REST `generateContent` → sunucu JSON doğrulama/güvenlik kuralları → istemci JSON doğrulama → Türkçe sonuç kartı.

Frontend yalnız Edge Function'a ham JPEG gönderir; Gemini anahtarı, Google API çağrısı ve prompt frontend bundle'ında bulunmaz. Ek SDK/bağımlılık, Python backend, Authentication, veritabanı kaydı, Storage yüklemesi, puan veya harita eklenmedi. Ağ isteği yalnız analiz düğmesine basıldığında başlar. Uygulama analiz geçmişini kaydetmez; sağlayıcının veri işleme politikası ayrıca geçerlidir.

Varsayılan model `gemini-3.5-flash-lite`: güncel resmî model sayfasında görüntü girişi, yapılandırılmış çıktı ve kararlı model olarak listelenir. `GEMINI_MODEL` sunucu secret ile değiştirilebilir. Gemini 2.5 için yeni projelerde erişim sınırlaması bildirildiğinden yeni kurulumun varsayılanı olarak kullanılmadı. Model erişimi ve hesabın kotası gerçek çağrıda henüz doğrulanmadı.

### Yanıt sözleşmesi ve güvenlik

JSON alanları: `success`, `wasteName`, `category`, `description`, `sortingInstruction`, `recyclingAdvice`, `safetyWarning`, `objectCount`, `uncertain`, `hazardous`. Kategoriler: Plastik, Cam, Kâğıt/Karton, Metal, Organik, Elektronik, Pil, Diğer. Alanların varlığı, türü, uzunluğu, kategori ve başarı/nesne tutarlılığı kontrol edilir; ek alanlar (güven yüzdesi dahil) reddedilir. Kesilmiş veya bloklanmış Gemini yanıtı başarı sayılmaz.

Atık ayırt edilemiyorsa `success=false`, isim/kategori null, `objectCount=none`; ayrıştırma/geri dönüşüm talimatları boş olur. Birden fazla nesnede sonuç yalnız baskın nesne için gösterilir; kullanıcı diğer nesneleri ayrı çekmesi için bilgilendirilir. Belirsizlik ayrıca gösterilir; güven yüzdesi yoktur.

Pil, elektronik, modelin tehlikeli işareti veya riskli nesne adına rastlanırsa modelin açıklama ve işlem talimatları sabit ihtiyatlı içerikle değiştirilir: evsel çöpe/normal geri dönüşüme atma, sökme/delme/yakma; uygun yetkili toplama yöntemini doğrula. Bu kurallar yanlış görsel sınıflandırmayı tamamen engelleyemez. Yerel kuralların doğrulanması sonuç kartında belirtilir.

Sunucuda JPEG yapısı/ölçüsü ve 5 MiB sınırı, akış okunurken de uygulanır; dosyanın gerçekten çözümlenmesi Gemini'ye aittir. JSON/API yanıtı en fazla 64 KB, model JSON metni en fazla 16.000 karakterdir. İstek gövdesi okuma süresi 10 sn, Gemini çağrısı 35 sn, istemci toplam süresi 50 sn ile sınırlıdır. Fotoğraf değiştiğinde veya sayfadan çıkıldığında istemci isteği iptal edilir; eski sonuç yeni fotoğrafa gösterilmez.

İnternet yokluğu, bağlantı hatası, eksik/geçersiz API anahtarı, servis hatası, kota/istek sınırı, zaman aşımı, geçersiz fotoğraf/JSON ve atık bulunamaması Türkçe mesajlarla ele alınır. Sunucu exception ayrıntıları, fotoğraflar, secret'lar veya sağlayıcı hata gövdeleri loglanmaz/istemciye döndürülmez.

### Anonim erişimin sınırı

Bu aşamada kullanıcı girişi yoktur. `verify_jwt=false`; handler `apikey` değerini projenin public anahtarlarıyla karşılaştırır. Bu değer APK'dan çıkarılabilir ve **kullanıcı doğrulaması değildir**. CORS yalnız tanımlı origin'lere izin verir; tarayıcı dışı kötüye kullanımı engellemez.

Her Edge isolate için IP başına dakikada 3 istek, toplam saatte 30 istek ve 2 eşzamanlı çağrı sınırı vardır. Sayaçlar bellektedir; yeniden başlatmada sıfırlanır ve başka isolate'larla paylaşılmaz. Forwarded IP de yalnız en iyi çaba kısıtıdır. Dolayısıyla dağıtık/sürekli bir maliyet kotası garanti edilmez. Canlı kullanımı etkinleştirmeden önce Google proje/API kotasını kısıtlayın; bütçe uyarısının sert harcama sınırı olmadığını dikkate alın. Geniş dağıtımdan önce kalıcı hız sınırı veya doğrulanabilir cihaz/kullanıcı erişimi gerekir; bu aşamada ek servis/Authentication uygulanmadı. `ANALYSIS_ENABLED` varsayılan olarak kapalıdır; pilot test için açıkça `true` yapılmalıdır.

### Canlı kurulum için kullanıcıdan gerekenler

1. Supabase proje URL'si veya project ref ve **herkese açık** publishable/anon anahtarı. Secret/service_role frontend anahtarı olarak kabul edilmez.
2. Gemini anahtarını **sohbete yazmadan** Supabase Dashboard → Edge Functions → Secrets bölümünde `GEMINI_API_KEY` adıyla kaydedin. Hesaptaki görüntü destekli model erişimi ve kotasını doğrulayın.
3. Supabase CLI hesabına giriş ve ilgili projeye deployment erişimi; mevcut ortamda Supabase CLI/Deno kurulu değil. Bunlar bu çalışmada yüklenmedi, hesapta işlem yapılmadı.

Frontend için kökte `.env.local` oluşturun (Git ignore kapsamında):

```dotenv
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=PUBLIC_PUBLISHABLE_OR_ANON_KEY
```

Gerçek Gemini anahtarını buraya veya başka bir `VITE_*` değişkenine koymayın. `supabase/functions/.env.example` yalnız yerel Edge çalışma örneğidir. Gerçek secret dosyaları `.gitignore` kapsamındadır; secret değerlerini komut satırı geçmişine yazmak yerine Dashboard kullanın.

Supabase CLI erişimi hazır olduğunda proje kökünde (komutlar bu çalışmada **çalıştırılmadı**):

```powershell
npx supabase login
npx supabase functions deploy analyze-waste --project-ref PROJECT_REF
```

CLI `supabase/config.toml` dosyasındaki `verify_jwt=false` ve entrypoint ayarını kullanır. Function secrets:

| Secret | Değer / amaç |
| --- | --- |
| `GEMINI_API_KEY` | Gerçek anahtar; yalnız sunucuda |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` (varsayılan) |
| `ANALYSIS_ENABLED` | Kurulum/kota kontrolü sonrası pilot için `true`; kapatmak için `false` |
| `ALLOWED_ORIGINS` | `https://localhost,http://localhost,capacitor://localhost` ve virgülle eklenen gerçek web origin'leri |
| `ANALYSIS_PUBLIC_KEY` | Runtime public anahtarları sağlamıyorsa frontend'deki aynı public anahtar |

Handler runtime'ın `SUPABASE_ANON_KEY` ve `SUPABASE_PUBLISHABLE_KEYS` değerlerini de kullanır. Geliştirme için örneğin `http://localhost:5173`; farklı port kullanıyorsanız tam origin ekleyin. `*` kullanmayın. Dashboard'da API anahtarını tanımlayıp deploy/ayarları tamamladıktan sonra `npm run android:apk` ile frontend public yapılandırmasını APK'ya alın.

Canlı test: hassas bilgi içermeyen gerçek bir atık fotoğrafıyla düğmeye basın; sunucu/Google çağrısı ve gerçek sonuç kartını doğrulayın. Sonra pil/elektronik, birden fazla nesne, atık olmayan görüntü, bağlantı kesilmesi ve tekrar analiz akışlarını kontrol edin. Bu adımlar tamamlanmadan canlı entegrasyon doğrulanmış sayılmaz.

### Değişen dosyalar

- Edge Function: `supabase/config.toml`, `supabase/functions/analyze-waste/{index,handler,gemini}.ts`, ortak `supabase/functions/_shared/{analysis,image}.ts`, `runtime.d.ts`, `.env.example`.
- Arayüz: `src/pages/ScanPage.tsx`, `src/pages/HomePage.tsx`, `src/components/AnalysisResult.tsx`, `src/hooks/useWasteAnalysis.ts`, `src/services/analysis.ts`, `src/services/supabase.ts`, `src/services/supabaseConfiguration.ts`, `src/styles.css`.
- Kontroller/dokümantasyon: `tests/analysis.test.ts`, `tests/supabaseConfiguration.test.ts`, `tsconfig.edge.json`, `tsconfig.app.json`, `package.json`, kök `.env.example`, `README.md`; Capacitor sync Android varlıklarını güncelledi. Phase 2 fotoğraf servisi/hook'u korundu. Yeni proje bağımlılığı eklenmedi.

### Test ve APK raporu

| Kontrol | Sonuç |
| --- | --- |
| `npm run typecheck` | Başarılı; React ve Edge TypeScript kontrolü |
| `npm run lint` | Başarılı |
| `npm test` | **29/29 başarılı**; gerçek Google/Supabase çağrısı kullanılmadı |
| Production build | Başarılı; `android:apk` içinde |
| Capacitor sync | Başarılı; App ve Camera eklentileri |
| Android Gradle `assembleDebug` | **BUILD SUCCESSFUL**, 3 sn; 157 görev, 27 executed / 130 up-to-date |
| Debug APK ve imza | Dosya mevcut; `apksigner verify --verbose` v2 başarılı |
| Frontend bundle kontrolü | Sunucu API adresi/anahtar header'ı, Deno env ve Gemini secret değişkeni bulunmadı |
| Canlı deployment / gerçek Gemini analizi | **Yapılmadı**; proje ve secret bilgileri eksik |
| Supabase Deno/yerel Edge runtime | **Çalıştırılmadı**; CLI/Deno yok. Handler HTTP testleri Node'da, runtime giriş noktası tsc ile kontrol edildi |
| Android cihaz/emülatör testi | **Yapılmadı**; ADB cihaz listesi boş |

Testler geçerli/bozuk JSON, kategori/alan/tür sınırları, atık bulunamaması, çoklu/belirsiz nesne, pil/elektronik güvenlik kuralları, kota/erişim/timeout hataları, Gemini istek şeması, Edge HTTP akışı/CORS/anahtar/limitler, fotoğraf doğrulama ve frontend'e secret/service_role konulmasının reddini kapsar. Test fixture sonuçları yalnız `tests` içindedir; uygulamada sahte sonuç veya fallback analiz yoktur. Deno için minimal tip bildirimi gerçek Supabase runtime testi yerine geçmez.

Güncel APK:

```text
<PROJE_DIZINI>\android\app\build\outputs\apk\debug\app-debug.apk
```

Boyut **9.896.425 bayt (9,44 MiB)**. SHA256:

```text
275E207D8E2CF043E87BBAA4B9CB3FD3C130B1FD679FC905237028CF33B9938C
```

Bu APK public Supabase yapılandırması henüz verilmeden üretildi: fotoğraf akışı çalışabilir, analiz düğmesi kuruluma ihtiyaç olduğunu bildirir. Canlı yapılandırma eklenince yeniden üretilmelidir. Telefona yükleme komutu: `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.

Gradle'ın mevcut `flatDir` uyarıları derlemeyi engellemedi. Commit/push ve Phase 4 yapılmadı.

### Resmî kaynaklar

- [Gemini 3.5 Flash-Lite model özellikleri](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)
- [Gemini REST generateContent](https://ai.google.dev/api/generate-content) ve [JSON şemalı çıktı](https://ai.google.dev/gemini-api/docs/structured-output)
- [Supabase Edge secrets](https://supabase.com/docs/guides/functions/secrets) ve [Edge erişim güvenliği](https://supabase.com/docs/guides/functions/auth)
- [TAP — Atık pil ve toplama](https://tap.org.tr/pil-atik-pil/sss/atik-pil-nedir-ve-neden-toplanmalidir/), [EPA — Kullanılmış lityum iyon piller](https://www.epa.gov/recycle/used-lithium-ion-batteries)

## Phase 3.1 — Canlı bağlantı hazırlığı ve süreli test erişimi

**Canlı entegrasyon henüz tamamlanmadı.** Supabase CLI **2.120.0**, resmî npm paketi üzerinden önbelleğe alındı; proje bağımlılıklarına eklenmedi. CLI sürüm kontrolü başarılı. Salt okunur `projects list` sorgusu çıkış kodu 1 ile hesap girişi gerektiğini bildirdi. Kullanıcının istediği hesap giriş onayı bekleniyor; login ve deployment başlatılmadı. `.env.local`, proje URL/ref, public anahtar, Gemini secret ve kullanıcının onayladığı gerçek fotoğraf henüz yok.

### Canlı test erişimi

Phase 3'ün yalnız public key + CORS + bellek içi limit yaklaşımına ek olarak, sunucuda süreli erişim koruması uygulanmıştır:

- `ANALYSIS_TEST_TOKEN`: sunucuda en az 32, en fazla 256 karakter. Gerçek test için kriptografik rastgele en az 32 bayttan üretilir. Bu değer Gemini API anahtarı değildir; yalnız geçici test yetkisidir. Bundle, `VITE_*`, localStorage veya log içine eklenmez.
- `ANALYSIS_TEST_EXPIRES_AT`: UTC ISO zaman damgası. Geçerli pencere en fazla 15 dakika ileride olabilir. Kod/zaman eksik veya yanlışsa, pencere 15 dakikadan uzunsa ya da süre dolmuşsa `TEST_ACCESS_REQUIRED` (403) döner; Gemini'ye gidilmez. Mutlak son kullanma zamanı isolate yeniden başlasa da korunur.
- Her POST hem public proje anahtarını hem `x-analysis-test-token` header'ını gerektirir. Kod karşılaştırması native HMAC doğrulamasıyla yapılır. CORS izinli header listesi güncellendi; `*` yok. Origin göndermeyen istek de kod olmadan reddedilir.
- ScanPage'de **Canlı test erişim kodu** parola alanı eklendi. Değer yalnız ekranın React belleğinde tutulur; sayfadan çıkınca kaybolur. Önceki kamera/galeri/önizleme akışı korunur.
- Önceki JPEG/5 MiB/1600 px kontrolleri, zaman aşımı, güvenli hata yanıtları ve isolate başına istek/eşzamanlılık sınırları devam eder. Süreli kod, dağıtık kalıcı kota veya son kullanıcı Authentication sistemi değildir; yalnız kontrollü pilot test içindir. Kodun paylaşıldığı kişi geçerli pencere boyunca istek gönderebilir.

Kurulumdan sonra güvenli canlı test planı: doğru projeyi onayla → Gemini secret'ın Dashboard'da bulunduğunu doğrula → Function'ı kapalı durumda deploy et → rastgele test kodu ve 10 dakikalık süreyi secrets üzerinden tanımla → test fotoğrafı/Google'a gönderim için kullanıcı onayını al → `ANALYSIS_ENABLED=true` ile aç → izinli tek fotoğrafla gerçek çağrı ve JSON doğrulamasını yap → kodsuz/yanlış kodlu çağrının reddini kontrol et → `ANALYSIS_ENABLED=false` ile kapat. İşlem yarıda kalırsa mutlak süre sonu yeni analizleri kapatır; başlamış çağrı mevcut timeout süresi içinde tamamlanabilir.

Frontend public yapılandırması kullanıcı bilgileri gelince `.env.local` dosyasına yazılacaktır. Gerçek Gemini ve Supabase erişim token'ları sohbet/terminal raporlarına yazdırılmaz. Gemini anahtarı yalnız Edge secrets'ta kalır. `supabase/.temp/` Git ignore kapsamına eklendi. Secret listesi gerekiyorsa yalnız adlar/metadata okunur; değerler raporlanmaz.

### Kontrol sonuçları

| Kontrol | Sonuç |
| --- | --- |
| Supabase CLI | 2.120.0 sürüm doğrulandı; hesap girişi gerekli |
| TypeScript / ESLint | Başarılı |
| Otomatik testler | **34/34 başarılı**; önceki 29 + süreli test erişimi için 5 test |
| Production build / Capacitor sync | Başarılı |
| Android Gradle / debug APK | BUILD SUCCESSFUL; 3 sn, 157 görev |
| APK imzası | v2 doğrulandı |
| Frontend secret/API işaretleri | Sunucu Gemini/test secret değişkenleri, test kodu fixture'ı ve Google API adresi bulunmadı |
| Supabase proje bağlantısı / deployment | Yapılmadı; proje bilgileri ve login onayı bekleniyor |
| Gerçek Gemini yanıtı / Türkçe sonuç | Yapılmadı; API yanıt durumu yok. Varsayılan model `gemini-3.5-flash-lite`, canlı çağrıda kullanılmadı |
| Android cihaz testi | Yapılmadı; ADB listesi boş |

Bu aşamada değişenler: `analyze-waste/testAccess.ts` (yeni), handler/index, ortak hata kodları, server `.env.example`, istemci analiz servisi/hook'u, ScanPage, CSS, test fixture yapılandırması, `tests/testAccess.test.ts` (yeni), `.gitignore` ve bu rapor.

Yeni hazırlık APK'sı: `<PROJE_DIZINI>\android\app\build\outputs\apk\debug\app-debug.apk`, **9.896.425 bayt (9,44 MiB)**. SHA256:

```text
17E47F23B041A5DB8FF5134F9D0F2D20032FCD3C41E71383BA05CF3C32149129
```

Bu APK henüz gerçek Supabase public ayarlarıyla üretilmedi; canlı yapılandırma gelince yeniden derlenmelidir. CLI deployment, Docker kurmadan `npm exec --offline --yes --package supabase@2.120.0 -- supabase functions deploy analyze-waste --project-ref PROJECT_REF --use-api` ile yapılabilir; komut bu çalışmada çalıştırılmadı. CLI login için kullanıcı onayı gerekir. [Resmî CLI kurulum rehberi](https://supabase.com/docs/guides/local-development/cli/getting-started), [deployment referansı](https://supabase.com/docs/reference/cli/supabase-functions-deploy).

Commit/push yapılmadı; Phase 4'e geçilmedi.

## Phase 3.1 — 10 Ekim 2026 bağlantı doğrulaması

Yukarıdaki giriş ve yapılandırma bekleniyor ifadeleri önceki çalışmanın tarihsel durumudur. Güncel durumda Supabase CLI 2.120.0 oturumu doğrulandı; tek tam isim eşleşmesi olan **Akilli-Atik** projesi seçildi. Project Ref: `nyoxbwandadakfagoner`; Project URL: `https://nyoxbwandadakfagoner.supabase.co`. Proje ACTIVE_HEALTHY durumunda. Diğer projelerde değişiklik yapılmadı.

CLI `link` başarılı; yerel `supabase/.temp/project-ref` hedef referansla eşleşiyor. Public publishable anahtarı ve URL yalnız Git tarafından yok sayılan `.env.local` dosyasına yazıldı. Anahtar değeri raporlanmadı; Gemini anahtarı frontend'e eklenmedi. Public anahtarla `/auth/v1/health` kontrolü HTTP 200 döndü. Bu kontrol Gemini veya Edge Function çalışabilirliğini doğrulamaz.

Yalnız hedef projenin secret metadata listesi kontrol edildi. `GEMINI_API_KEY`, `GEMINI_MODEL`, `ANALYSIS_ENABLED`, `ANALYSIS_TEST_TOKEN`, `ANALYSIS_TEST_EXPIRES_AT`, `ALLOWED_ORIGINS` ve `ANALYSIS_PUBLIC_KEY` henüz tanımlı değil. Varsayılan Gemini modeli kodda mevcut; model secret'ı isteğe bağlıdır. Gemini secret'ı için Dashboard'da yalnız bu projeyi açın, Edge Functions → Secrets bölümünde `GEMINI_API_KEY` adını ekleyin ve anahtarı doğrudan oraya yapıştırın. Değeri sohbetten göndermeyin.

Deployment öncesinde açık kullanıcı onayı bekleniyor. Test erişim koruması korunuyor; süreli kod ve en fazla 15 dakikalık bitiş zamanı gerçek testten hemen önce güvenli şekilde yapılandırılmalıdır. İzinli CORS origin'leri ve public key sunucu kontrolü de deployment öncesinde tamamlanacaktır. İlk deployment kapalı analiz durumunda planlanır. Gerçek fotoğraf yolu ve Google'a gönderim izni ayrıca alınacaktır.

TypeScript, ESLint ve 34/34 otomatik test başarılı. Production build, Capacitor sync ve Android Gradle assembleDebug başarılı. Yeni public yapılandırmayı içeren debug APK üretildi; APK v2 imzası doğrulandı. APK yolu: `<PROJE_DIZINI>\android\app\build\outputs\apk\debug\app-debug.apk`. Gerçek Gemini analizi, deployment ve cihaz işlev testi bu çalışmada yapılmadı. Git commit/push yapılmadı; Phase 4'e geçilmedi.

## Phase 3.1 — 10 Ekim 2026 kapalı deployment

Kullanıcının açık onayıyla yalnız `Akilli-Atik` / `nyoxbwandadakfagoner` projesine `analyze-waste` deploy edildi. CLI deploy çıkış kodu 0. Proje ismi, tek eşleşme, yerel ref ve frontend public anahtarının hedef projeye ait olduğu deployment öncesinde tekrar doğrulandı. `GEMINI_API_KEY` adı mevcut; değeri okunmadı/raporlanmadı. `ANALYSIS_ENABLED=false`, hedef projenin public anahtar kontrolü, `GEMINI_MODEL=gemini-3.5-flash-lite` ve yalnız `https://localhost,http://localhost,capacitor://localhost` CORS origin'leri yapılandırıldı. Local development origin'leri canlı izin listesine eklenmedi.

Canlı HTTP kontrolleri (tamamı başarılı):

| İstek | HTTP | Sonuç |
| --- | --- | --- |
| İzinli origin OPTIONS | 204 | Tam origin CORS header'ı mevcut |
| Geçerli public key POST | 503 | SERVICE_DISABLED |
| Geçerli public key, Origin yok POST | 503 | SERVICE_DISABLED |
| Public key yok POST | 403 | UNAUTHORIZED |
| Yanlış public key POST | 403 | UNAUTHORIZED |
| İzin verilmeyen origin POST | 403 | ORIGIN_DENIED; CORS izin header'ı yok |
| GET | 405 | METHOD_NOT_ALLOWED |

POST kontrollerinde gerçek fotoğraf yerine tek baytlık geçersiz gövde kullanıldı; handler public anahtar/kapalı servis/origin kontrollerinde dönüyor, Gemini transport'una ulaşmıyor. Gerçek Gemini çağrısı yapılmadı ve test kodu oluşturulmadı. Süreli test erişim koruması kodda korunuyor. Dosya/JSON/rate-limit kontrollerinin canlı çalışması analiz kapalıyken bu isteklerle test edilmedi; önceki 34/34 otomatik test sonucu geçerli, bu deployment sırasında uygulama kodu değiştirilmedi.

Analiz ancak ayrı açık onay, fotoğraf dosya yolu ve Google'a gönderim izni alındıktan sonra kontrollü süreli test için açılabilir. Phase 3.1 PASS değildir. APK yeniden üretilmedi; başarılı canlı analiz sonrası yeni APK üretimi bekleniyor. Başka proje değişikliği, Git commit/push ve Phase 4 yapılmadı.
