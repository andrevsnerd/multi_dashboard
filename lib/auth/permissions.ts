import { LEGACY_PERMISSION_FALLBACKS } from "@/lib/config/page-permissions";
import { NAV_ROUTE_MAP } from "@/lib/config/nav-route-map";
import { isFilialDefeito } from "@/lib/config/filiais-especiais";
import type { CompanyKey, PermissionKey, RoleKey, UserSession } from "@/types/auth";

const ALL_COMPANIES: CompanyKey[] = ["nerd", "scarfme", "corporativo"];

/**
 * Normaliza roles legados para o conjunto atual. O antigo "gestor" virou "gerente".
 * Usado na leitura de registros (banco/arquivo) para compatibilidade.
 */
export function normalizeRole(role: string | null | undefined): RoleKey {
  if (role === "gestor") return "gerente";
  return (role ?? "gerente") as RoleKey;
}

/**
 * Funcoes que enxergam TODAS as paginas, como o admin (sem depender da lista de
 * permissoes). O diretor entra aqui: ve literalmente tudo, so nao acessa /admin.
 */
export const FULL_ACCESS_ROLES: RoleKey[] = ["admin", "diretor"];

/** True se a funcao ve todas as paginas (nao depende da lista de permissoes). */
export function hasFullPageAccess(role: RoleKey | undefined | null): boolean {
  return !!role && FULL_ACCESS_ROLES.includes(role);
}

/**
 * Funcoes somente-leitura: veem tudo o que lhes cabe, mas nunca executam acoes
 * operacionais (transferencias, ajustes, edicao de romaneios, cadastro corporativo).
 */
export const READ_ONLY_ROLES: RoleKey[] = ["diretor", "supervisor"];

/** True se a funcao e somente-leitura (nao pode executar acoes que gravam dados). */
export function isReadOnlyRole(role: RoleKey | undefined | null): boolean {
  return !!role && READ_ONLY_ROLES.includes(role);
}

/** True se o usuario pode executar acoes de mutacao de dados de empresa. */
export function canMutate(user: UserSession | null): boolean {
  if (!user) return false;
  return !isReadOnlyRole(user.role);
}

/**
 * Excecao ao read-only geral: admin, diretor e supervisor podem administrar
 * o catalogo da loja corporativa (adicionar/editar/remover produtos), mesmo
 * que diretor/supervisor sejam somente-leitura no restante do sistema.
 */
export const CATALOGO_MANAGER_ROLES: RoleKey[] = ["admin", "diretor", "supervisor"];

/** True se a funcao pode administrar o catalogo da loja corporativa. */
export function canManageCatalogo(role: RoleKey | undefined | null): boolean {
  return !!role && CATALOGO_MANAGER_ROLES.includes(role);
}

/**
 * Excecao ao read-only geral: admin, diretor e supervisor podem APROVAR
 * autocadastros corporativos (efetivar o cliente no Linx), mesmo sendo
 * diretor/supervisor somente-leitura no restante do sistema.
 */
export const APPROVE_CADASTRO_ROLES: RoleKey[] = ["admin", "diretor", "supervisor"];

/** True se a funcao pode aprovar/rejeitar autocadastros corporativos. */
export function canApproveCadastro(role: RoleKey | undefined | null): boolean {
  return !!role && APPROVE_CADASTRO_ROLES.includes(role);
}

/**
 * Funcoes que enxergam TODAS as filiais em transferencias/romaneios.
 * So o gerente fica restrito a sua filial atribuida (filialAtribuida).
 */
export const ALL_FILIAIS_ROLES: RoleKey[] = ["admin", "diretor", "supervisor", "logistica"];

/** True se a funcao ve todas as filiais em transferencias/romaneios. */
export function seesAllFiliais(role: RoleKey | undefined | null): boolean {
  return !!role && ALL_FILIAIS_ROLES.includes(role);
}

