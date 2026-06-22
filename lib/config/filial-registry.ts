import type { CompanyKey } from './company';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  REGISTRY DE FILIAIS — fonte única de verdade, indexada por COD_FILIAL (ID).
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Cada filial reconhecida pelo sistema é identificada UNICAMENTE pelo seu
 * `id` = COD_FILIAL do ERP (tabela FILIAIS). O nome ("FILIAL") é volátil — muda
 * no Linx e quebra qualquer match por string. Por isso o nome NÃO é a chave aqui.
 *
 * `dbNameFallback` guarda o último nome conhecido no banco, usado apenas como
 * fallback quando o ERP está indisponível. Em operação normal, o nome real é
 * resolvido em tempo de execução via `lib/server/filial-resolver.ts`, que lê
 * a tabela FILIAIS pelo `id`. Assim, um rename no ERP se auto-corrige.
 *
 * Para adicionar uma filial nova (ex.: novo Morumbi), basta acrescentar uma
 * entrada com o COD_FILIAL correto e, se for o caso, apontar o `group`.
 */

export type FilialModule = 'sales' | 'inventory';

export interface FilialDef {
  /** COD_FILIAL exato como aparece em FILIAIS (com zeros à esquerda). Chave única. */
  id: string;
  /** Empresa lógica do dashboard. */
  company: CompanyKey;
  /** Nome de exibição (curto) na dashboard. Front-end mostra isto. */
  display: string;
  /** Último nome conhecido no banco — só fallback se o ERP estiver fora. */
  dbNameFallback: string;
  /** Em quais módulos a filial entra nos filtros operacionais. */
  modules: FilialModule[];
  /** true = filial de e-commerce (consultada via FATURAMENTO, agrupada como E-COMMERCE). */
  ecommerce?: boolean;
  /** id do grupo lógico ao qual pertence (ver FILIAL_GROUPS). */
  group?: string;
  /** Override de lead time de reposição (dias). Ausente = usa default da empresa. */
  leadTimeDays?: number;
}

export interface FilialGroupDef {
  /** slug único do grupo (estável). */
  id: string;
  company: CompanyKey;
  display: string;
  /** IDs (COD_FILIAL) dos membros do grupo (ordem indiferente). */
  memberIds: string[];
  /**
   * ID da filial operacional/ativa — ESTA é a canônica do grupo (chave de filtro
   * de vendas e de meta), não o 1º membro. Aqui é o fallback estático; a ativa
   * real é detectada em runtime por venda mais recente (active-filial-detector).
   */
  activeId: string;
}

// ── Filiais ───────────────────────────────────────────────────────────────────

