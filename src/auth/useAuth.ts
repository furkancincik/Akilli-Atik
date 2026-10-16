import { useContext } from "react";
import { AuthContext } from "./AuthContext";

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("Oturum sağlayıcısı başlatılmadı.");
  return value;
}
