import { LogIn } from "lucide-react";
import { PageIntro } from "../components/PageIntro";
export function LoginPage() {
  return (
    <>
      <PageIntro
        eyebrow="HESABIN"
        title="Daha bilinçli bir başlangıç."
        description="Geri dönüşüm geçmişini kişisel hesabınla takip edebileceksin."
      />
      <section className="card login-panel">
        <div className="icon-box">
          <LogIn size={28} />
        </div>
        <h2>Giriş ekranı hazırlanıyor</h2>
        <p className="muted">
          E-posta ve parola ile giriş ve kayıt, Supabase Authentication
          entegrasyonuyla eklenecek.
        </p>
        <fieldset disabled>
          <legend className="sr-only">
            Henüz etkin olmayan giriş alanları
          </legend>
          <label htmlFor="email">E-posta</label>
          <input
            id="email"
            type="email"
            placeholder="E-posta adresin"
            autoComplete="email"
          />
          <label htmlFor="password">Parola</label>
          <input
            id="password"
            type="password"
            placeholder="Parolan"
            autoComplete="current-password"
          />
          <button className="button primary" type="button">
            Giriş yap · Yakında
          </button>
        </fieldset>
        <p className="notice">
          Bu aşamada kişisel bilgi alınmaz veya oturum açılmaz.
        </p>
      </section>
    </>
  );
}