// A ORDEM desta lista define a ordem das listas filialFilters (sales/inventory).
// Mantida igual à config legada para um corte sem mudança de comportamento.
export const FILIAIS: FilialDef[] = [
  // ===================== NERD =====================
  { id: '000089', company: 'nerd', display: 'CENTER NORTE', dbNameFallback: 'NERD CENTER NORTE',   modules: ['sales', 'inventory'] },
  { id: '000073', company: 'nerd', display: 'HIGIENOPOLIS', dbNameFallback: 'NERD HIGIENOPOLIS',   modules: ['sales', 'inventory'] },
  { id: '000095', company: 'nerd', display: 'LEBLON',       dbNameFallback: 'NERD LEBLON',         modules: ['sales', 'inventory'] },
  { id: '000099', company: 'nerd', display: 'MORUMBI 1',    dbNameFallback: 'NERD MORUMBI RDRRRJ', modules: ['sales', 'inventory'], group: 'morumbi-1' },
  { id: '000116', company: 'nerd', display: 'MORUMBI 1',    dbNameFallback: 'NERD MORUMBI RDRX',   modules: ['sales', 'inventory'], group: 'morumbi-1' },
  { id: '000115', company: 'nerd', display: 'MORUMBI 2',    dbNameFallback: 'NERD MORUMBI RDRRX',  modules: ['sales', 'inventory'], group: 'morumbi-2' },
  { id: '000114', company: 'nerd', display: 'ELDORADO',     dbNameFallback: 'NERD ELDORADO',       modules: ['sales', 'inventory'] },
  { id: '000076', company: 'nerd', display: 'VILLA LOBOS',  dbNameFallback: 'NERD VILLA LOBOS',    modules: ['sales', 'inventory'] },
  // MATRIZ: só em inventory; vem por último na lista legada.
  { id: '000069', company: 'nerd', display: 'MATRIZ',       dbNameFallback: 'NERD',                modules: ['inventory'],          leadTimeDays: 1 },

  // ===================== SCARF ME =====================
  { id: '000079', company: 'scarfme', display: 'GUARULHOS',    dbNameFallback: 'GUARULHOS - RSR',            modules: ['sales', 'inventory'] },
  { id: '000059', company: 'scarfme', display: 'IGUATEMI',     dbNameFallback: 'IGUATEMI SP - JJJ',          modules: ['sales', 'inventory'] },
  { id: '000055', company: 'scarfme', display: 'MORUMBI',      dbNameFallback: 'MORUMBI - JJJ',              modules: ['sales', 'inventory'] },
  { id: '000062', company: 'scarfme', display: 'OSCAR FREIRE', dbNameFallback: 'OSCAR FREIRE - FSZ',         modules: ['sales', 'inventory'] },
  { id: '000038', company: 'scarfme', display: 'HIGIENÓPOLIS', dbNameFallback: 'SCARF ME - HIGIENOPOLIS 2',  modules: ['sales', 'inventory'] },
  // IBIRAPUERA: loja DESATIVADA. Entrada mantida só para o histórico resolver o nome
  // pelo ID; modules vazio = fora de todos os filtros operacionais (sales E inventory),
  // some das listas, colunas por filial, KPIs e queries (FILIAL IN ... não a inclui).
  { id: '000101', company: 'scarfme', display: 'IBIRAPUERA',   dbNameFallback: 'SCARFME - IBIRAPUERA LLL',   modules: [] },
  { id: '000088', company: 'scarfme', display: 'PAULISTA',     dbNameFallback: 'SCARFME ME - PAULISTA FFF',  modules: ['sales', 'inventory'], group: 'paulista' },
  { id: '000046', company: 'scarfme', display: 'PAULISTA',     dbNameFallback: 'SCARF ME - PAULISTA RSR',    modules: ['sales', 'inventory'], group: 'paulista' },
  { id: '000112', company: 'scarfme', display: 'PAULISTA',     dbNameFallback: 'SCARF ME - PAULISTA FFFR',   modules: ['sales', 'inventory'], group: 'paulista' },
  { id: '000117', company: 'scarfme', display: 'PAULISTA',     dbNameFallback: 'SCARF ME PAULISTA FFFR',     modules: ['sales', 'inventory'], group: 'paulista' },
  { id: '001',    company: 'scarfme', display: 'MATRIZ',       dbNameFallback: 'SCARF ME - MATRIZ',          modules: ['sales', 'inventory'], leadTimeDays: 2 },
  { id: '000108', company: 'scarfme', display: 'E-COMMERCE',   dbNameFallback: 'SCARFME MATRIZ CMS',         modules: ['sales', 'inventory'], ecommerce: true, group: 'ecommerce-scarfme', leadTimeDays: 2 },
  { id: '000083', company: 'scarfme', display: 'E-COMMERCE',   dbNameFallback: 'SCARF ME - MATRIZ LLL',      modules: ['sales', 'inventory'], ecommerce: true, group: 'ecommerce-scarfme', leadTimeDays: 2 },
  { id: '000082', company: 'scarfme', display: 'E-COMMERCE',   dbNameFallback: 'SCARF ME MATRIZ - FFF',      modules: ['sales', 'inventory'], ecommerce: true, group: 'ecommerce-scarfme', leadTimeDays: 2 },
  { id: '000085', company: 'scarfme', display: 'VILLA LOBOS',  dbNameFallback: 'VILLA LOBOS - LLL',          modules: ['sales', 'inventory'] },
  { id: '000111', company: 'scarfme', display: 'E-COMMERCE',   dbNameFallback: 'MSC COMERCIO DE LENCOS LT',  modules: ['sales', 'inventory'], ecommerce: true, group: 'ecommerce-scarfme' },
  { id: '000109', company: 'scarfme', display: 'GALEÃO RJ',    dbNameFallback: 'SCARFME LLL -  GALEAO RJ',   modules: ['sales', 'inventory'] },
];

