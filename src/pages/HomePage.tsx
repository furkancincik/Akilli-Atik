import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  Camera,
  Leaf,
  Recycle,
  ScanLine,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { categories } from "../data/categories";

const steps = [
  {
    icon: Camera,
    title: "Fotoğrafını ekle",
    text: "Kameranla fotoğraf çek veya galerinden bir görsel seç. Önizlemeyi kontrol et, gerektiğinde değiştir.",
    detail: "Atığı iyi aydınlatılmış bir ortamda, mümkünse tek başına fotoğraflandır. Kameradan ya da galeriden eklediğin görseli analiz öncesinde kontrol edebilir, kaldırabilir veya değiştirebilirsin.",
  },
  {
    icon: Sparkles,
    title: "Atığını tanı",
    text: "Analiz hizmeti açıldığında atığın türü ve ayrıştırma önerileri Türkçe olarak gösterilir.",
    detail: "Analiz hizmeti şu anda kapalı. Hizmet açıldığında hesabınla giriş yapıp fotoğrafını analiz edebileceksin. Sonuçta atık kategorisi, ayrıştırma talimatı ve varsa güvenlik uyarısı gösterilir; belirsiz sonuçlar ayrıca belirtilir.",
  },
  {
    icon: Recycle,
    title: "Doğru yere ayır",
    text: "Malzemenin türünü ve yerel toplama kurallarını dikkate alarak doğru ayrıştırma adımını seç.",
    detail: "Ayrıştırma önerisini belediyenin veya yetkili toplama noktasının kabul kurallarıyla birlikte değerlendir. Pil, elektronik ve tehlikeli atıkları evsel atıklarla karıştırma; bunlar için uygun toplama noktalarını kullan.",
  },
];

