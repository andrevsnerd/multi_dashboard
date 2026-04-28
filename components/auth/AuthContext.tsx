"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { UserSession } from "@/types/auth";
import { normalizePermissionKeys } from "@/lib/auth/permission-normalizer";

const STORAGE_KEY = "dashboard-user";

interface AuthContextValue {
  user: UserSession | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  setUser: (user: UserSession | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as UserSession;
        if (parsed?.id && parsed?.username && parsed?.role) {
          setUserState({
            ...parsed,
            permissions: normalizePermissionKeys(parsed.permissions),
          });
        }
      }
    } catch {
      // ignore
    }
    setIsLoading(false);
  }, []);

  const setUser = useCallback((u: UserSession | null) => {
    setUserState(u);
    if (typeof window !== "undefined") {
      if (u) localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
      else localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, error: data.error ?? "Erro ao fazer login" };
        }
        setUser({
          ...data.user,
          permissions: normalizePermissionKeys(data.user?.permissions),
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: "Erro de conexão" };
      }
    },
    [setUser]
  );

  const logout = useCallback(() => {
    setUser(null);
  }, [setUser]);

  const value: AuthContextValue = {
    user,
    isLoading,
    login,
    logout,
    setUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
