import { useRef, useState } from "react";
import { Camera, Upload, ScanLine, Trash2, LoaderCircle } from "lucide-react";
import { PageIntro } from "../components/PageIntro";
import type { PhotoCapture } from "../hooks/usePhotoCapture";
import type { PhotoSource } from "../services/photos";
import { useWasteAnalysis } from "../hooks/useWasteAnalysis";
import { AnalysisResult } from "../components/AnalysisResult";
import { normalAnalysisAccess } from "../services/analysisAccess";

export function ScanPage({ capture }: { capture: PhotoCapture }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [testToken, setTestToken] = useState("");
  const { photo, error, notice } = capture;
  const analysis = useWasteAnalysis(photo?.blob);
  const busy = capture.busy || analysis.busy;
  function select(source: PhotoSource) {
    if (capture.native) {
      void capture.capture(source);
      return;
    }
    (source === "camera" ? cameraInput : fileInput).current?.click();
  }
  return (
    <>
      <PageIntro
        eyebrow="ATIK TARAMA"
        title="Bir fotoğraf, doğru bir adım."
        description="Atığının fotoğrafını çek veya galeriden seç; yapay zekâ ile ayrıştırma önerisi al."
      />
      <section className="card scan-panel" aria-busy={busy}>
        <div className="scan-outline">
          {photo ? (
            <figure className="photo-preview">
              <img src={photo.url} alt="Seçilen atık fotoğrafı" />
              <figcaption>
                {photo.width} × {photo.height} px ·{" "}
                {(photo.blob.size / 1024 / 1024).toLocaleString("tr-TR", {
                  maximumFractionDigits: 2,
                })}{" "}
                MB · JPG
              </figcaption>
            </figure>
          ) : (
            <>
              <ScanLine size={64} strokeWidth={1.3} aria-hidden="true" />
              <h2>Atık fotoğrafını ekle</h2>
              <p>
                Atığı iyi aydınlatılmış bir ortamda, net ve yakından fotoğrafla.
              </p>
            </>
          )}
          <div className="actions">
            <button
              className="button primary"
              disabled={busy}
              onClick={() => select("camera")}
            >
              <Camera size={19} aria-hidden="true" />
              {photo ? "Yeni fotoğraf çek" : "Fotoğraf çek"}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => select("gallery")}
            >
              <Upload size={19} aria-hidden="true" />
              {photo ? "Fotoğrafı değiştir" : "Galeriden seç"}
            </button>
            {photo && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={capture.remove}
              >
                <Trash2 size={19} aria-hidden="true" />
                Fotoğrafı kaldır
              </button>
            )}
          </div>
          {!capture.native && (
            <p className="photo-help">
              Tarayıcıda cihazın dosya seçicisi kullanılır. Kamera seçeneği
              desteklenen telefonlarda açılır.
            </p>
          )}
        </div>
        <div role="status" aria-live="polite" className="photo-status">
          {capture.busy ? (
            <>
              <LoaderCircle size={18} aria-hidden="true" />
              Fotoğraf hazırlanıyor…
            </>
          ) : (
            notice
          )}
        </div>
        {error && (
          <p className="photo-error" role="alert">
            {error}
          </p>
        )}
        <p className="notice">
          JPG, PNG veya WebP · En fazla 20 MB. Fotoğraf bu oturumda tutulur.
          Analiz düğmesine bastığında küçültülmüş fotoğraf Supabase üzerinden
          Google Gemini’ye gönderilir. Başarılı analiz sonucu hesabına kaydedilmeye
          çalışılır; fotoğrafın veritabanında saklanmaz.
        </p>
        <div className="analysis-actions">
          {!normalAnalysisAccess && <label className="test-access-label">
            Canlı test erişim kodu
            <input
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={256}
              value={testToken}
              disabled={busy}
              onChange={(event) => setTestToken(event.target.value)}
            />
          </label>}
          <p className="photo-help">
            {normalAnalysisAccess
              ? "Analizler güvenli kullanım sınırlarına tabidir. XP için günlük üç analiz sınırı ayrıca uygulanır."
              : "Analiz yalnız onaylı süreli testlerde açılır. Kod yalnız bu ekranın belleğinde tutulur."}
          </p>
          <button
            className="button primary"
            disabled={!photo || busy}
            onClick={() => void analysis.analyze(testToken)}
          >
            {analysis.busy ? (
              <LoaderCircle size={19} aria-hidden="true" />
            ) : (
              <ScanLine size={19} aria-hidden="true" />
            )}
            {analysis.busy
              ? "Analiz ediliyor…"
              : analysis.attempted
                ? "Yeniden analiz et"
                : "Yapay Zekâ ile Analiz Et"}
          </button>
          <p role="status" aria-live="polite" className="photo-status">
            {analysis.busy
              ? "Fotoğrafın değerlendiriliyor. Bu işlem biraz zaman alabilir."
              : analysis.result
                ? analysis.result.success
                  ? analysis.persistence?.status === "saved"
                    ? "Atık analizi tamamlandı ve hesabına kaydedildi."
                    : analysis.persistence?.status === "duplicate"
                      ? "Bu fotoğrafın analizi daha önce hesabına kaydedilmiş."
                      : normalAnalysisAccess
                        ? "Atık analizi tamamlandı ancak hesabına kaydedilemedi. Sonucunu aşağıda görebilirsin. Aynı istek ek analiz başlatmaz; geçmişini kontrol et."
                        : "Atık analizi tamamlandı ancak hesabına kaydedilemedi. Sonucunu aşağıda görebilirsin. Aynı fotoğrafla yeniden deneyebilirsin."
                  : "Atık tespit edilemedi."
                : null}
          </p>
        </div>
        {analysis.error && (
          <p className="photo-error" role="alert">
            {analysis.error}
          </p>
        )}
        {[
          { ref: fileInput, camera: false },
          { ref: cameraInput, camera: true },
        ].map(({ ref, camera }) => (
          <input
            key={String(camera)}
            ref={ref}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture={camera ? "environment" : undefined}
            hidden
            aria-label={
              camera ? "Kamera fotoğrafı seç" : "Galeriden fotoğraf seç"
            }
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void capture.selectFile(file);
            }}
          />
        ))}
      </section>
      {analysis.result && <AnalysisResult result={analysis.result} />}
    </>
  );
}
