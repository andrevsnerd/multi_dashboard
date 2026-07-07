import { LEGACY_PERMISSION_FALLBACKS } from "@/lib/config/page-permissions";
import { NAV_ROUTE_MAP } from "@/lib/config/nav-route-map";
import type { CompanyKey, PermissionKey, RoleKey, UserSession } from "@/types/auth";

const ALL_COMPANIES: CompanyKey[] = ["nerd", "scarfme", "corporativo"];

/**
 * Permissoes restritas por funcao: mesmo que concedidas a um usuario, so
 * funcionam para as funcoes listadas. Ex: o Extrato de Produto so e acessivel
 * para admin ou logistica (gestor nunca ve, mesmo com a pagina marcada).
 */
export const ROLE_RESTRICTED_PERMISSIONS: Partial<Record<PermissionKey, RoleKey[]>> = {
  "extrato-produto": ["admin", "logistica"],
  // Área corporativo é exclusiva do admin e do cliente_corporativo. Gestor/logística
  // (mesmo com "sem permissões = vê tudo") nunca acessam, pois roleAllowsPermission barra.
  "clientes-corporativos": ["admin", "cliente_corporativo"],
};

/** True se a funcao do usuario pode, em tese, receber/usar essa permissao. */
export function roleAllowsPermission(role: RoleKey, key: PermissionKey): boolean {
  const allowedRoles = ROLE_RESTRICTED_PERMISSIONS[key];
  return !allowedRoles || allowedRoles.includes(role);
}

/** Empresas que o usuario pode ver. Se allowedCompanies nao definido ou vazio = as duas. */
export function getVisibleCompanies(user: UserSession | null): CompanyKey[] {
  if (!user) return [];
  const list = user.allowedCompanies;
  if (!list || list.length === 0) return ALL_COMPANIES;
  return list;
}

/** True se o usuario pode acessar essa empresa. */
export function canAccessCompany(user: UserSession | null, companyKey: string): boolean {
  if (!user) return false;
  const visible = getVisibleCompanies(user);
  return visible.includes(companyKey as CompanyKey);
}

/**
 * Segmento de rota (ex: "romaneios") -> permissao necessaria.
 * Usa NAV_ROUTE_MAP como fonte unica de verdade.
 */
export function pathnameToPermission(pathname: string | null): PermissionKey | "admin" | null {
  if (!pathname || pathname === "/" || pathname === "/login") return null;
  if (pathname === "/alterar-senha") return null;
  if (pathname === "/admin") return "admin";

  const parts = pathname.split("/").filter(Boolean);
  // Área CORPORATIVO: toda rota /corporativo/* exige a permissão clientes-corporativos.
  if (parts[0] === "corporativo") return "clientes-corporativos";
  if (parts.length === 1) return "dashboard"; // /nerd -> dashboard
  if (parts.length < 2) return null;

  for (let index = parts.length - 1; index >= 1; index -= 1) {
    const permission = NAV_ROUTE_MAP[parts[index]];
    if (permission) return permission;
  }

  return null;
}

/**
 * Verifica se o usuario tem permissao explicita para uma pagina.
 * Mantem compatibilidade com permissoes antigas que cobriam mais de uma rota.
 */
export function userHasPagePermission(user: UserSession | null, key: PermissionKey): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  // Permissoes restritas por funcao: gestor nunca acessa, mesmo se marcada.
  if (!roleAllowsPermission(user.role, key)) return false;
  if ((user.role === "gestor" || user.role === "logistica") && !user.permissions?.length) return true;

  const perms = user.permissions ?? [];
  if (perms.includes(key)) return true;

  const fallbackKeys = LEGACY_PERMISSION_FALLBACKS[key] ?? [];
  if (fallbackKeys.some((fallbackKey) => perms.includes(fallbackKey))) return true;

  return false;
}

export function canAccessPath(user: UserSession | null, pathname: string | null): boolean {
  if (!user) return false;
  const perm = pathnameToPermission(pathname);
  if (perm === null) return true; // home, login, rotas sem mapeamento
  if (perm === "admin") return user.role === "admin";

  const parts = pathname?.split("/").filter(Boolean) ?? [];
  const companySegment = parts[0];
  if (
    companySegment &&
    (companySegment === "nerd" || companySegment === "scarfme" || companySegment === "corporativo")
  ) {
    // Admin pode ver qualquer empresa; demais respeitam allowedCompanies.
    if (user.role !== "admin" && !canAccessCompany(user, companySegment)) return false;
  }

  if (user.role === "admin") return true;
  return userHasPagePermission(user, perm as PermissionKey);
}

/** Primeira rota permitida para o usuario em uma empresa (ex: /nerd/controle-transferencias). */
export function getFirstAllowedPath(user: UserSession | null, company: string): string {
  if (!user) return `/${company}`;
  // Área corporativo tem rota própria (fora do dashboard [company]).
  if (company === "corporativo") return "/corporativo";
  if (user.role === "cliente_corporativo") return "/corporativo";
  if (user.role === "admin") return `/${company}`;
  if ((user.role === "gestor" || user.role === "logistica") && !user.permissions?.length) return `/${company}`;
  if (user.permissions.includes("controle-transferencias")) return `/${company}/controle-transferencias`;
  if (user.permissions.includes("saidas-entradas-produtos")) return `/${company}/saidas-entradas-produtos`;
  if (user.permissions.includes("transferencia-produtos")) return `/${company}/transferencia-produtos`;
  if (user.permissions.includes("destino-romaneio")) return `/${company}/romaneios`;
  if (user.permissions.includes("dashboard")) return `/${company}`;

  const first = user.permissions[0];
  if (first) return `/${company}/${first}`;
  return `/${company}`;
}
