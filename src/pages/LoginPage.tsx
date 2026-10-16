import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { LogIn, LoaderCircle } from "lucide-react";
import { PageIntro } from "../components/PageIntro";
import { useAuth } from "../auth/useAuth";
import { FORGOT_PATH } from "../services/passwordRecovery";
import { DASHBOARD_PATH } from "../auth/routeAccess";

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get("mode") === "register" ? "register" : "login";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (auth.status === "authenticated") return <Navigate to={DASHBOARD_PATH} replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || auth.status !== "anonymous") return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "login") {
        await auth.login(email, password);
        navigate(DASHBOARD_PATH, { replace: true });
      } else {
        const result = await auth.register(email, password, confirmation);
        if (result.confirmationRequired) {
          setNotice("Kayıt isteği alındı. Gelen kutunu ve spam klasörünü kontrol et. E-posta bağlantısını tarayıcıda onayladıktan sonra uygulamaya dönüp giriş yap. Hesabın zaten varsa giriş yapabilirsin.");
          setSearchParams({}, { replace: true });
        } else navigate(DASHBOARD_PATH, { replace: true });
      }
    } catch (reason) {
      // Controller returns only safe Turkish messages, never provider/token details.
      setError(reason instanceof Error ? reason.message : "İşlem tamamlanamadı. Tekrar dene.");
    } finally {
      setPassword("");
      setConfirmation("");
      setBusy(false);
    }
  }

  const disabled = busy || auth.status !== "anonymous";
  return (
    <>
      <PageIntro
        eyebrow="HESABIN"
        title="Daha bilinçli bir başlangıç."
        description="Hesabınla giriş yap veya e-posta adresinle yeni bir hesap oluştur."
      />
      <section className="card login-panel">
        <div className="icon-box">
          <LogIn size={28} />
        </div>
        <h2>{mode === "login" ? "Hesabına giriş yap" : "Yeni hesap oluştur"}</h2>
        {location.state?.passwordReset === true && <p className="auth-confirmation" role="status">Parolan güncellendi ve kurtarma oturumu kapatıldı. Yeni parolanla giriş yapabilirsin.</p>}
        <div className="auth-mode" aria-label="Hesap işlemi">
          {(["login", "register"] as const).map((next) => (
            <button key={next} type="button" className="button secondary" aria-pressed={mode === next} disabled={busy}
              onClick={() => { setSearchParams(next === "register" ? { mode: "register" } : {}, { replace: true }); setError(null); setNotice(null); setPassword(""); setConfirmation(""); }}>
              {next === "login" ? "Giriş yap" : "Kayıt ol"}
            </button>
          ))}
        </div>
        {auth.status === "loading" && <p role="status">Oturum yükleniyor…</p>}
        {auth.status === "unavailable" && <p className="photo-error" role="alert">Hesap hizmeti yapılandırılmadı. Bağlantı ayarları kontrol edilmeli.</p>}
        <form noValidate onSubmit={(event) => void submit(event)} aria-busy={busy}>
        <fieldset disabled={disabled}>
          <legend className="sr-only">{mode === "login" ? "Giriş bilgileri" : "Kayıt bilgileri"}</legend>
          <label htmlFor="email">E-posta</label>
          <input
            id="email"
            type="email"
            placeholder="E-posta adresin"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="password">Parola</label>
          <input
            id="password"
            type="password"
            placeholder="Parolan"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {mode === "register" && <>
            <p className="photo-help" id="password-help">En az 8 karakter kullan. Parolanı başka hesaplarında kullanma.</p>
            <label htmlFor="password-confirmation">Parola tekrarı</label>
            <input id="password-confirmation" type="password" autoComplete="new-password" required maxLength={128}
              value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          </>}
          <button className="button primary" type="submit">
            {busy && <LoaderCircle size={18} aria-hidden="true" />}
            {busy ? "İşlem sürüyor…" : mode === "login" ? "Giriş yap" : "Hesap oluştur"}
          </button>
        </fieldset>
        </form>
        {mode === "login" && <p className="notice"><Link to={FORGOT_PATH}>Şifremi Unuttum</Link></p>}
        {error && <p className="photo-error" role="alert">{error}</p>}
        {notice && <p className="auth-confirmation" role="status">{notice}</p>}
        <p className="notice">
          Analiz geçmişini ve kişisel gelişimini hesabında takip edebilirsin. Hesap oluşturmak
          analiz hizmetini açmaz; analizler kontrollü test dışında kapalıdır.
        </p>
      </section>
    </>
  );
}
