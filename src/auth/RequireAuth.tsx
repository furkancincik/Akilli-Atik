import { Navigate, Outlet } from "react-router";
import { useAuth } from "./useAuth";
import { routeAccess } from "./routeAccess";

export function RequireAuth({ redirectTo = "/giris" }: { redirectTo?: "/" | "/giris" }) {
  const access = routeAccess(useAuth().status);
  if (access === "loading") return <p role="status">Oturum yükleniyor…</p>;
  return access === "allow" ? <Outlet /> : <Navigate to={redirectTo} replace />;
}