export function HomePage() {
  const stepsGrid = useRef<HTMLDivElement>(null);
  const [activeStep, setActiveStep] = useState(0);

  useLayoutEffect(() => {
    const grid = stepsGrid.current;
    const cards = Array.from(grid?.querySelectorAll<HTMLElement>(".welcome-step-reveal") ?? []);
    // Arm before the first paint, avoiding a visible -> transparent flash.
    // Unsupported motion/observer APIs always retain visible, working buttons.
    if (!cards.length || typeof IntersectionObserver !== "function" || typeof window.matchMedia !== "function") return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches || typeof preference.addEventListener !== "function") return;
    const seen = new Set<Element>();
    const frames = new Map<Element, number>();
    const timers = new Map<Element, number>();
    let stopped = false;
    let observer: IntersectionObserver | undefined;
    const show = (card: Element) => {
      const frame = frames.get(card);
      if (frame !== undefined) cancelAnimationFrame(frame);
      frames.delete(card);
      const timer = timers.get(card);
      if (timer !== undefined) window.clearTimeout(timer);
      timers.delete(card);
      card.classList.remove("is-pending", "is-revealing");
    };
    const clearMotion = () => cards.forEach(show);
    const finish = (event: AnimationEvent) => {
      if (event.animationName === "step-card-enter" && event.target === event.currentTarget && event.currentTarget instanceof HTMLElement)
        show(event.currentTarget);
    };
    const focus = (event: FocusEvent) => {
      const card = event.target instanceof Element ? event.target.closest(".welcome-step-reveal") : null;
      if (!card) return;
      // Keyboard focus must never land on a transparent pending button.
      seen.add(card);
      observer?.unobserve(card);
      show(card);
    };
    const reduceMotion = (event: MediaQueryListEvent) => {
      if (!event.matches) return;
      stopped = true;
      observer?.disconnect();
      clearMotion();
    };
    const cleanup = () => {
      stopped = true;
      observer?.disconnect();
      preference.removeEventListener("change", reduceMotion);
      grid?.removeEventListener("focusin", focus);
      cards.forEach((card) => card.removeEventListener("animationend", finish));
      clearMotion();
    };
    try {
      observer = new IntersectionObserver((entries) => {
        if (stopped || preference.matches) return;
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.15 || seen.has(entry.target)) continue;
          seen.add(entry.target);
          observer?.unobserve(entry.target);
          const card = entry.target;
          // Give the armed starting position a rendered frame, including when
          // the cards are already in view at page load. Cancel both RAFs on exit.
          frames.set(card, requestAnimationFrame(() => {
            frames.set(card, requestAnimationFrame(() => {
              frames.delete(card);
              if (stopped || preference.matches) return;
              card.classList.replace("is-pending", "is-revealing");
              // An interrupted/disabled CSS animation may not emit animationend.
              timers.set(card, window.setTimeout(() => show(card), 1000));
            }));
          }));
        }
      }, { threshold: 0.15 });
      preference.addEventListener("change", reduceMotion);
      grid?.addEventListener("focusin", focus);
      cards.forEach((card) => {
        card.classList.add("is-pending");
        card.addEventListener("animationend", finish);
        observer?.observe(card);
      });
    } catch { cleanup(); }
    return cleanup;
  }, []);

  return (
    <div className="landing-page">
      <div className="welcome landing-intro">
        <span className="eyebrow">DAHA BİLİNÇLİ BİR GÜNLÜK YAŞAM</span>
        <span className="status">Web ve Android</span>
      </div>
      <section className="hero" aria-labelledby="welcome-title">
        <div className="hero-copy">
          <span className="hero-tag">
            <Leaf size={16} aria-hidden="true" /> Küçük bir adım, daha temiz bir gelecek.
          </span>
          <h1 id="welcome-title">
            Atığını tanı.
            <br />
            <span>Doğru yere ayır.</span>
          </h1>
          <p>
            Akıllı Atık, atıkları tanımayı ve doğru ayrıştırmayı kolaylaştırmak
            için geliştirilen mobil geri dönüşüm asistanın.
          </p>
          <div className="hero-actions">
            <Link className="button primary" to="/giris?mode=register">
              Hesap oluştur <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link className="button secondary" to="/giris">
              Giriş yap
            </Link>
          </div>
          <small className="hero-disclaimer">
            Fotoğraf alma ve önizleme hazır. Yapay zekâ analizleri şu anda kapalı.
          </small>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="floating-leaf">
            <Leaf size={26} />
          </div>
          <div className="hero-visual-card">
            <div className="visual-card-heading">
              <span>AKILLI ATIK</span>
              <ScanLine size={19} />
            </div>
            <div className="visual-card-icon">
              <Recycle size={66} strokeWidth={1.5} />
            </div>
            <div className="visual-card-tags">
              <span className="visual-tag">Tanı</span>
              <span className="visual-tag">Ayrıştır</span>
              <span className="visual-tag">Koru</span>
            </div>
            <div className="visual-card-footer">
              <Camera size={16} /> Bir fotoğrafla başlar.
            </div>
          </div>
          <span className="art-label">DAHA AZ KARIŞIKLIK, DAHA BİLİNÇLİ SEÇİMLER</span>
        </div>
      </section>

      <section className="section" aria-labelledby="steps-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">NASIL ÇALIŞIR?</span>
            <h2 id="steps-title">Ayrıştırmaya giden üç adım.</h2>
          </div>
        </div>
        <p className="welcome-step-hint">Bir adım seçerek ayrıntılarını incele.</p>
        <div className="welcome-step-grid" ref={stepsGrid}>
          {steps.map(({ icon: Icon, title, text }, index) => (
            <div className="welcome-step-reveal" key={title} style={{ "--step-delay": `${index * 150}ms` } as CSSProperties}>
              <button
                type="button"
                className="card welcome-step"
                aria-pressed={activeStep === index}
                aria-controls="step-detail"
                aria-labelledby={`step-title-${index}`}
                aria-describedby={`step-summary-${index}`}
                onClick={() => setActiveStep(index)}
              >
                <span className="welcome-step-number" aria-hidden="true">0{index + 1}</span>
                <Icon size={25} aria-hidden="true" />
                <span className="welcome-step-title" id={`step-title-${index}`}>{title}</span>
                <span className="welcome-step-summary" id={`step-summary-${index}`}>{text}</span>
                <span className="welcome-step-action" aria-hidden="true">{activeStep === index ? "Seçili adım" : "Ayrıntıları göster"}<ArrowRight size={15} /></span>
              </button>
            </div>
          ))}
        </div>
        <div className="welcome-step-detail" id="step-detail" role="status" aria-live="polite" aria-atomic="true">
          {steps.map(({ title, detail }, index) => (
            <div className={`welcome-step-detail-panel${activeStep === index ? " is-active" : ""}`} aria-hidden={activeStep !== index} key={title}>
              <span className="eyebrow">ADIM 0{index + 1}</span>
              <h3>{title}</h3>
              <p>{detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="categories-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">MALZEMEYİ TANI</span>
            <h2 id="categories-title">Her atığın yolu farklı.</h2>
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
        <ShieldCheck size={26} aria-hidden="true" />
        <div>
          <strong>Bilinçli ayrıştırma, doğru bilgiyle başlar.</strong>
          <p>
            Yerel toplama kuralları değişebilir. Pil ve elektronik atıklar için
            yetkili toplama noktalarını kullan.
          </p>
        </div>
      </aside>
    </div>
  );
}
