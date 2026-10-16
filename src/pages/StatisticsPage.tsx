import { useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router";
import {
  AlertTriangle, ArrowRight, ChartColumn, ChartNoAxesCombined, Layers,
  LoaderCircle, RefreshCw, ShieldCheck, TrendingUp,
} from "lucide-react";
import { PageIntro } from "../components/PageIntro";
import { useStatistics } from "../hooks/useStatistics";
import type { StatisticsService, StatisticsSummary } from "../services/statisticsData";

const integer = new Intl.NumberFormat("tr-TR");
const percent = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
const calendarDate = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" });
const updatedDate = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul",
});
const labelDate = (date: string) => calendarDate.format(new Date(`${date}T12:00:00Z`));

function CategoryDistribution({ summary }: { summary: StatisticsSummary }) {
  return <section className="card statistics-chart" aria-labelledby="statistics-category-title">
    <div className="statistics-chart-heading"><span className="statistics-icon" aria-hidden="true"><ChartColumn size={22} /></span>
      <div><h2 id="statistics-category-title">Kategori dağılımı</h2><p>Tüm kayıtlı analizlerin, sekiz kategoride.</p></div>
    </div>
    <table className="statistics-category-table" data-testid="statistics-categories">
      <caption className="sr-only">Her kategorinin analiz sayısı ve toplam analizler içindeki yüzdesi</caption>
      <thead><tr><th scope="col">Kategori</th><th scope="col">Analiz</th><th scope="col">Pay</th></tr></thead>
      <tbody>{summary.categories.map(({ category, count, percentage }) => <tr key={category}>
        <th scope="row"><span>{category}</span><span className={`statistics-bar-track${category === "Organik" ? " statistics-bar-eco" : ""}`} aria-hidden="true">
          <span style={{ width: `${percentage}%` }} /></span></th>
        <td>{integer.format(count)}</td><td>%{percent.format(percentage)}</td>
      </tr>)}</tbody>
    </table>
    <p className="statistics-note">Yuvarlama nedeniyle yüzdelerin toplamı %100'den biraz farklı olabilir.</p>
  </section>;
}

function AnalysisTrend({ summary }: { summary: StatisticsSummary }) {
  const [period, setPeriod] = useState<"daily" | "weekly">("daily");
  const points = period === "daily"
    ? summary.daily.map(({ date, count }) => ({ key: date, label: labelDate(date), count }))
    : summary.weekly.map(({ startDate, endDate, count }) => ({ key: startDate, label: `${labelDate(startDate)} – ${labelDate(endDate)}`, count }));
  const maximum = Math.max(1, ...points.map((point) => point.count));
  const periodCount = points.reduce((sum, point) => sum + point.count, 0);
  return <section className="card statistics-chart" aria-labelledby="statistics-trend-title" data-testid="statistics-trend">
    <div className="statistics-chart-heading"><span className="statistics-icon" aria-hidden="true"><TrendingUp size={22} /></span>
      <div><h2 id="statistics-trend-title">Analiz eğilimi</h2><p>Europe/Istanbul saat dilimi (Türkiye saati).</p></div>
    </div>
    <div className="statistics-period" role="group" aria-label="Grafik dönemi">
      <button type="button" aria-pressed={period === "daily"} onClick={() => setPeriod("daily")}>Günlük</button>
      <button type="button" aria-pressed={period === "weekly"} onClick={() => setPeriod("weekly")}>Haftalık</button>
    </div>
    <p className="statistics-trend-description" id="statistics-trend-description">
      {period === "daily" ? "Bugün dahil son 14 gün" : "Bu hafta dahil son 8 hafta"}: <strong>{integer.format(periodCount)} analiz</strong>.
      {period === "weekly" && " Haftalar pazartesi başlar; bu hafta henüz tamamlanmamıştır."}
    </p>
    <figure aria-labelledby="statistics-trend-title" aria-describedby="statistics-trend-description">
      <div className="statistics-trend-bars" style={{ "--statistics-columns": points.length } as CSSProperties} aria-hidden="true">
        {points.map((point, index) => <div className="statistics-trend-column" key={point.key}>
          <span className="statistics-trend-value">{point.count ? integer.format(point.count) : ""}</span>
          <div className="statistics-trend-track"><span style={{ height: `${point.count / maximum * 100}%` }} /></div>
          <span className="statistics-trend-label">{index === 0 || index === points.length - 1 || index === Math.floor(points.length / 2) ? labelDate(point.key) : ""}</span>
        </div>)}
      </div>
      <figcaption className="statistics-note">Grafiğin tüm değerleri aşağıdaki tarih listesinde yer alır.</figcaption>
    </figure>
    <details className="statistics-trend-data"><summary>Tarih ve analiz sayılarını göster</summary>
      <table><caption className="sr-only">{period === "daily" ? "Günlük" : "Haftalık"} analiz sayıları, Türkiye saati</caption>
        <thead><tr><th scope="col">{period === "daily" ? "Gün" : "Hafta"}</th><th scope="col">Analiz sayısı</th></tr></thead>
        <tbody>{points.map((point) => <tr key={point.key}><th scope="row"><time dateTime={point.key}>{point.label}</time></th><td>{integer.format(point.count)}</td></tr>)}</tbody>
      </table>
    </details>
  </section>;
}