/**
 * Romaneio de AJUSTE DE ESTOQUE e movimento interno (logistica/controladoria):
 * so aparece de logistica pra cima. O gerente nunca enxerga esse tipo em Romaneios.
 */
export const ROMANEIO_AJUSTE_ROLES: RoleKey[] = ["admin", "diretor", "supervisor", "logistica"];

/** True se a funcao pode ver romaneios do tipo ajuste de estoque. */
export function canSeeRomaneioAjuste(role: RoleKey | undefined | null): boolean {
  return !!role && ROMANEIO_AJUSTE_ROLES.includes(role);
}

/**
 * Reabrir um romaneio de ENTRADA para acrescentar itens (igual ao Linx) e de
 * logistica pra cima. O gerente registra a entrada da loja dele, mas NUNCA
 * reabre um romaneio ja gravado — corrigir movimento de estoque e da logistica.
 * Diretor/supervisor ficam de fora por serem somente-leitura (READ_ONLY_ROLES),
 * entao o conjunto efetivo e admin + logistica.
 */
export const EDITAR_ENTRADA_ROLES: RoleKey[] = ["admin", "logistica"];

/** True se a funcao pode acrescentar itens a um romaneio de entrada existente. */
export function canEditarRomaneioEntrada(role: RoleKey | undefined | null): boolean {
  return !!role && EDITAR_ENTRADA_ROLES.includes(role);
}

/**
 * Excecao pontual a filialAtribuida: quem aprova os romaneios de DEFEITO e a
 * MATRIZ (logistica), nao a loja que enviou. Entao a logistica confirma entrada
 * na filial de defeito da empresa (NERD DEFEITOS / BAZAR SCARF ME) ALEM da sua
 * filial atribuida. Nao libera nenhuma outra filial.
 */
export const DEFEITO_ENTRADA_ROLES: RoleKey[] = ["admin", "logistica"];

/** True se o usuario pode confirmar entrada nesta filial por ela ser a de defeito da empresa. */
export function canConfirmarEntradaDefeito(
  user: UserSession | null,
  companyKey: string,
  filialDestino: string | null | undefined
): boolean {
  if (!user || !DEFEITO_ENTRADA_ROLES.includes(user.role)) return false;
  if (!canAccessCompany(user, companyKey)) return false;
  return isFilialDefeito(companyKey, filialDestino);
}

/**
 * Funcoes que podem ver o CUSTO (KPIs, colunas, valores, exports).
 * supervisor e gerente NUNCA veem custo.
 */
export const CUSTO_VISIBLE_ROLES: RoleKey[] = ["admin", "diretor", "logistica"];

/** True se o usuario pode ver informacao de custo. */
export function canSeeCusto(user: UserSession | null): boolean {
  if (!user) return false;
  return CUSTO_VISIBLE_ROLES.includes(user.role);
}

/**
 * Permissoes restritas por funcao: mesmo que concedidas a um usuario, so
 * funcionam para as funcoes listadas. Ex: o Extrato de Produto so e acessivel
 * para admin, diretor ou logistica (gerente/supervisor nunca ve, mesmo com a pagina marcada).
 */
