# Nasıl Çalışır: animasyon düzeltmesi ve adım seçimi

**Tarih:** 16 Ekim 2026. **Kapsam:** Phase 4 / STEP 5 sonrasında arayüz ara görevi. Phase 5 geliştirilmedi.

## Kök neden ve tarayıcı kanıtı

Kartlar önceki uygulamada statik `article` elemanlarıydı. Tıklama işleyicisi, aktif adım state'i ve açıklama paneli yoktu. Eski animasyon testleri de kartların etkileşimsiz olmasını ve mobil dokunmada değişmemesini bekliyordu. Bu beklentiler yeni etkileşim sözleşmesine göre güncellendi.

Animasyonun hiç tetiklenmediği iddiası tarayıcıda doğrulanmadı: gerçek Edge ve native IntersectionObserver ile masaüstü, 320 px ve 390 px görünümlerde üç giriş animasyonu gözlendi. Buna karşılık bir başlangıç sıçraması ölçüldü: kartlar ilk iki `requestAnimationFrame` örneğinde opacity 1 iken, `useEffect` ve observer callback'i sonrasında opacity 0'a dönüyordu. Önceden görünür kartın tekrar gizlenip belirmesi, tutarlı bir giriş sağlamıyordu. İlk ekranda görünen kartların animasyonu ayrıca kullanıcı bölüme dikkatini vermeden tamamlanabiliyordu. İlk viewport senaryosu eski testlerde yoktu; testler kartları özellikle ekran altında başlatıyordu.

Baseline 1280 × 1400 ölçümünde observer yaklaşık 1.257 sn, animasyon başlangıçları 1.498 / 1.644 / 1.797 sn ve son animasyon bitişi 2.213 sn olarak kaydedildi. Bunlar o koşuma ait zamanlardır; sabit performans garantisi değildir. Reduced-motion tercihinde animasyonun çalışmaması doğru davranıştı ve korundu.

## Uygulama

- `useLayoutEffect` destek kontrollerinden sonra, ilk çizimden önce kartları `is-pending` durumuna hazırlıyor. Böylece görünür → saydam başlangıç sıçraması önleniyor.
- IntersectionObserver, kartın en az %15'i görünür olduğunda yalnız bir kez tetikliyor. Önceki `-80px` alt kenar daraltması kaldırıldı. Kartlar ayrı izleniyor; mobilde aşağıdaki kartlar kendi görünürlüklerini bekliyor.
- İki RAF ile başlangıç durumu çizildikten sonra CSS animasyonu başlıyor: **420 ms**, gecikmeler **0 / 150 / 300 ms**, opacity **0 → 1**, translateY **24 px → 0**. Kaydırıp geri dönmek tekrar oynatmıyor; yenileme veya yeni sayfa mount'u yeniden başlatıyor.
- Animasyon sonunda geçici sınıflar kaldırılıyor; kesilmiş animasyonlarda 1000 ms temizlik yedeği var. Observer, RAF, zamanlayıcı ve dinleyiciler unmount sırasında temizleniyor. Eski callback'ler yeni mount'a etki etmiyor.
- Klavye odağı bekleyen karta gelirse kart hemen görünür oluyor. Hareket azaltma tercihi başlangıçta veya animasyon sırasında etkinleşirse bütün kartlar görünür kalıyor; gözlem ve hareket sonlandırılıyor. Observer desteği yoksa statik görünüm ve seçim çalışıyor.
- Üç kart native `button type="button"` oldu. `activeStep` state'i varsayılan ilk adımı seçiyor; tıklama, Enter ve Space seçimi değiştiriyor. Tab sırası doğal düğme sırası. Kartlar yönlendirme yapmıyor.
- Aktif durum `aria-pressed`, turkuaz çerçeve, hafif arka plan ve "Seçili adım" metniyle belirtiliyor. `aria-controls`, etiket ve açıklama bağlantıları var. Detay alanı `aria-live="polite"`; pasif açıklamalar `aria-hidden` ve `visibility: hidden` ile erişilebilirlik ağacından çıkarılıyor.
- Detaylar aynı CSS grid hücresinde doğal maksimum yüksekliği ayırıyor. Seçim değiştiğinde bölüm yüksekliği değişmiyor; aktif metin 180 ms opacity/translate geçişiyle beliriyor. Reduced-motion bu geçişi kaldırıyor.
- Lacivert, turkuaz, açık mavi ve yeşil palet korundu. Hover yalnız hassas işaretçide çalışıyor; mobilde dikey düzen ve dokunmatik seçim var. Yeni bağımlılık eklenmedi.

## Değiştirilen dosyalar

