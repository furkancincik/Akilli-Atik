import { lazy, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { usePhotoCapture } from "./hooks/usePhotoCapture";
import { useAuth } from "./auth/useAuth";
import { RequireAuth } from "./auth/RequireAuth";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { FORGOT_PATH, RECOVERY_PATH } from "./services/passwordRecovery";
import { DASHBOARD_PATH } from "./auth/routeAccess";

// Keep the public/auth shell small. Declare once so navigation/token refresh
// cannot recreate lazy identities or reset per-account photo state.
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((page) => ({ default: page.DashboardPage })));
const ScanPage = lazy(() => import("./pages/ScanPage").then((page) => ({ default: page.ScanPage })));
const HistoryPage = lazy(() => import("./pages/HistoryPage").then((page) => ({ default: page.HistoryPage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage").then((page) => ({ default: page.ProfilePage })));
const EcoArenaPage = lazy(() => import("./pages/EcoArenaPage").then((page) => ({ default: page.EcoArenaPage })));
export function App() {
  const { user, status, identityVersion } = useAuth();
  const [hasAuthenticated, setHasAuthenticated] = useState(status === "authenticated");
  // Retain only this non-personal flag across identity remounts. A single route
  // guard owns the destination, avoiding competing sign-out/login redirects.
  if (status === "authenticated" && !hasAuthenticated) setHasAuthenticated(true);
  // Remount all per-user state on identity change, not on token refresh/navigation.
  return <AccountRoutes key={`${user?.id ?? "guest"}:${identityVersion}`} guestDestination={hasAuthenticated ? "/" : "/giris"} />;
}

function HomeEntry() {
  const { status } = useAuth();
  if (status === "loading") return <p className="session-loading" role="status">Oturum yükleniyor…</p>;
  return status === "authenticated" ? <Navigate to={DASHBOARD_PATH} replace /> : <HomePage />;
}

function AccountRoutes({ guestDestination }: { guestDestination: "/" | "/giris" }) {
  const photoCapture = usePhotoCapture();
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomeEntry />} />
        <Route element={<RequireAuth redirectTo={guestDestination} />}>
          <Route path={DASHBOARD_PATH} element={<DashboardPage />} />
          <Route path="tara" element={<ScanPage capture={photoCapture} />} />
          <Route path="gecmis" element={<HistoryPage />} />
          <Route path="gecmis/:analysisId" element={<HistoryPage />} />
          <Route path="profil" element={<ProfilePage />} />
          <Route path="eko-arena" element={<EcoArenaPage />} />
          <Route path="istatistikler" element={<Navigate to="/profil" replace />} />
        </Route>
        <Route path="giris" element={<LoginPage />} />
        <Route path={FORGOT_PATH} element={<ForgotPasswordPage />} />
        <Route path={RECOVERY_PATH} element={<ResetPasswordPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
