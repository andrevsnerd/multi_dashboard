/**
 * Mapa central de segmentos de rota → permissão necessária.
 *
 * É a ÚNICA fonte de verdade para:
 *   - lib/auth/permissions.ts (pathnameToPermission)
 *   - Sidebar.tsx (filtragem de itens por permissão)
 *
 * Para adicionar uma nova página:
 *   1. Adicione a entrada aqui (segmento → PermissionKey)
 *   2. Adicione o item visual no Sidebar.tsx com `permission: "chave-aqui"`
 *   ✅ Nunca mais desincronizará.
 */

import type { PermissionKey } from "@/types/auth";

export const NAV_ROUTE_MAP: Record<string, PermissionKey | "admin"> = {
  // ── Dashboard ──────────────────────────────────────────────────
  dashboard: "dashboard",

  // ── Produtos ───────────────────────────────────────────────────
  produtos: "produtos",
  "produto-detalhado": "produtos",
  "produtos-recentes": "produtos",

  // ── Vendas / CRM ───────────────────────────────────────────────
  vendedores: "vendedores",
  clientes: "clientes",

  // ── Controles ──────────────────────────────────────────────────
  "controle-estoque": "controle-estoque",
  "controle-giro": "controle-giro",
  "controle-movimento": "controle-movimento",
  "controle-transferencias": "controle-transferencias",

  // ── Estoque por filial ─────────────────────────────────────────
  "estoque-por-filial": "estoque-por-filial",

  // ── Transferências / Romaneios / Saídas-Entradas ───────────────
  "transferencia-produtos": "transferencia-produtos",
  romaneios: "romaneios",
  "saidas-entradas-produtos": "saidas-entradas-produtos",
  "destino-romaneio": "destino-romaneio",

  // ── Relatórios / Extras ────────────────────────────────────────
  "exportar-relatorios": "exportar-relatorios",
  blackfriday: "blackfriday",

  // ── Admin ──────────────────────────────────────────────────────
  admin: "admin",
};
