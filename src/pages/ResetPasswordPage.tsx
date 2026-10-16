import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate } from "react-router";
import { LoaderCircle, LockKeyhole } from "lucide-react";
import { PageIntro } from "../components/PageIntro";
import { useAuth } from "../auth/useAuth";
import { FORGOT_PATH } from "../services/passwordRecovery";

export function ResetPasswordPage() {
  const auth = useAuth();
  const recovery = auth.recovery;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cleaned, setCleaned] = useState(false);
  if (recovery.phase === "complete" || cleaned) return <Navigate to="/giris" replace state={{ passwordReset: true }} />;

  async function cleanSession() {
    if (busy) return;
    setBusy(true); setError(null);
    try { await auth.closeRecoverySession(); setCleaned(true); }
    catch { setError("Kurtarma oturumu kapatılamadı. Bağlantını kontrol edip tekrar dene."); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || recovery.phase !== "ready") return;
    setBusy(true); setError(null);
    try { await auth.updateRecoveredPassword(password, confirmation); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Parola güncellenemedi."); }
    finally { setPassword(""); setConfirmation(""); setBusy(false); }
  }

  return <>
    <PageIntro eyebrow="YENİ PAROLA" title="Hesabına güvenle dön." description="Yalnız geçerli kurtarma bağlantısıyla yeni parola belirleyebilirsin." />
    <section className="card login-panel">
      <div className="icon-box"><LockKeyhole size={28} aria-hidden="true" /></div>
      <h2>Yeni parola belirle</h2>
      {recovery.phase === "checking" && <p role="status">Kurtarma bağlantısı doğrulanıyor…</p>}
      {(recovery.phase === "ready" || recovery.phase === "saving") ? <form noValidate onSubmit={(event) => void submit(event)} aria-busy={busy}>
        <fieldset disabled={busy || recovery.phase === "saving"}>
          <legend className="sr-only">Yeni parola bilgileri</legend>
          <label htmlFor="new-password">Yeni parola</label>
          <input id="new-password" type={visible ? "text" : "password"} autoComplete="new-password" required maxLength={128} aria-describedby="new-password-help"
            value={password} onChange={(event) => setPassword(event.target.value)} />
          <p className="photo-help" id="new-password-help">8–128 karakter kullan. Eski parolanı tekrar kullanma.</p>
          <label htmlFor="new-password-confirmation">Yeni parola tekrar</label>
          <input id="new-password-confirmation" type={visible ? "text" : "password"} autoComplete="new-password" required maxLength={128}
            value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          <button type="button" className="button secondary password-visibility" aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "Parolayı gizle" : "Parolayı göster"}</button>
          <button type="submit" className="button primary">{busy && <LoaderCircle size={18} aria-hidden="true" />}{busy ? "Parola kaydediliyor…" : "Yeni parolayı kaydet"}</button>
        </fieldset>
      </form> : recovery.phase !== "checking" && <p className="photo-error" role="alert">{recovery.error ?? "Geçerli bir parola kurtarma bağlantısı gerekiyor. Yeni bağlantı iste."}</p>}
      {error && error !== recovery.error && <p className="photo-error" role="alert">{error}</p>}
      {recovery.passwordChanged && recovery.phase === "error" && <>
        <p className="notice">Parolan değiştirildi. Kurtarma oturumunu kapattıktan sonra yeni parolanla giriş yapabilirsin.</p>
        <button type="button" className="button secondary" disabled={busy} onClick={() => void cleanSession()}>{busy ? "Oturum kapatılıyor…" : "Kurtarma oturumunu kapat"}</button>
      </>}
      <p className="notice"><Link to={FORGOT_PATH}>Yeni kurtarma bağlantısı iste</Link></p>
      <p className="notice"><Link to="/giris">Giriş ekranına dön</Link></p>
    </section>
  </>;
}
