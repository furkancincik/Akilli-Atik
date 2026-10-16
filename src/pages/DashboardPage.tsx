import { Link } from "react-router";
import {
  ArrowRight,
  Trophy,
  Camera,
  History,
  Leaf,
  UserRound,
} from "lucide-react";
import { useAuth } from "../auth/useAuth";

export function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="dashboard-page">
      <header className="dashboard-heading">
        <div>
          <span className="eyebrow">KİŞİSEL ALANIN</span>
          <h1>Tekrar hoş geldin.</h1>
          <p>Bir sonraki doğru ayrıştırma adımın burada başlıyor.</p>
        </div>
        <span className="status">Analizler şu anda kapalı</span>
      </header>

      <section className="account-banner" aria-label="Aktif hesap">
        <span className="account-avatar" aria-hidden="true">
          <UserRound size={22} />
        </span>
        <div className="account-copy">
          <strong>Oturumun açık</strong>
          <p>{user?.email || "E-posta bilgisi bulunmayan hesap"}</p>
        </div>
      </section>

      <section className="section" aria-labelledby="dashboard-actions-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">BUGÜN NEREDEN BAŞLAYALIM?</span>
            <h2 id="dashboard-actions-title">Kendi hızında, bilinçli adımlarla.</h2>
          </div>
        </div>
        <div className="dashboard-grid">
          <Link className="dashboard-primary" to="/tara">
            <span className="dashboard-primary-icon" aria-hidden="true">
              <Camera size={34} />
            </span>
            <div className="dashboard-primary-copy">
              <span className="eyebrow">FOTOĞRAFLA BAŞLA</span>
              <h3>Atık tarama ekranı</h3>
              <p>
                Kameradan fotoğraf çek veya galerinden seç. Görselini önizle,
                gerektiğinde değiştir.
              </p>
              <span className="dashboard-status">
                Yapay zekâ analizleri şu anda kapalı.
              </span>
            </div>
            <ArrowRight size={24} aria-hidden="true" />
          </Link>

          <Link className="card dashboard-link-card" to="/gecmis">
            <span className="dashboard-card-icon" aria-hidden="true">
              <History size={25} />
            </span>
            <h3>Analiz geçmişim</h3>
            <p>
              Kaydettiğin analizleri ve ayrıştırma önerilerini yeniden incele.
            </p>
            <span className="dashboard-status">Kayıtlarını görüntüle</span>
            <ArrowRight size={19} aria-hidden="true" />
          </Link>

          <Link className="card dashboard-link-card" to="/profil">
            <span className="dashboard-card-icon" aria-hidden="true">
              <UserRound size={25} />
            </span>
            <h3>Profilim</h3>
            <p>
              XP ve seviyeni gör, rozetlerini keşfet ve kısa analiz özetini incele.
            </p>
            <span className="dashboard-status">Yolculuğunu görüntüle</span>
            <ArrowRight size={19} aria-hidden="true" />
          </Link>
          <Link className="card dashboard-link-card" to="/eko-arena">
            <span className="dashboard-card-icon" aria-hidden="true"><Trophy size={25} /></span>
            <h3>Eko Arena</h3>
            <p>Katılmayı seçen kullanıcıların XP sıralamasını incele. Katılımını profilinden yönet.</p>
            <span className="dashboard-status">Birlikte öğren</span>
            <ArrowRight size={19} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <aside className="tip">
        <Leaf size={26} aria-hidden="true" />
        <div>
          <strong>Doğru ayrıştırma, günlük bir alışkanlık.</strong>
          <p>
            Ambalajları boşalt, malzemeleri ayrı tut ve belediyenin toplama
            kurallarını kontrol et. Küçük adımların değerli.
          </p>
        </div>
      </aside>
    </div>
  );
}
