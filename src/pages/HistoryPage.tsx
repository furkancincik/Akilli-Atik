import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Battery, CalendarDays, History,
  Leaf, LoaderCircle, MonitorSmartphone, PackageOpen, Recycle, RefreshCw,
  ShieldCheck, Trash2, Wine, Wrench, Newspaper,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageIntro } from "../components/PageIntro";
import { AnalysisResult } from "../components/AnalysisResult";
import { useAuth } from "../auth/useAuth";
import { useAnalysisHistory } from "../hooks/useAnalysisHistory";
import type { HistoryRecord, HistoryService } from "../services/historyData";
import type { WasteCategory } from "../../supabase/functions/_shared/analysis.ts";

const categoryIcons: Record<WasteCategory, LucideIcon> = {
  Plastik: Recycle, Cam: Wine, "Kâğıt/Karton": Newspaper, Metal: Wrench,
  Organik: Leaf, Elektronik: MonitorSmartphone, Pil: Battery, Diğer: PackageOpen,
};
const dateFormat = new Intl.DateTimeFormat("tr-TR", {
  year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
});

function AnalysisDate({ value }: { value: string }) {
  return <time dateTime={value}>{dateFormat.format(new Date(value))}</time>;
}

function DeleteConfirmation({ record, busy, error, onCancel, onConfirm }: {
  record: HistoryRecord;
  busy: boolean;
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    return () => element?.close();
  }, []);
  function cancelAndClose() {
    if (busy) return;
    // Close while the modal is still connected so the browser can return
    // keyboard focus to its opener before React removes the dialog.
    dialog.current?.close();
    onCancel();
  }
  return (
    <dialog ref={dialog} className="history-delete-dialog" role="alertdialog"
      aria-labelledby="history-delete-title" aria-describedby="history-delete-description"
      data-testid="history-delete-dialog" onCancel={(event) => {
        event.preventDefault();
        cancelAndClose();
      }}>
      <span className="history-delete-icon" aria-hidden="true"><Trash2 size={26} /></span>
      <h2 id="history-delete-title">Analiz kaydını sil</h2>
      <p className="history-delete-name">{record.analysis.wasteName}</p>
      <p id="history-delete-description">Bu analiz kaydını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.</p>
      {error && <p className="history-error" role="alert">{error}</p>}
      <p className="history-delete-progress" role="status">{busy ? "Kayıt siliniyor… Lütfen bekle." : null}</p>
      <div className="history-dialog-actions">
        <button ref={cancel} type="button" className="button secondary" disabled={busy} onClick={cancelAndClose}>Vazgeç</button>
        <button type="button" className="button history-danger" disabled={busy} onClick={onConfirm}>
          <Trash2 size={17} aria-hidden="true" />{busy ? "Siliniyor…" : "Kaydı kalıcı olarak sil"}
        </button>
      </div>
    </dialog>
  );
}

