import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { WasteAnalysis } from "../../supabase/functions/_shared/analysis.ts";

export function AnalysisResult({ result }: { result: WasteAnalysis }) {
  return (
    <section
      className="card analysis-result"
      aria-labelledby="analysis-result-title"
    >
      <div className="analysis-heading">
        {result.success ? (
          <CheckCircle2 size={24} aria-hidden="true" />
        ) : (
          <AlertTriangle size={24} aria-hidden="true" />
        )}
        <h2 id="analysis-result-title">
          {result.success ? result.wasteName : "Atık tespit edilemedi"}
        </h2>
        {result.success && (
          <span className="category-badge">{result.category}</span>
        )}
      </div>
      <p>{result.description}</p>
      {result.objectCount === "multiple" && (
        <p className="analysis-warning">
          Fotoğrafta birden fazla atık var. Bu sonuç yalnız baskın nesne
          içindir; diğer atıkları ayrı ayrı fotoğrafla.
        </p>
      )}
      {result.success && result.uncertain && (
        <p className="analysis-warning">
          Malzeme veya nesne belirsiz. Öneriyi kesin sınıflandırma olarak kabul
          etme; daha net bir fotoğrafla yeniden dene.
        </p>
      )}
      {result.success && (
        <dl className="analysis-details">
          <dt>Ayrıştırma talimatı</dt>
          <dd>{result.sortingInstruction}</dd>
          <dt>Geri dönüşüm önerisi</dt>
          <dd>{result.recyclingAdvice}</dd>
        </dl>
      )}
      {result.safetyWarning && (
        <div className="analysis-warning">
          <strong>Güvenlik uyarısı</strong>
          <p>{result.safetyWarning}</p>
        </div>
      )}
      <p className="muted">
        {result.success
          ? "Bu görsel değerlendirme yanılabilir. Yerel ayrıştırma kurallarını belediye veya yetkili toplama noktasıyla doğrula."
          : "Atığı tek başına, iyi ışıkta ve yakından fotoğraflayıp tekrar dene."}
      </p>
    </section>
  );
}