/**
 * Self-maps legados em activeFilials usados só para normalizar grafias de espaço
 * antigas (ex.: Galeão com 1 vs 2 espaços). Tornam-se redundantes quando o nome
 * passa a vir vivo do resolver — mantidos aqui para um corte sem mudança.
 */
export const LEGACY_ACTIVE_SELF_MAP_IDS: Record<CompanyKey, string[]> = {
  nerd: [],
  scarfme: ['000109'],
};

// ── Grupos lógicos (tratados como uma loja só) ─────────────────────────────────

export const FILIAL_GROUPS: FilialGroupDef[] = [
  { id: 'morumbi-1',         company: 'nerd',    display: 'MORUMBI 1',  memberIds: ['000099', '000116'],                     activeId: '000099' },
  { id: 'morumbi-2',         company: 'nerd',    display: 'MORUMBI 2',  memberIds: ['000115'],                               activeId: '000115' },
  { id: 'paulista',          company: 'scarfme', display: 'PAULISTA',   memberIds: ['000088', '000046', '000112', '000117'], activeId: '000117' },
  { id: 'ecommerce-scarfme', company: 'scarfme', display: 'E-COMMERCE', memberIds: ['000108', '000083', '000082', '000111'], activeId: '000111' },
];

// ── Configurações por empresa ──────────────────────────────────────────────────

export const COMPANY_LEAD_TIME_DEFAULT: Record<CompanyKey, number> = {
  nerd: 2,
  scarfme: 3,
};

/** Ordem fixa dos cards "Estoque por Filial" (por nome de exibição). */
export const ESTOQUE_FILIAL_ORDER: Record<CompanyKey, string[]> = {
  nerd: ['MATRIZ', 'MORUMBI 1', 'MORUMBI 2', 'ELDORADO', 'VILLA LOBOS', 'HIGIENOPOLIS', 'LEBLON', 'CENTER NORTE'],
  scarfme: ['MATRIZ', 'E-COMMERCE', 'GUARULHOS', 'MORUMBI', 'OSCAR FREIRE', 'VILLA LOBOS', 'GALEÃO RJ'],
};

// ── Helpers de leitura (puros, sem banco) ──────────────────────────────────────

const BY_ID = new Map(FILIAIS.map((f) => [f.id, f]));
const GROUP_BY_ID = new Map(FILIAL_GROUPS.map((g) => [g.id, g]));

/** Normaliza um COD_FILIAL para comparação tolerante a zeros à esquerda/espaços. */
export function normalizeFilialId(id: string | number | null | undefined): string {
  const raw = String(id ?? '').trim();
  if (!raw) return '';
  // "000116" e "116" devem casar; preserva forma sem zeros para a chave canônica.
  return raw.replace(/^0+/, '') || '0';
}

const BY_NORM_ID = new Map(FILIAIS.map((f) => [normalizeFilialId(f.id), f]));

export function getFilialById(id: string | number | null | undefined): FilialDef | undefined {
  const raw = String(id ?? '').trim();
  return BY_ID.get(raw) ?? BY_NORM_ID.get(normalizeFilialId(raw));
}

export function getFilialGroupById(groupId: string): FilialGroupDef | undefined {
  return GROUP_BY_ID.get(groupId);
}

export function getFiliaisByCompany(company: CompanyKey): FilialDef[] {
  return FILIAIS.filter((f) => f.company === company);
}

export function getFilialGroupsByCompany(company: CompanyKey): FilialGroupDef[] {
  return FILIAL_GROUPS.filter((g) => g.company === company);
}