| Dosya | Bu görevdeki değişiklik |
| --- | --- |
| `src/pages/HomePage.tsx` | İlk çizimden önce animasyon hazırlığı, temizleme, native düğmeler, aktif adım ve açıklama paneli |
| `src/styles.css` | Pending durumu, 24 px giriş, seçili kart, detay geçişi ve reduced-motion stilleri |
| `docs/how-it-works-interaction.md` | Bu rapor |
| `report-qa/step-interaction-browser.mjs` | Gerçek tarayıcıda yeni animasyon/etkileşim kontrolleri |
| `report-qa/step-animation-browser.mjs` | Mevcut giriş noktasını yeni kapsama yönlendirme; önceki script baseline adıyla korundu |
| `report-qa/auth-browser-smoke.mjs` | STEP 5 öncesinden kalmış geçmiş placeholder beklentisini güncel boş liste ve kullanıcı filtresi fixture'ına uyarlama |

`report-qa/` yerel kanıtlar için mevcut Git ignore kapsamındadır. Önceden var olan README, Auth, kurtarma, geçmiş, SQL ve Android değişiklikleri geri alınmadı. Branch `main`, HEAD `f6b2915443483a85919e53fa0d18af31aaa69727`; commit veya push yapılmadı.

## Doğrulama sonuçları

| Kontrol | Sonuç |
| --- | --- |
| TypeScript: frontend ve Edge | PASS |
| ESLint | PASS |
| Unit testler | **224/224 PASS**; değişiklik öncesi ve sonrasında |
| Gerçek Edge animasyon ve etkileşim kontrolleri | **57/57 PASS**, 9 senaryo |
| UX regresyonları | **47/47 PASS** |
| Analiz geçmişi regresyonları | **48/48 PASS** |
| Authentication regresyonları | **21/21 PASS** |
| Parola kurtarma regresyonları | **40/40 PASS** |
| İstek sayısı / HTTP 429 regresyonları | **29/29 PASS** |
| Production build | PASS; mevcut 500 kB üzeri ana chunk uyarısı sürüyor |

Animasyon kontrolleri gerçek native observer, CSS keyframe/zamanlama, animationstart ve ardışık frame ölçümlerini kullanır. İlk viewportta ilk ölçülen karede üç kartın opacity değeri 0 oldu; başlangıç sıçraması yeniden üretilmedi. Yenilemede üç animasyon tekrar başladı, aynı mount'a geri kaydırmada yeni animasyon oluşmadı. Fareyle üç seçim, Tab/Enter/Space, mobilde üç dokunma seçimi, panel yüksekliği, yatay taşma, reduced-motion başlangıcı ve sonradan değişimi, eksik observer, StrictMode/unmount ve eski callback'ler denetlendi. Ekran görüntüleri görsel olarak da incelendi.

Regresyonlarda tarayıcı gerçek, Auth/veritabanı yanıtları mock veya servis enjeksiyonudur. **Canlı Authentication, e-posta, Gemini ya da veritabanı doğrulaması olarak değerlendirilmez.** Koşumlarda gerçek uzak servis isteği ve tarayıcı çalışma zamanı hatası yoktur. İlk Auth koşumu eski geçmiş ekranı beklentisi nedeniyle başarısızdı; yalnız QA senaryosu güncellenip yeniden çalıştırıldı. İlk hata `report-qa/how-it-works-auth-obsolete-*` altında korundu.

## Kanıtlar ve sınırlar

- `report-qa/step-interaction-baseline/results.json`: değişiklik öncesi frame/observer ölçümleri; zamanlı PNG'ler aynı dizinde.
- `report-qa/step-interaction-browser/summary.json`: **57 PASS, 0 FAIL** özeti; `results.json` ayrıntıları içerir.
- `report-qa/step-interaction-browser/desktop-090ms.png` ve `desktop-intermediate.png`: animasyonun farklı zamanlarında görüntüler. Tek bir statik görüntü hareket kanıtı olarak kullanılmadı; native zaman çizelgesiyle birlikte değerlendirildi.
- `report-qa/how-it-works-{typecheck,lint,unit,build,ux,history,auth,recovery,recovery-request}.log`: komut ve regresyon kayıtları.

Video kaydı için Playwright ffmpeg yürütülebilir dosyası bulunmadığından video oluşturulmadı; yeni paket kurulmadan zamanlı PNG ve native frame ölçümleri kullanıldı. Fiziksel Android cihaz ve gerçek ekran okuyucu testi yapılmadı; erişilebilirlik doğrulaması DOM semantiği ve klavye davranışını kapsıyor. Bu görevde yeni APK üretilmedi.

Authentication, parola kurtarma veya analiz geçmişi üretim kodu değiştirilmedi. Migration, deployment, gerçek Gemini isteği, canlı e-posta veya kullanıcı verisi işlemi yapılmadı. `ANALYSIS_ENABLED` ve diğer canlı ayarlara müdahale edilmedi. Sonraki geliştirme için kullanıcı onayı bekleniyor.
