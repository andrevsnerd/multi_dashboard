import { PAGE_PERMISSION_DEFINITIONS } from "@/lib/config/page-permissions";
import type { PermissionKey } from "@/types/auth";

const VALID_PERMISSION_KEYS: ReadonlySet<PermissionKey> = new Set(
  PAGE_PERMISSION_DEFINITIONS.map(({ key }) => key)
);

const LEGACY_PERMISSION_ALIASES: Record<string, PermissionKey> = {
  lista_loja: "lista-loja",
  "lista loja": "lista-loja",
  mapa_clientes: "mapa-clientes",
  "mapa clientes": "mapa-clientes",
  compras_em_transito: "compras-transito",
  "compras em transito": "compras-transito",
  "compras em trânsito": "compras-transito",
  // Renomeada: "Produto Projecao Compra" virou "Projecao Compra" (rota /projecao-compra).
  "produto-projecao-compra": "projecao-compra",
  compras_salvas: "compras-salvas",
  "compras salvas": "compras-salvas",
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