export const ROLE_RESTRICTED_PERMISSIONS: Partial<Record<PermissionKey, RoleKey[]>> = {
  "extrato-produto": ["admin", "diretor", "logistica"],
  // Alterar Custo / Preco mexe em custo: mesma regra de CUSTO_VISIBLE_ROLES
  // (gerente e supervisor nunca veem custo). Diretor abre, mas e somente-leitura.
  "alterar-precos": ["admin", "diretor", "logistica"],
  // Alterar Cadastro renomeia dimensao (grupo/subgrupo/linha), o que cascateia para
  // milhares de produtos e desalinha regras que casam por nome. Ato estrutural:
  // mesmo conjunto restrito, com diretor entrando somente-leitura.
  "alterar-cadastro": ["admin", "diretor", "logistica"],
  "alterar-produtos-massa": ["admin", "diretor", "logistica"],
  // Gastos de Compra e planejamento de desembolso: tela 100% custo, entao vale
  // a mesma regra de CUSTO_VISIBLE_ROLES das outras (gerente e supervisor nunca
  // veem custo). Restringir a admin+diretor tornava a permissao inutil: as duas
  // ja tem acesso total, e o checkbox sumia para a unica funcao que precisa dele.
  "gastos-compra": ["admin", "diretor", "logistica"],
  // Área corporativo é exclusiva do admin, diretor e do cliente_corporativo. Supervisor/gerente/logística
  // nunca acessam, pois roleAllowsPermission barra.
  "clientes-corporativos": ["admin", "diretor", "cliente_corporativo"],
};

/** True se a funcao do usuario pode, em tese, receber/usar essa permissao. */
export function roleAllowsPermission(role: RoleKey, key: PermissionKey): boolean {
  // admin e diretor veem tudo (inclusive paginas restritas por funcao).
  if (hasFullPageAccess(role)) return true;
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
  // admin e diretor veem todas as paginas (nao dependem da lista de permissoes).
  if (hasFullPageAccess(user.role)) return true;
  // Permissoes restritas por funcao: supervisor/gerente nunca acessam, mesmo se marcada.
  if (!roleAllowsPermission(user.role, key)) return false;

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
    // Admin/diretor podem ver qualquer empresa; demais respeitam allowedCompanies.
    if (!hasFullPageAccess(user.role) && !canAccessCompany(user, companySegment)) return false;
  }

  // Área CORPORATIVO tem dois mundos:
  //  - /corporativo/loja/**  → a LOJA (vitrine/carrinho/checkout): admin + cliente_corporativo.
  //  - resto (/corporativo, /novo, /[codigo], /catalogo, /pedidos) → gestão: admin + diretor (leitura).
  //  - supervisor: exceção pontual, só acessa /corporativo/catalogo (gerenciar catálogo).
  if (companySegment === "corporativo") {
    if (hasFullPageAccess(user.role)) return true; // admin (gestão) e diretor (leitura)
    if (user.role === "cliente_corporativo") return parts[1] === "loja";
    // Supervisor: exceções pontuais — gerenciar catálogo e aprovar autocadastros.
    if (user.role === "supervisor") return parts[1] === "catalogo" || parts[1] === "aprovacoes";
    return false;
  }

  if (hasFullPageAccess(user.role)) return true;
  return userHasPagePermission(user, perm as PermissionKey);
}

/** Primeira rota permitida para o usuario em uma empresa (ex: /nerd/controle-transferencias). */
export function getFirstAllowedPath(user: UserSession | null, company: string): string {
  if (!user) return `/${company}`;
  // Cliente corporativo entra direto na LOJA; admin cai na gestão do corporativo.
  if (user.role === "cliente_corporativo") return "/corporativo/loja";
  // Supervisor só tem acesso ao catálogo dentro de /corporativo (evita loop de redirect).
  if (user.role === "supervisor" && company === "corporativo") return "/corporativo/catalogo";
  if (company === "corporativo") return "/corporativo";
  // admin e diretor veem tudo → caem no dashboard da empresa.
  if (hasFullPageAccess(user.role)) return `/${company}`;
  if (user.permissions.includes("controle-transferencias")) return `/${company}/controle-transferencias`;
  if (user.permissions.includes("saidas-entradas-produtos")) return `/${company}/saidas-entradas-produtos`;
  if (user.permissions.includes("transferencia-produtos")) return `/${company}/transferencia-produtos`;
  if (user.permissions.includes("destino-romaneio")) return `/${company}/romaneios`;
  if (user.permissions.includes("dashboard")) return `/${company}`;

  const first = user.permissions[0];
  if (first) return `/${company}/${first}`;
  return `/${company}`;
}
