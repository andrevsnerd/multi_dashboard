import type { PermissionKey } from "@/types/auth";

const VALID_PERMISSION_KEYS: ReadonlySet<PermissionKey> = new Set([
  "dashboard",
  "produtos",
  "produto-detalhado",
  "relatorio-colecao",
  "vendedores",
  "clientes",
  "controle-estoque",
  "controle-giro",
  "controle-performance",
  "controle-movimento",
  "controle-transferencias",
  "exportar-relatorios",
  "blackfriday",
  "estoque-por-filial",
  "transferencia-produtos",
  "romaneios",
  "saidas-entradas-produtos",
  "destino-romaneio",
  "mapa-clientes",
  "lista-loja",
  "curva-abc",
  "sincronizacao",
]);

const LEGACY_PERMISSION_ALIASES: Record<string, PermissionKey> = {
  lista_loja: "lista-loja",
  "lista loja": "lista-loja",
  mapa_clientes: "mapa-clientes",
  "mapa clientes": "mapa-clientes",
};

function normalizeRawPermission(raw: string): PermissionKey | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (VALID_PERMISSION_KEYS.has(trimmed as PermissionKey)) return trimmed as PermissionKey;
  const alias = LEGACY_PERMISSION_ALIASES[trimmed];
  return alias ?? null;
}

export function normalizePermissionKeys(rawPermissions: unknown): PermissionKey[] {
  if (!Array.isArray(rawPermissions)) return [];
  const normalized: PermissionKey[] = [];
  const seen = new Set<PermissionKey>();

  for (const item of rawPermissions) {
    if (typeof item !== "string") continue;
    const permission = normalizeRawPermission(item);
    if (!permission || seen.has(permission)) continue;
    seen.add(permission);
    normalized.push(permission);
  }

  return normalized;
}
