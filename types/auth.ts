export type RoleKey = "admin" | "gestor" | "logistica";

/** Chaves de permissão = segmentos de rota (ex: controle-transferencias). Admin vê tudo. */
export type PermissionKey =
  | "dashboard"
  | "produtos"
  | "vendedores"
  | "clientes"
  | "controle-estoque"
  | "controle-giro"
  | "controle-transferencias"
  | "exportar-relatorios"
  | "blackfriday"
  | "estoque-por-filial"
  | "transferencia-produtos";

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  role: RoleKey;
  /** Apenas para role !== admin. Páginas que a função pode acessar. */
  permissions: PermissionKey[];
}

export interface UserSession {
  id: string;
  username: string;
  role: RoleKey;
  permissions: PermissionKey[];
}

/** Lista de todas as permissões para o painel admin. */
export const ALL_PERMISSION_KEYS: { key: PermissionKey; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "produtos", label: "Produtos" },
  { key: "vendedores", label: "Vendedores" },
  { key: "clientes", label: "Clientes" },
  { key: "controle-estoque", label: "Controle de Estoque" },
  { key: "controle-giro", label: "Controle de Giro" },
  { key: "controle-transferencias", label: "Controle de Transferências" },
  { key: "exportar-relatorios", label: "Exportar Relatórios" },
  { key: "blackfriday", label: "Black Friday" },
  { key: "estoque-por-filial", label: "Estoque por Filial" },
  { key: "transferencia-produtos", label: "Transferência de Produtos" },
];

export const ROLE_LABELS: Record<RoleKey, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  logistica: "Logística",
};