// Only isolated browser tests inject a service. Production uses the existing SDK and RLS.
export function StatisticsPage({ service }: { service?: StatisticsService } = {}) {
  const statistics = useStatistics(service);
  const summary = statistics.summary;
  const top = summary?.topCategories.join(", ") || "Henüz yok";
  return <div className="statistics-page">
    <PageIntro eyebrow="İSTATİSTİKLER" title="Analizlerini sayılarla tanı."
      description="Yalnız hesabına kaydedilmiş, silinmemiş başarılı analizlerin istatistikleri." />
    <div className="history-toolbar">
      <span className="history-private"><ShieldCheck size={18} aria-hidden="true" />Yalnız sana ait kayıtlar</span>
      <button className="button secondary history-refresh" type="button" disabled={statistics.loading} onClick={() => void statistics.reload()}>
        <RefreshCw size={17} aria-hidden="true" />Yenile
      </button>
    </div>
    <p className="statistics-scope-note">Analiz sayısı, geri dönüştürülen atık miktarını veya çevresel katkıyı ölçmez.</p>
    {statistics.error && <div className="history-error" role="alert"><AlertTriangle size={19} aria-hidden="true" /><p>{statistics.error}</p></div>}
    {statistics.loading ? <section className="card history-loading" role="status" data-testid="statistics-loading">
      <LoaderCircle size={23} aria-hidden="true" /><p>İstatistiklerin hesaplanıyor…</p>
    </section> : summary && summary.totalAnalyses > 0 ? <>
      <section className="statistics-summary" aria-label="Analiz özeti" data-testid="statistics-summary">
        <article className="card statistics-summary-card"><span className="statistics-icon" aria-hidden="true"><ChartNoAxesCombined size={24} /></span>
          <h2>Toplam analiz</h2><strong data-testid="statistics-total">{integer.format(summary.totalAnalyses)}</strong><p>Tüm kayıtların</p></article>
        <article className="card statistics-summary-card"><span className="statistics-icon" aria-hidden="true"><Layers size={24} /></span>
          <h2>Farklı kategori</h2><strong data-testid="statistics-distinct">{summary.distinctCategories}</strong><p>8 kategori içinde</p></article>
        <article className="card statistics-summary-card statistics-top-card"><span className="statistics-icon" aria-hidden="true"><TrendingUp size={24} /></span>
          <h2>En sık analiz edilen</h2><strong data-testid="statistics-top">{top}</strong>
          <p>{summary.topCategories.length > 1 ? "Eşit sayıda: her biri " : ""}{integer.format(summary.topCount)} analiz</p></article>
      </section>
      <div className="statistics-charts"><CategoryDistribution summary={summary} /><AnalysisTrend summary={summary} /></div>
      <p className="statistics-updated" role="status">Son hesaplama: <time dateTime={summary.calculatedAt}>{updatedDate.format(new Date(summary.calculatedAt))}</time> (Türkiye saati).
        Ekran açıldığında, sekmeye döndüğünde veya Yenile ile güncellenir.</p>
    </> : summary && !statistics.error ? <section className="card history-empty">
      <span className="history-empty-icon" aria-hidden="true"><ChartNoAxesCombined size={31} /></span>
      <h2>Henüz istatistik oluşturulabilecek analiz kaydınız bulunmuyor.</h2>
      <p>Kaydettiğin başarılı analizler burada sayılara ve grafiklere dönüşür.</p>
      <Link className="button primary" to="/tara">Atık tarama sayfasına git<ArrowRight size={18} aria-hidden="true" /></Link>
    </section> : null}
  </div>;
}
