import { createContext } from "react";
import type { User } from "@supabase/supabase-js";
import type { AuthSnapshot } from "../services/auth";
import type { RecoverySnapshot } from "../services/passwordRecovery";

export interface AuthContextValue {
  status: AuthSnapshot["status"];
  user: User | null;
  error: string | null;
  identityVersion: number;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, confirmation: string): Promise<{ confirmationRequired: boolean }>;
  logout(): Promise<void>;
  recovery: RecoverySnapshot;
  requestPasswordReset(email: string): Promise<void>;
  updateRecoveredPassword(password: string, confirmation: string): Promise<void>;
  closeRecoverySession(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
