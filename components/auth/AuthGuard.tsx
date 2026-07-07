"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { UserHeaderBar } from "./UserHeaderBar";
import { NotificacoesProvider } from "@/components/notificacoes/useNotificacoes";
import { NotificationGate } from "@/components/notificacoes/NotificationGate";
import {
  canAccessPath,
  canAccessCompany,
  getFirstAllowedPath,
  pathnameToPermission,
} from "@/lib/auth/permissions";

const PUBLIC_PATHS = ["/login"];

export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname?.startsWith(p + "/"));
    if (!isPublic && !user) {
      router.replace("/login");
      return;
    }
    if (user && pathname === "/login") {
      router.replace(user.role === "cliente_corporativo" ? "/corporativo/loja" : "/");
      return;
    }
    // Cliente corporativo não vê a seleção de empresas: vai direto para a loja.
    if (user && user.role === "cliente_corporativo" && pathname === "/") {
      router.replace("/corporativo/loja");
      return;
    }
    if (user && pathname === "/admin" && user.role !== "admin") {
      router.replace("/");
      return;
    }
    if (user && pathname && !canAccessPath(user, pathname)) {
      const perm = pathnameToPermission(pathname);
      if (perm === "admin") {
        router.replace("/");
        return;
      }
      const company = pathname.split("/")[1];
      // Empresa restrita: usuário não pode ver esta empresa → volta à seleção
      if (company && !canAccessCompany(user, company)) {
        router.replace("/");
        return;
      }
      if (company) {
        router.replace(getFirstAllowedPath(user, company));
      } else {
        router.replace("/");
      }
    }
  }, [isLoading, user, pathname, router]);

  const loadingScreen = (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--app-bg)",
      }}
    >
      <span style={{ color: "var(--t-500)" }}>Carregando...</span>
    </div>
  );

  if (isLoading) {
    return loadingScreen;
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname?.startsWith(p + "/"));
  if (!isPublic && !user) {
    return null;
  }

  // Não mostrar página proibida: redirecionar sem exibir conteúdo
  if (user && pathname && !canAccessPath(user, pathname)) {
    return loadingScreen;
  }

  return (
    <NotificacoesProvider>
      <UserHeaderBar />
      {children}
      <NotificationGate />
    </NotificacoesProvider>
  );
}
