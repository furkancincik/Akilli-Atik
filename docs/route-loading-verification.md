# Sayfa yükleme ve mimari regresyonu — 17 Ekim 2026

Canlı kota migration'ından sonra, ayrı canlı izin beklenirken bağımsız yerel performans maddesi ele alındı. Backend, Auth, RLS, erişim modu veya secret değiştirilmedi.

## Değişiklik

`App.tsx` içindeki Panelim, Atık Tara, Geçmiş, Profilim ve Eko Arena, mevcut React `lazy` ile modül düzeyinde tanımlandı. Bileşen gövdelerine, servislere veya navigasyon yollarına müdahale edilmedi. Public/auth ekranları doğrudan yüklenmeye devam eder. Hesaba ait fotoğraf hook'u aynı dış kapsamda kalır; lazy tanımları render sırasında yeniden oluşturulmaz.

`Layout` içindeki küçük `RouteContent` sınırı yüklenirken Türkçe status, hata halinde güvenli yeniden yükleme mesajı gösterir. Menü ve çıkış düğmesi sınırın dışında kalır. Pathname değişince hata sınırı sıfırlanır. Kimlik değişiminde mevcut AccountRoutes remount/temizlik kuralı korunur. Ham exception veya sağlayıcı mesajı kullanıcıya yazılmaz. Bağımlılık eklenmedi.

## Ölçüm ve sınırlar

- Aynı yapılandırmayla minify edilmiş ana parça **612,48 → 543,13 kB**, yaklaşık **%11,3** azaldı. Gzip **180,47 → 160,22 kB**. Özel sayfalar ve ortak bağımlılıkları ayrı parçalara ayrıldı.
- Bu ölçüm byte boyutudur; gerçek kullanıcı ağında açılış süresi artışı veya Web Vitals kabulü olarak sunulmaz.
- Ana parça hâlâ 500 kB üstünde; Vite uyarısı ve Gradle flatDir uyarısı gizlenmedi. Yeni katman veya riskli toplu refactoring ile yalnız uyarıyı susturma yoluna gidilmedi.

## Çalıştırılan kontroller

| Kontrol | Sonuç |
| --- | --- |
| Unit | 330/330 PASS |
| React/araç ve Edge TypeScript | PASS, ayrı exit 0 |
| ESLint | PASS, exit 0 |
| Production build | PASS, exit 0 |
| Gerçek App/router tarayıcı kontrolleri | 21/21 PASS; 1280/390 px, kontrollü gecikme ve gerçek import reddi |
| Mevcut mock UI regresyonu | 61 × masaüstü/mobil/reduced-motion = 183 PASS |
| Capacitor sync / offline Gradle | PASS |
| APK v2 imzası ve web varlıkları | PASS; 14 dosya gerçek APK ZIP içeriğiyle birebir aynı |
| Güncel APK emülatör smoke | Kurulum/açılış ve 9 anonim WebView kontrolü PASS |

21 kontrol, sayfaların ilk ekranda gereksiz yüklenmemesini, lazy sayfaya geçişi, yavaş yüklemede erişilebilir status/çıkış düğmesini, aynı hesabın fotoğrafının gezinmede korunmasını, çıkışta temizlenmesini ve yeni oturuma taşınmamasını kapsar. Ayrı tarayıcı bağlamında Arena modülü gerçekten engellendi; güvenli hata ekranı, başka sayfaya geçerek hata sıfırlama ve çıkış ayrıca doğrulandı.

Tarayıcıda kimlik sentetiktir ve Supabase yapılandırması boştur; dış HTTP istekleri engellendi. Bunlar canlı Auth, kişisel geçmiş veya gerçek XP/Arena kabulü değildir. Emülatör smoke anonim kapsamındadır. Önceki native eklenti çekim/seçim/iptal sonuçları yeni APK'da yeniden çalıştırılmış sayılmadı; kamera kaynak kodu değişmedi. Fiziksel cihaz ve oturum açılmış native uçtan uca kabul hâlâ açık.

Son APK: `android/app/build/outputs/apk/debug/app-debug.apk`, **9.897.335 bayt**. SHA-256: `F4325F40CCCC0BC77C52716B2BC443E525F5A9D774A5BA5F60DBB38795C94223`.

Kanıtlar Git dışında `report-qa/route-loading-*`, `completion-final-*` ve güncel `completion-emulator-smoke.json` dosyalarında tutulur. SQL kaynakları değişmediğinden başarılı yeni migration SQL/yarış koşumu ayrıca tekrar edilmiş sayılmadı; [canlı migration kaydı](analysis-quota-live-migration.md) kendi kapsamını belirtir.

Yöntem referansları: [React lazy](https://react.dev/reference/react/lazy), [Suspense](https://react.dev/reference/react/Suspense).