// The optional service is used only by isolated UI tests; production uses the
// shared SDK client and existing RLS, without privileged credentials.
export function HistoryPage({ service }: { service?: HistoryService } = {}) {
  const { analysisId } = useParams<{ analysisId: string }>();
  const { user, identityVersion } = useAuth();
  const history = useAnalysisHistory(analysisId, service);
  const navigate = useNavigate();
  const scope = `${user?.id ?? "guest"}:${identityVersion}:${analysisId ?? "list"}`;
  const [pending, setPending] = useState<{ scope: string; id: string } | null>(null);
  const [notice, setNotice] = useState<{ scope: string; text: string } | null>(null);
  // Derive the dialog's content from the current scope's visible records. An
  // expired session or account switch must also discard an open confirmation.
  const target = pending?.scope === scope
    ? (history.detail?.id === pending.id ? history.detail : history.items.find((item) => item.id === pending.id))
    : null;
  const deleting = history.deletingId !== null;

  function askToDelete(record: HistoryRecord) {
    history.clearDeleteError();
    setPending({ scope, id: record.id });
  }
  function cancelDelete() {
    setPending(null);
    history.clearDeleteError();
  }
  async function confirmDelete() {
    if (!target) return;
    const id = target.id;
    if (await history.remove(id)) {
      setPending((current) => current?.scope === scope && current.id === id ? null : current);
      setNotice({ scope, text: "Analiz kaydı silindi." });
      if (analysisId) navigate("/gecmis", { replace: true });
    }
  }

  return (
    <>
      <PageIntro
        eyebrow="ANALİZ GEÇMİŞİ"
        title={analysisId ? "Kaydettiğin ayrıştırma önerisi." : "Doğru adımların, bir arada."}
        description={analysisId
          ? "Önceki analizinin sonucunu ve güvenli ayrıştırma önerilerini yeniden incele."
          : "Kaydettiğin analizleri en yeniden eskiye incele, ayrıştırma önerilerine tekrar ulaş."}
      />
      <div className="history-toolbar">
        {analysisId
          ? <Link className="history-back" to="/gecmis"><ArrowLeft size={18} aria-hidden="true" />Geçmişe dön</Link>
          : <span className="history-private"><ShieldCheck size={18} aria-hidden="true" />Yalnız sana ait kayıtlar</span>}
        <button className="button secondary history-refresh" type="button"
          disabled={history.loading || history.loadingMore || deleting} onClick={() => history.reload()}>
          <RefreshCw size={17} aria-hidden="true" />Yenile
        </button>
      </div>
      <p className="history-feedback" role="status" aria-live="polite">{notice?.scope === scope ? notice.text : null}</p>
      {history.error && <div className="history-error" role="alert"><AlertTriangle size={19} aria-hidden="true" /><p>{history.error}</p></div>}

      {history.loading ? (
        <section className="card history-loading" role="status" aria-live="polite">
          <LoaderCircle size={23} aria-hidden="true" /><p>{analysisId ? "Analiz detayı yükleniyor…" : "Analiz geçmişin yükleniyor…"}</p>
        </section>
      ) : analysisId ? (
        history.detail && <div data-testid="history-detail" className="history-detail">
          <div className="history-detail-meta">
            <span><CalendarDays size={17} aria-hidden="true" /><AnalysisDate value={history.detail.createdAt} /></span>
            <button type="button" className="button secondary history-delete-button" disabled={deleting}
              onClick={() => askToDelete(history.detail!)}><Trash2 size={17} aria-hidden="true" />Kaydı sil</button>
          </div>
          <AnalysisResult result={history.detail.analysis} />
          <p className="history-photo-note">Bu kayıtta analiz sonucu saklanır; fotoğraf saklanmaz.</p>
        </div>
      ) : history.items.length ? (
        <section aria-label="Kayıtlı atık analizleri">
          <ol className="history-grid" data-testid="history-list">
            {history.items.map((record) => {
              const category = record.analysis.category ?? "Diğer";
              const Icon = categoryIcons[category];
              return <li key={record.id}>
                <article className="card history-card" data-testid={`history-card-${record.id}`}>
                  <div className="history-card-heading">
                    <span className={`history-category-icon${category === "Organik" ? " history-eco" : ""}`} aria-hidden="true"><Icon size={25} /></span>
                    <span className="category-badge">{category}</span>
                  </div>
                  <h2>{record.analysis.wasteName}</h2>
                  <p className="history-date"><CalendarDays size={15} aria-hidden="true" /><AnalysisDate value={record.createdAt} /></p>
                  <div className="history-card-actions">
                    <Link className="history-details-link" to={`/gecmis/${record.id}`}>Detayları görüntüle<ArrowRight size={17} aria-hidden="true" /></Link>
                    <button type="button" className="history-icon-button" disabled={deleting}
                      aria-label={`${record.analysis.wasteName} kaydını sil`} onClick={() => askToDelete(record)}><Trash2 size={18} aria-hidden="true" /></button>
                  </div>
                </article>
              </li>;
            })}
          </ol>
          <div className="history-pagination">
            <p>{history.items.length} kayıt gösteriliyor.</p>
            {history.nextCursor && <button type="button" className="button secondary"
              disabled={history.loadingMore || deleting} onClick={() => history.loadMore()}>
              {history.loadingMore && <LoaderCircle size={17} aria-hidden="true" />}
              {history.loadingMore ? "Yükleniyor…" : "Daha fazla göster"}
            </button>}
          </div>
          <p className="history-photo-note">Geçmişinde analiz sonuçları bulunur; fotoğraflar saklanmaz.</p>
        </section>
      ) : !history.error ? (
        <section className="card history-empty">
          <span className="history-empty-icon" aria-hidden="true"><History size={31} /></span>
          <h2>Henüz kaydedilmiş bir atık analiziniz bulunmuyor.</h2>
          <p>Kaydettiğin sonuçlar burada yer alır; ayrıştırma önerilerine istediğin zaman dönebilirsin.</p>
          <Link className="button primary" to="/tara">Atık tarama sayfasına git<ArrowRight size={18} aria-hidden="true" /></Link>
        </section>
      ) : null}

      {target && <DeleteConfirmation key={`${scope}:${target.id}`} record={target}
        busy={history.deletingId === target.id} error={history.deleteError}
        onCancel={cancelDelete} onConfirm={() => void confirmDelete()} />}
    </>
  );
}
