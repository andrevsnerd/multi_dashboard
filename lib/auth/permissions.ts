import type { CompanyKey, PermissionKey, UserSession } from "@/types/auth";
import { NAV_ROUTE_MAP } from "@/lib/config/nav-route-map";

const ALL_COMPANIES: CompanyKey[] = ["nerd", "scarfme"];

/** Empresas que o usuário pode ver. Se allowedCompanies não definido ou vazio = as duas. */
export function getVisibleCompanies(user: UserSession | null): CompanyKey[] {
  if (!user) return [];
  const list = user.allowedCompanies;
  if (!list || list.length === 0) return ALL_COMPANIES;
  return list;
}

/** True se o usuário pode acessar essa empresa. */
export function canAccessCompany(user: UserSession | null, companyKey: string): boolean {
  if (!user) return false;
  const visible = getVisibleCompanies(user);
  return visible.includes(companyKey as CompanyKey);
}

/**
 * Segmento de rota (ex: "romaneios") → permissão necessária.
 * Usa NAV_ROUTE_MAP como fonte única de verdade.
 */
export function pathnameToPermission(pathname: string | null): PermissionKey | "admin" | null {
  if (!pathname || pathname === "/" || pathname === "/login") return null;
  if (pathname === "/admin") return "admin";
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 1) return "dashboard"; // /nerd → dashboard
  if (parts.length < 2) return null;
  const segment = parts[1];
  return NAV_ROUTE_MAP[segment] ?? null;
}

/**
 * Verifica se o usuário tem permissão explícita para uma página.
 * Inclui compatibilidade: "Relatório Coleção" era coberto por "Produtos" antes da permissão dedicada.
 */
export function userHasPagePermission(user: UserSession | null, key: PermissionKey): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if ((user.role === "gestor" || user.role === "logistica") && !user.permissions?.length) return true;
  const perms = user.permissions ?? [];
  if (perms.includes(key)) return true;
  if (key === "relatorio-colecao" && perms.includes("produtos")) return true;
  return false;
}

export function canAccessPath(user: UserSession | null, pathname: string | null): boolean {
  if (!user) return false;
  const perm = pathnameToPermission(pathname);
  if (perm === null) return true; // home, login, rotas sem mapeamento
  if (perm === "admin") return user.role === "admin";
  // Rota sob uma empresa: exige permissão da empresa
  const parts = pathname?.split("/").filter(Boolean) ?? [];
  const companySegment = parts[0];
  if (companySegment && (companySegment === "nerd" || companySegment === "scarfme")) {
    if (!canAccessCompany(user, companySegment)) return false;
  }
  if (user.role === "admin") return true;
  return userHasPagePermission(user, perm as PermissionKey);
}

/** Primeira rota permitida para o usuário em uma empresa (ex: /nerd/controle-transferencias). */
export function getFirstAllowedPath(user: UserSession | null, company: string): string {
  if (!user) return `/${company}`;
  if (user.role === "admin") return `/${company}`;
  if ((user.role === "gestor" || user.role === "logistica") && !user.permissions?.length) return `/${company}`;
  if (user.permissions.includes("controle-transferencias"))
    return `/${company}/controle-transferencias`;
  if (user.permissions.includes("saidas-entradas-produtos"))
    return `/${company}/saidas-entradas-produtos`;
  if (user.permissions.includes("transferencia-produtos"))
    return `/${company}/transferencia-produtos`;
  if (user.permissions.includes("dashboard")) return `/${company}`;
  const first = user.permissions[0];
  if (first) return `/${company}/${first}`;
  return `/${company}`;
}
