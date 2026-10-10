import { NavLink, Outlet } from "react-router";
import {
  Recycle,
  House,
  ScanLine,
  History,
  ChartNoAxesCombined,
  LogIn,
  ArrowUpRight,
} from "lucide-react";

const links = [
  { to: "/", label: "Ana sayfa", icon: House },
  { to: "/tara", label: "Atık tara", icon: ScanLine },
  { to: "/gecmis", label: "Geçmiş", icon: History },
  { to: "/istatistikler", label: "İstatistikler", icon: ChartNoAxesCombined },
  { to: "/giris", label: "Giriş", icon: LogIn },
];

export function Layout() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        İçeriğe geç
      </a>
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="Smart Waste AI ana sayfa">
          <span className="brand-mark">
            <Recycle size={26} />
          </span>
          <span>
            smart waste
            <span className="brand-sub">AI GERİ DÖNÜŞÜM ASİSTANI</span>
          </span>
        </NavLink>
        <div className="nav-label">ÇALIŞMA ALANI</div>
        <nav aria-label="Ana navigasyon">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <Icon size={20} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-note">
          <Recycle size={24} />
          <strong>
            Küçük bir adım.
            <br />
            Daha yeşil bir gelecek.
          </strong>
          <p>Doğru ayrıştırma, dönüşümün başlangıcı.</p>
        </div>
        <span className="sidebar-footer">Smart Waste AI · Phase 1</span>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>Birlikte daha sürdürülebilir.</span>
          <NavLink to="/giris" className="top-link">
            Giriş yap <ArrowUpRight size={16} />
          </NavLink>
        </header>
        <main id="main" tabIndex={-1}>
          <Outlet />
        </main>
        <footer className="footer">
          <span>Her atık, yeni bir başlangıç olabilir.</span>
          <span>Üniversite sosyal sorumluluk projesi</span>
        </footer>
      </div>
    </div>
  );
}
