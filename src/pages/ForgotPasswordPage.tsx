import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import { Capacitor } from "@capacitor/core";
import { LoaderCircle, Mail } from "lucide-react";
import { PageIntro } from "../components/PageIntro";
import { useAuth } from "../auth/useAuth";

export function ForgotPasswordPage() {
  const auth = useAuth();
  const native = Capacitor.isNativePlatform();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A ref closes the gap before React flushes disabled/busy to the DOM.
    if (submitting.current || native) return;
    submitting.current = true;
    setBusy(true); setError(null); setSent(false);
    try { await auth.requestPasswordReset(email); setSent(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "İstek tamamlanamadı. Tekrar dene."); }
    finally { submitting.current = false; setBusy(false); }
  }

  return <>
    <PageIntro eyebrow="HESAP KURTARMA" title="Parolanı yeniden belirle." description="E-posta adresine bir kurtarma bağlantısı iste." />
    <section className="card login-panel">
      <div className="icon-box"><Mail size={28} aria-hidden="true" /></div>
      <h2>Şifremi Unuttum</h2>
      {native ? <p className="notice">Bu sürümde parola kurtarma web tarayıcısından yapılır. Geliştiricinin sağladığı web adresini kullan.</p> : <form noValidate onSubmit={(event) => void submit(event)} aria-busy={busy}>
        <fieldset disabled={busy || auth.status === "loading" || auth.status === "unavailable"}>
          <legend className="sr-only">Kurtarma e-postası</legend>
          <label htmlFor="recovery-email">E-posta</label>
          <input id="recovery-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254}
            value={email} onChange={(event) => setEmail(event.target.value)} />
          <button className="button primary" type="submit">{busy && <LoaderCircle size={18} aria-hidden="true" />}{busy ? "İstek gönderiliyor…" : "Parola Sıfırlama Bağlantısı Gönder"}</button>
        </fieldset>
      </form>}
      {error && <p className="photo-error" role="alert">{error}</p>}
      {sent && <p className="auth-confirmation" role="status">Bu adresle bir hesap varsa parola sıfırlama bağlantısı gönderilecektir. Gelen kutunu ve spam klasörünü kontrol et. Bağlantıyı bu isteği başlattığın tarayıcıda aç.</p>}
      <p className="notice"><Link to="/giris">Giriş ekranına dön</Link></p>
    </section>
  </>;
}
