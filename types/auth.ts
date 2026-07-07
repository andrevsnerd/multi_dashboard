import type { CompanyKey } from "@/lib/config/company";
import {
  ALL_PERMISSION_KEYS as PAGE_PERMISSION_OPTIONS,
  type PermissionKey as PagePermissionKey,
} from "@/lib/config/page-permissions";

export type RoleKey = "admin" | "gestor" | "logistica" | "cliente_corporativo";

/** Chaves de permissao = paginas/perfis de acesso configuraveis no painel admin. */
export type PermissionKey = PagePermissionKey;

export type { CompanyKey };

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  role: RoleKey;
  /** Apenas para role !== admin. Paginas que a funcao pode acessar. */
  permissions: PermissionKey[];
  /** Se definido e nao vazio: apenas essas empresas. Se undefined/[]: ve as duas. */
  allowedCompanies?: CompanyKey[];
  /** Nome de exibicao opcional (ex: "Maria Logistica"). Se vazio, usa o username. */
  nomeExibicao?: string;
  /** Se true: dashboard SCARF ME inicializa sempre em modo Varejo (ignora e-commerce). */
  somenteVarejo?: boolean;
  /** Codigo (CLIFOR) do cliente atacado no Linx vinculado a este usuario (role cliente_corporativo). */
  clienteCodigo?: string;
}

export interface UserSession {
  id: string;
  username: string;
  role: RoleKey;
  permissions: PermissionKey[];
  /** Se definido e nao vazio: apenas essas empresas. Se undefined/[]: ve as duas. */
  allowedCompanies?: CompanyKey[];
  /** Nome de exibicao opcional. Se vazio, usa o username. */
  nomeExibicao?: string;
  /** Se true: dashboard SCARF ME inicializa sempre em modo Varejo (ignora e-commerce). */
  somenteVarejo?: boolean;
  /** Codigo (CLIFOR) do cliente atacado no Linx vinculado a este usuario (role cliente_corporativo). */
  clienteCodigo?: string;
}

/** Lista de todas as permissoes para o painel admin. */
export const ALL_PERMISSION_KEYS: { key: PermissionKey; label: string }[] = PAGE_PERMISSION_OPTIONS;

export const ROLE_LABELS: Record<RoleKey, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  logistica: "Logistica",
  cliente_corporativo: "Cliente Corporativo",
};
