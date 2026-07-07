"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import { SidebarProvider } from "@/components/layout/SidebarContext";
import MainContent from "@/components/layout/MainContent";
import CorporativoSidebar from "@/components/layout/CorporativoSidebar";

/**
 * Shell da área CORPORATIVO. O ADMIN navega tudo (Loja, Clientes, Catálogo,
 * Pedidos) pela sidebar — Loja é o primeiro item. O cliente_corporativo NÃO vê a
 * sidebar admin: entra direto na loja com o chrome próprio (layout da loja).
 */
export default function CorporativoLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  // Cliente (ou enquanto carrega a sessão): só a loja, sem sidebar admin.
  if (user?.role !== "admin") return <>{children}</>;

  return (
    <SidebarProvider>
      <CorporativoSidebar />
      <MainContent>{children}</MainContent>
    </SidebarProvider>
  );
}
