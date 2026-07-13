"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import { canManageCatalogo } from "@/lib/auth/permissions";
import { SidebarProvider } from "@/components/layout/SidebarContext";
import MainContent from "@/components/layout/MainContent";
import CorporativoSidebar from "@/components/layout/CorporativoSidebar";

/**
 * Shell da área CORPORATIVO. A equipe (admin/diretor/supervisor) navega pela
 * sidebar — os itens visíveis são filtrados por permissão. O cliente_corporativo
 * (e sessões carregando) NÃO vê a sidebar: entra direto na loja com o chrome próprio.
 */
export default function CorporativoLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  // Cliente (ou enquanto carrega a sessão): só a loja, sem sidebar de gestão.
  if (!canManageCatalogo(user?.role)) return <>{children}</>;

  return (
    <SidebarProvider>
      <CorporativoSidebar />
      <MainContent>{children}</MainContent>
    </SidebarProvider>
  );
}
