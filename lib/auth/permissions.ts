import type { PermissionKey, UserSession } from "@/types/auth";

/** Segmento de rota (ex: controle-transferencias) a partir do pathname. */
export function pathnameToPermission(pathname: string | null): PermissionKey | "admin" | null {
  if (!pathname || pathname === "/" || pathname === "/login") return null;
  if (pathname === "/admin") return "admin";
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 1) return "dashboard"; // /nerd -> dashboard
  if (parts.length < 2) return null;
  const segment = parts[1];
  const mapping: Record<string, PermissionKey | "admin"> = {
    dashboard: "dashboard",
    produtos: "produtos",
    "produto-detalhado": "produtos",
    "produtos-recentes": "produtos",
    vendedores: "vendedores",
    clientes: "clientes",
    "controle-estoque": "controle-estoque",
    "controle-giro": "controle-giro",
    "controle-transferencias": "controle-transferencias",
    "exportar-relatorios": "exportar-relatorios",
    blackfriday: "blackfriday",
    "estoque-por-filial": "estoque-por-filial",
    "transferencia-produtos": "transferencia-produtos",
    admin: "admin",
  };
  return mapping[segment] ?? null;
}

export function canAccessPath(user: UserSession | null, pathname: string | null): boolean {
  if (!user) return false;
  const perm = pathnameToPermission(pathname);
  if (perm === null) return true; // home, login
  if (perm === "admin") return user.role === "admin"; // só admin vê painel de usuários
  if (user.role === "admin" || user.role === "gestor") return true; // gestor = mesmo que admin, exceto /admin
  return user.permissions.includes(perm as PermissionKey);
}

/** Primeira rota permitida para o usuário em uma empresa (ex: /nerd/controle-transferencias). */
export function getFirstAllowedPath(user: UserSession | null, company: string): string {
  if (!user) return `/${company}`;
  if (user.role === "admin" || user.role === "gestor") return `/${company}`;
  if (user.permissions.includes("controle-transferencias"))
    return `/${company}/controle-transferencias`;
  if (user.permissions.includes("dashboard")) return `/${company}`;
  const first = user.permissions[0];
  if (first) return `/${company}/${first}`;
  return `/${company}`;
}
