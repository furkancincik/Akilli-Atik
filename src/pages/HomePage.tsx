import { Link } from "react-router";
import {
  ArrowRight,
  ScanLine,
  Leaf,
  Camera,
  ListChecks,
  Sprout,
} from "lucide-react";
import { categories } from "../data/categories";

export function HomePage() {
  return (
    <>
      <div className="welcome">
        <span className="eyebrow">DAHA İYİ BİR GELECEK İÇİN</span>
        <span className="status">Altyapı aşaması</span>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-tag">
            <Leaf size={15} /> Doğru kutu, büyük fark.
          </span>
          <h1>
            Atığını tanı.
            <br />
            <span>Geleceğe dönüştür.</span>
          </h1>
          <p>
            Atıklarını doğru ayrıştırmak için ilk adımı at. Yapay zekâ destekli
            geri dönüşüm asistanın burada başlıyor.
          </p>
          <Link className="button primary" to="/tara">
            <ScanLine size={20} /> Atık tarama ekranı <ArrowRight size={18} />
          </Link>
          <small>Fotoğrafını seç, yapay zekâ ile ayrıştırma önerisi al.</small>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="floating-leaf">
            <Leaf size={30} />
          </div>
          <div className="recycle-emblem">
            <RecycleArt />
          </div>
          <span className="art-label">AYRIŞTIR · DÖNÜŞTÜR · KORU</span>
        </div>
      </section>
      <section className="section">
        <div className="section-heading">
          <h2>Geri dönüşüm yolculuğun</h2>
          <Link to="/istatistikler">
            İstatistikler <ArrowRight size={16} />
          </Link>
        </div>
        <div className="summary-grid">
          {[
            {
              icon: ScanLine,
              title: "Analizlerin",
              text: "Atık Tara ekranında fotoğrafını analiz et.",
            },
            {
              icon: ListChecks,
              title: "Analiz geçmişin",
              text: "Geçmiş kayıtları bağlantı sonrası burada.",
            },
            {
              icon: Sprout,
              title: "Çevresel katkın",
              text: "Doğrulanmış verilerle takip edilecek.",
            },
          ].map(({ icon: Icon, title, text }) => (
            <article className="card summary-card" key={title}>
              <Icon size={23} />
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">AYRIŞTIRMAYA BURADAN BAŞLA</span>
            <h2>Her malzemenin bir yeri var.</h2>
          </div>
          <span className="muted">8 temel atık kategorisi</span>
        </div>
        <div className="category-grid">
          {categories.map((category) => (
            <article className="card category-card" key={category.name}>
              <span className="category-number">{category.symbol}</span>
              <h3>{category.name}</h3>
              <p>{category.description}</p>
            </article>
          ))}
        </div>
      </section>
      <aside className="tip">
        <Camera size={24} />
        <div>
          <strong>Bir fotoğrafla başla.</strong>
          <p>
            Tarama ekranında fotoğrafını ekle. Analiz düğmesiyle atığın için
            ayrıştırma önerisi iste.
          </p>
        </div>
      </aside>
    </>
  );
}
function RecycleArt() {
  return (
    <svg viewBox="0 0 160 160" fill="none">
      <path
        d="M61 50 79 20c3-5 10-5 13 0l22 38M99 47l15 12 7-18M116 77l18 32c3 5-1 11-7 11H84M96 106l-13 14 13 14M66 120H33c-6 0-9-6-6-11l22-39M48 89l2-20-20 3"
        stroke="currentColor"
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
