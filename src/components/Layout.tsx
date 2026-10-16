import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { DASHBOARD_PATH } from "../auth/routeAccess";
import { RouteContent } from "./RouteContent";
import {
  Recycle,
  House,
  ScanLine,
  History,
  UserRound,
  Trophy,
  LogIn,
  ArrowUpRight,
  LogOut,
} from "lucide-react";

const personalLinks = [
  { to: DASHBOARD_PATH, label: "Panelim", icon: House },
  { to: "/tara", label: "Atık tara", icon: ScanLine },
  { to: "/gecmis", label: "Geçmiş", icon: History },
  { to: "/profil", label: "Profilim", icon: UserRound },
  { to: "/eko-arena", label: "Eko Arena", icon: Trophy },
];
const publicLinks = [
  { to: "/", label: "Karşılama", icon: House },
  { to: "/giris", label: "Giriş yap", icon: LogIn },
];

export function Layout() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  const logoutPending = useRef(false);
  const authenticated = auth.status === "authenticated";
  const links = authenticated ? personalLinks : publicLinks;
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, [pathname]);
  async function logout() {
    if (logoutPending.current) return;
    logoutPending.current = true;
    setSigningOut(true);
    try {
      const completion = auth.logout();
      // The controller discards personal UI synchronously. Do not wait on the
      // network before returning to the public welcome screen.
      navigate("/", { replace: true });
      await completion;
    } catch { /* The controller publishes a safe error for the new public layout. */ }
    finally { logoutPending.current = false; setSigningOut(false); }
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        İçeriğe geç
      </a>
      <aside className="sidebar">
        <NavLink to={authenticated ? DASHBOARD_PATH : "/"} className="brand" aria-label="Akıllı Atık ana sayfa">
          <span className="brand-mark">
            <Recycle size={26} />
          </span>
          <span>
            Akıllı Atık
            <span className="brand-sub">AI GERİ DÖNÜŞÜM ASİSTANI</span>
          </span>
        </NavLink>
        <div className="nav-label">{authenticated ? "KİŞİSEL ALANIN" : "KEŞFET"}</div>
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
        <span className="sidebar-footer">Akıllı Atık · Geliştirme</span>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>Birlikte daha sürdürülebilir.</span>
          {authenticated ? <div className="auth-account">
            <span>Oturum açık</span>
            <button type="button" className="top-link" disabled={signingOut} onClick={() => void logout()}>
              {signingOut ? "Çıkış yapılıyor…" : "Çıkış yap"} <LogOut size={16} />
            </button>
          </div> : auth.status === "loading" ? <span role="status">Oturum yükleniyor…</span> : <NavLink to="/giris" className="top-link">
            Giriş yap <ArrowUpRight size={16} />
          </NavLink>}
        </header>
        <main id="main" tabIndex={-1}>
          {auth.error && <p className="photo-error" role="alert">{auth.error}</p>}
          {auth.error && auth.status === "anonymous" && <button type="button" className="button secondary" disabled={signingOut} onClick={() => void logout()}>
            Cihazdaki oturumu temizle
          </button>}
          <RouteContent key={pathname}><Outlet /></RouteContent>
        </main>
        <footer className="footer">
          <span>Her atık, yeni bir başlangıç olabilir.</span>
          <span>Üniversite sosyal sorumluluk projesi</span>
        </footer>
      </div>
    </div>
  );
}
