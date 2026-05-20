/**
 * Mapa central de segmentos de rota -> permissao necessaria.
 *
 * E a UNICA fonte de verdade para:
 *   - lib/auth/permissions.ts (pathnameToPermission)
 *   - painel admin (lista de paginas configuraveis)
 *
 * Para adicionar uma nova pagina:
 *   1. Adicione a entrada em `page-permissions.ts`
 *   2. Adicione o item visual no Sidebar.tsx com `permission: "chave-aqui"`
 *   3. O admin passa a exibir a nova permissao automaticamente
 */

import { PAGE_ROUTE_PERMISSION_MAP } from "@/lib/config/page-permissions";
import type { PermissionKey } from "@/types/auth";

export const NAV_ROUTE_MAP: Record<string, PermissionKey | "admin"> = {
  ...PAGE_ROUTE_PERMISSION_MAP,
  admin: "admin",
};
