import type { CompanyKey } from "@/lib/config/company";

export type RoleKey = "admin" | "gestor" | "logistica";

/** Chaves de permissão = segmentos de rota (ex: controle-transferencias). Admin vê tudo. */
export type PermissionKey =
  | "dashboard"
  | "produtos"
  | "produto-detalhado"
  | "relatorio-colecao"
  | "vendedores"
  | "clientes"
  | "controle-estoque"
  | "controle-giro"
  | "controle-performance"
  | "controle-movimento"
  | "controle-transferencias"
  | "exportar-relatorios"
  | "blackfriday"
  | "estoque-por-filial"
  | "transferencia-produtos"
  | "romaneios"
  | "saidas-entradas-produtos"
  | "destino-romaneio"
  | "mapa-clientes"
  | "lista-loja"
  | "curva-abc"
  | "sincronizacao";

export type { CompanyKey };

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  role: RoleKey;
  /** Apenas para role !== admin. Páginas que a função pode acessar. */
  permissions: PermissionKey[];
  /** Se definido e não vazio: apenas essas empresas. Se undefined/[]: vê as duas. */
  allowedCompanies?: CompanyKey[];
  /** Nome de exibição opcional (ex: "Maria Logística"). Se vazio, usa o username. */
  nomeExibicao?: string;
}

export interface UserSession {
  id: string;
  username: string;
  role: RoleKey;
  permissions: PermissionKey[];
  /** Se definido e não vazio: apenas essas empresas. Se undefined/[]: vê as duas. */
  allowedCompanies?: CompanyKey[];
  /** Nome de exibição opcional. Se vazio, usa o username. */
  nomeExibicao?: string;
}

/** Lista de todas as permissões para o painel admin. */
export const ALL_PERMISSION_KEYS: { key: PermissionKey; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "produtos", label: "Produtos" },
  { key: "produto-detalhado", label: "Produto Detalhado" },
  { key: "relatorio-colecao", label: "Relatório Coleção" },
  { key: "vendedores", label: "Vendedores" },
  { key: "clientes", label: "Clientes" },
  { key: "controle-estoque", label: "Controle de Estoque" },
  { key: "controle-giro", label: "Controle de Giro" },
  { key: "controle-performance", label: "Controle de Performance" },
  { key: "controle-movimento", label: "Controle de Movimento" },
  { key: "controle-transferencias", label: "Controle de Transferências" },
  { key: "exportar-relatorios", label: "Exportar Relatórios" },
  { key: "blackfriday", label: "Black Friday" },
  { key: "estoque-por-filial", label: "Estoque por Filial" },
  { key: "transferencia-produtos", label: "Transferência de Produtos" },
  { key: "romaneios", label: "Romaneios" },
  { key: "saidas-entradas-produtos", label: "Saídas e Entradas de Produtos" },
  { key: "destino-romaneio", label: "Destino Romaneio" },
  { key: "mapa-clientes", label: "Mapa de Clientes" },
  { key: "lista-loja", label: "Lista Loja" },
  { key: "curva-abc", label: "Curva A,B,C" },
  { key: "sincronizacao", label: "Sincronizacao" },
];

export const ROLE_LABELS: Record<RoleKey, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  logistica: "Logística",
};
