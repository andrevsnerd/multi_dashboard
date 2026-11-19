import { buildDerivedFilialConfig, staticNameOf } from './filial-config-builder';

export type CompanyKey = 'nerd' | 'scarfme' | 'corporativo';

export type CompanyModule = 'sales' | 'inventory';

// Valor especial para representar "VAREJO" (apenas filiais normais, sem ecommerce)
// Usado apenas para scarfme
export const VAREJO_VALUE = "__VAREJO__";

// Filial virtual "SHOPIFY SCARFME" / "SHOPIFY NERD" (loja online pelo Shopify). Por enquanto
// só a TELA PRINCIPAL (dashboard) usa: lá ela substitui o E-COMMERCE do Linx (Scarf Me) e
// entra como filial nova na NERD. Nas outras telas o e-commerce continua vindo do Linx.
export const SHOPIFY_VALUE = "__SHOPIFY__";
export const SHOPIFY_LABEL: Record<"nerd" | "scarfme", string> = {
  scarfme: "SHOPIFY SCARFME",
  nerd: "SHOPIFY NERD",
};

export interface CompanyConfig {
  key: CompanyKey;
  name: string;
  filialFilters: Record<CompanyModule, string[]>;
  filialDisplayNames?: Record<string, string>;
  /** Ordem fixa dos cards "Estoque por Filial" (por nome de exibição) */
  estoqueFilialOrder?: string[];
  ecommerceFilials?: string[];
  /**
   * Pernas que FORAM e-commerce até uma data (exclusive) e hoje têm outro papel (ex.: MSC
   * 000111 → Higienópolis em 19/11/2026). NÃO estão em `ecommerceFilials` (que é o papel
   * ATUAL: rodízio, estoque, exclusão do VAREJO). Só entram no FATURAMENTO de e-commerce
   * com `EMISSAO < until` — use sempre `buildEcommerceFaturamentoFilialSql`.
   */
  ecommerceHistory?: Array<{ filial: string; until: string }>;
  /** Início (YYYY-MM-DD, inclusive) do papel atual da filial. Ver FilialDef.since. */
  filialSince?: Record<string, string>;
  excludedLines?: string[]; // Linhas excluídas de cálculos de estoque e vendas
  /**
   * Grupos de filiais que devem ser tratados como uma só filial lógica.
   * Chave = filial canônica (representante, usada como valor do filtro).
   * Valor = todas as filiais do grupo (incluindo a canônica).
   * Quando a filial canônica é selecionada, todas do grupo são incluídas nas consultas.
   */
  filialGroups?: Record<string, string[]>;
  activeFilials?: Record<string, string>;
  /** Lead time de reposição em dias (pode ser global e/ou por filial canônica). */
  leadTimeDays?: {
    default?: number;
    byFilial?: Record<string, number>;
  };
}

/**
 * Os campos de filial (filialFilters, filialDisplayNames, ecommerceFilials,
 * estoqueFilialOrder, filialGroups, activeFilials, leadTimeDays) são DERIVADOS do
 * registry por ID (`filial-registry.ts`) via `buildDerivedFilialConfig`. Aqui usamos
 * os nomes fallback (estáticos); o nome vivo do banco é injetado no caminho server
 * que monta SQL. Não edite estes campos à mão — edite o registry.
 */
const companyConfigs: Record<CompanyKey, CompanyConfig> = {
  nerd: {
    key: 'nerd',
    name: 'NERD',
    ...buildDerivedFilialConfig('nerd', staticNameOf),
  },
  scarfme: {
    key: 'scarfme',
    name: 'SCARF ME',
    ...buildDerivedFilialConfig('scarfme', staticNameOf),
    excludedLines: [
      'PRIVATE LABEL',
      'GASTRONOMICA',
      'PERFUMARIA',
      'CASHMERE',
      'ELETRONICOS',
      'EMBALAGENS',
      'CAPAS E ACESSORIOS P/ CEL',
    ],
  },
  // CORPORATIVO não é uma operação de varejo: não tem filiais/estoque/vendas.
  // É uma área dedicada ao cadastro de clientes corporativos (atacado). Os campos
  // de filial ficam vazios de propósito; a área vive fora do dashboard [company].
  corporativo: {
    key: 'corporativo',
    name: 'CORPORATIVO',
    ...buildDerivedFilialConfig('corporativo', staticNameOf),
  },
};

export function resolveCompany(company?: string): CompanyConfig | null {
  if (!company) {
    return null;
  }

  const normalized = company.toLowerCase() as CompanyKey;
  return companyConfigs[normalized] ?? null;
}

/**
 * Retorna todas as filiais do banco que compõem a filial lógica selecionada.
 * Se a filial não pertencer a nenhum grupo, retorna [filial].
 */
export function getFilialGroupMembers(company: CompanyConfig, filial: string): string[] {
  const normalizedFilial = normalizeFilialNameForMatch(filial).toUpperCase();
  const groups = company.filialGroups ?? {};
  // É a filial canônica de um grupo?
  for (const [canonical, members] of Object.entries(groups)) {
    if (normalizeFilialNameForMatch(canonical).toUpperCase() === normalizedFilial) {
      return members;
    }
  }
  // É membro não-canônico de algum grupo?
  for (const members of Object.values(groups)) {
    if (members.some((member) => normalizeFilialNameForMatch(member).toUpperCase() === normalizedFilial)) {
      return members;
    }
  }
  // E-commerce também é um grupo lógico (lista própria, não em filialGroups):
  // qualquer filial de e-commerce representa o grupo inteiro. Mesmo tratamento dos
  // demais grupos → faturamento/meta somam TODOS os membros, canônica = ativa.
  const ecommerce = company.ecommerceFilials ?? [];
  if (ecommerce.some((f) => normalizeFilialNameForMatch(f).toUpperCase() === normalizedFilial)) {
    return ecommerce;
  }
  return [filial];
}

// ── E-commerce por PERÍODO ────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' → literal SQL 'YYYYMMDD' (formato que o SQL Server lê igual em qualquer idioma). */
function sqlDateLiteral(iso: string): string {
  if (!ISO_DATE.test(iso)) throw new Error(`Data de corte de filial inválida: ${iso}`);
  return `'${iso.replace(/-/g, '')}'`;
}

/**
 * Todos os nomes cujo FATURAMENTO 100.02/100.022 conta como E-COMMERCE em algum período:
 * pernas atuais + históricas. Serve só para CLASSIFICAR/rotular linhas de FATURAMENTO
 * como "E-COMMERCE" — nunca para listas de loja, estoque ou exclusão do VAREJO (essas usam
 * `ecommerceFilials`, o papel atual).
 */
export function getEcommerceSalesFilials(company: CompanyConfig | null | undefined): string[] {
  if (!company) return [];
  return [...(company.ecommerceFilials ?? []), ...(company.ecommerceHistory ?? []).map((h) => h.filial)];
}

function isEcommerceHistoryLeg(company: CompanyConfig | null | undefined, filial: string): boolean {
  const key = normalizeFilialLookupKey(filial);
  return (company?.ecommerceHistory ?? []).some((h) => normalizeFilialLookupKey(h.filial) === key);
}

/**
 * Filiais cujas METAS gravadas somam para a linha da filial selecionada.
 *
 * Meta gravada sob uma perna histórica de e-commerce (ex.: MSC) é a fatia que o modal de
 * metas dividiu entre os CNPJs do rodízio quando ela ainda era e-commerce — então conta
 * SEMPRE para o E-COMMERCE e nunca para a loja que ela virou (meta de loja é gravada na
 * canônica estática do grupo, não nela).
 */
export function getGoalMembers(company: CompanyConfig, filial: string): string[] {
  const members = getFilialGroupMembers(company, filial);
  const isEcom = members.some((m) =>
    (company.ecommerceFilials ?? []).some((e) => normalizeFilialLookupKey(e) === normalizeFilialLookupKey(m))
  );
  if (isEcom) return getEcommerceSalesFilials(company);
  return members.filter((m) => !isEcommerceHistoryLeg(company, m));
}

/** Lojas físicas para a META do VAREJO: sem e-commerce atual nem perna histórica dele. */
export function getVarejoGoalFilials(company: CompanyConfig): string[] {
  const ecommerce = new Set((company.ecommerceFilials ?? []).map(normalizeFilialLookupKey));
  return company.filialFilters.sales.filter(
    (f) => !ecommerce.has(normalizeFilialLookupKey(f)) && !isEcommerceHistoryLeg(company, f)
  );
}

/**
 * Rótulo de uma linha de FATURAMENTO de e-commerce. Perna histórica (ex.: MSC) mostra o
 * papel DA ÉPOCA da nota — "E-COMMERCE" —, não o atual (que seria "HIGIENÓPOLIS").
 * Para as demais, devolve o `filialDisplayNames` de sempre.
 */
export function ecommerceFaturamentoDisplayName(
  company: CompanyConfig | null | undefined,
  filial: string
): string {
  const name = (filial || '').trim();
  const display = company?.filialDisplayNames ?? {};
  const isHistory = (company?.ecommerceHistory ?? []).some((h) => h.filial.trim() === name);
  if (isHistory) {
    const firstCurrent = company?.ecommerceFilials?.[0];
    return (firstCurrent && display[firstCurrent]) || 'E-COMMERCE';
  }
  return display[name] ?? name;
}

/**
 * Filtro de filial do FATURAMENTO de e-commerce, respeitando o PAPEL POR PERÍODO.
 *
 * Pernas atuais entram sem data; pernas históricas (ex.: MSC até 19/11/2026) só com
 * `EMISSAO < corte`. Gera, por exemplo:
 *   (f.FILIAL IN (@e0, @e1) OR (f.FILIAL = @e2 AND f.EMISSAO < '20261119'))
 *
 * - `bind(valor, i)` registra o parâmetro no request do chamador e devolve o placeholder
 *   (use sql.VarChar — NVarChar mata o index seek no proxy).
 * - `current`: pernas atuais a incluir (default: todas as `ecommerceFilials`). Passe a lista
 *   que o chamador já usava (ex.: escopo da tela) para não mudar o recorte atual.
 * - `includeHistory`: default true. Passe false só quando o recorte NÃO é o e-commerce
 *   inteiro (ex.: o usuário filtrou uma perna específica que não é a histórica).
 *
 * Devolve '' quando não sobra nenhuma filial (mesmo contrato de "lista vazia" dos chamadores).
 * Sem `AND` na frente: o chamador compõe.
 */
export function buildEcommerceFaturamentoFilialSql(
  company: CompanyConfig | null | undefined,
  opts: {
    filialColumn: string;
    dateColumn: string;
    bind: (value: string, index: number) => string;
    current?: string[];
    includeHistory?: boolean;
  }
): string {
  const current = opts.current ?? company?.ecommerceFilials ?? [];
  const currentSet = new Set(current);
  const history = opts.includeHistory === false
    ? []
    : (company?.ecommerceHistory ?? []).filter((h) => !currentSet.has(h.filial));

  let i = 0;
  const parts: string[] = [];
  if (current.length > 0) {
    parts.push(`${opts.filialColumn} IN (${current.map((f) => opts.bind(f, i++)).join(', ')})`);
  }
  for (const h of history) {
    parts.push(`(${opts.filialColumn} = ${opts.bind(h.filial, i++)} AND ${opts.dateColumn} < ${sqlDateLiteral(h.until)})`);
  }
  if (parts.length === 0) return '';
  return parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`;
}

export function isEcommerceFilial(
  companySlug?: string,
  filial?: string | null
): boolean {
  if (!companySlug || !filial) {
    return false;
  }

  const company = resolveCompany(companySlug);
  if (!company) {
    return false;
  }

  const ecommerceFilials = company.ecommerceFilials ?? [];
  return ecommerceFilials.includes(filial);
}

/** Normaliza nome de filial do ERP para bater com filialDisplayNames / listas (espaços, hífens unicode). */
function normalizeFilialNameForMatch(s: string): string {
  return s
    .trim()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ');
}

export function normalizeFilialLookupKey(rawFilial: string): string {
  return normalizeFilialNameForMatch(rawFilial)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Nome curto da filial como na dashboard (E-COMMERCE, PAULISTA, MATRIZ, …). */
function findActiveRule(company: CompanyConfig, filial: string): string | null {
  const normalizedFilial = normalizeFilialNameForMatch(filial).toUpperCase();
  const rules = company.activeFilials ?? {};

  for (const [from, to] of Object.entries(rules)) {
    if (normalizeFilialNameForMatch(from).toUpperCase() === normalizedFilial) {
      return to;
    }
  }

  for (const [canonical, members] of Object.entries(company.filialGroups ?? {})) {
    const isSameGroup =
      normalizeFilialNameForMatch(canonical).toUpperCase() === normalizedFilial ||
      members.some((member) => normalizeFilialNameForMatch(member).toUpperCase() === normalizedFilial);

    if (isSameGroup) {
      return rules[canonical] ?? canonical;
    }
  }

  return null;
}

export function getActiveFilial(
  company: CompanyConfig | null | undefined,
  filial: string | null | undefined
): string {
  const raw = (filial || '').trim();
  if (!company || !raw) return raw;
  return findActiveRule(company, raw) ?? raw;
}

export function isActiveFilial(
  company: CompanyConfig | null | undefined,
  filial: string | null | undefined
): boolean {
  const raw = (filial || '').trim();
  if (!company || !raw) return Boolean(raw);
  return normalizeFilialNameForMatch(getActiveFilial(company, raw)).toUpperCase() ===
    normalizeFilialNameForMatch(raw).toUpperCase();
}

/**
 * Reduz uma lista de filiais às que CARREGAM saldo de estoque: uma por grupo — a ATIVA.
 *
 * Um grupo multi-CNPJ (rodízio fiscal do e-commerce, PAULISTA, MORUMBI 1) é uma loja só.
 * O saldo que existe de verdade para vender ou enviar é o da perna ativa; mercadoria
 * parada num CNPJ que não fatura mais não pode sair, então somá-la ao balde do grupo faz
 * a tela prometer estoque que a loja ativa não tem (ex.: barra 046500 aparecia com 2 no
 * E-COMMERCE, mas os 2 estavam na MSC, parada, e a AKS ativa tinha zero).
 *
 * Vale SÓ para estoque. Vendas continuam somando o grupo inteiro — o histórico de
 * faturamento das pernas antigas é legítimo e não deve ser descartado.
 *
 * Filial sem grupo passa direto (getActiveFilial é identidade).
 */
export function filterStockCarryingFilials(
  company: CompanyConfig | null | undefined,
  filiais: string[]
): string[] {
  if (!company) return filiais;
  return filiais.filter((filial) => isActiveFilial(company, filial));
}

/**
 * Rótulo curto que identifica QUAL CNPJ do grupo está em jogo, para exibir ao lado do
 * nome lógico (ex.: "E-COMMERCE ᴀᴋs", "PAULISTA ғғғʀ"). Sem isso, um grupo multi-CNPJ
 * não deixa claro de qual entidade o número está saindo — e no rodízio fiscal do
 * e-commerce isso troca a cada ~15 dias.
 *
 * Devolve o primeiro token do nome que NENHUM outro membro do grupo tem; se não houver
 * (dois membros com nomes de tokens idênticos), cai no último token, que é o sufixo que
 * o ERP usa para diferenciar CNPJ. Pegar sempre o último não serve: MSC e AKS terminam
 * as duas em "LT", então o discriminante delas é o prefixo.
 *
 * Devolve null para filial sem grupo — aí o nome já é único e a label seria ruído.
 */
export function getFilialGroupTag(
  company: CompanyConfig | null | undefined,
  filial: string | null | undefined
): string | null {
  const raw = (filial || '').trim();
  if (!company || !raw) return null;

  const members = getFilialGroupMembers(company, raw);
  if (members.length <= 1) return null;

  const tokenize = (s: string) =>
    normalizeFilialNameForMatch(s)
      .toUpperCase()
      .split(/[\s\-]+/)
      .filter(Boolean);

  const own = tokenize(raw);
  if (own.length === 0) return null;

  const normalizedRaw = normalizeFilialNameForMatch(raw).toUpperCase();
  const others = members
    .filter((m) => normalizeFilialNameForMatch(m).toUpperCase() !== normalizedRaw)
    .map((m) => new Set(tokenize(m)));

  const unique = own.find((t) => others.every((set) => !set.has(t)));
  return unique ?? own[own.length - 1] ?? null;
}

export function getOperationalFilials(
  company: CompanyConfig | null | undefined,
  module: CompanyModule = 'inventory'
): string[] {
  if (!company) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const filial of company.filialFilters[module] ?? []) {
    const active = getActiveFilial(company, filial);
    const key = normalizeFilialNameForMatch(active).toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(active);
  }

  return result;
}

export function normalizeOperationalFilialList(
  company: CompanyConfig | null | undefined,
  filiais: string[]
): string[] {
  if (!company) return filiais;
  const seen = new Set<string>();
  const result: string[] = [];

  for (const filial of filiais) {
    const active = getActiveFilial(company, filial);
    const key = normalizeFilialNameForMatch(active).toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(active);
  }

  return result;
}

export function getFilialLabelForDisplay(
  company: CompanyConfig | null | undefined,
  rawFilial: string
): string {
  const t = normalizeFilialNameForMatch(rawFilial);
  if (!company) return t;

  const map = company.filialDisplayNames;
  if (map) {
    if (map[rawFilial] !== undefined) return map[rawFilial];
    if (map[t] !== undefined) return map[t];
    for (const [key, label] of Object.entries(map)) {
      if (normalizeFilialNameForMatch(key) === t) return label;
    }
  }

  const ecommerce = company.ecommerceFilials ?? [];
  if (ecommerce.some((f) => normalizeFilialNameForMatch(f) === t)) {
    return 'E-COMMERCE';
  }

  const groups = company.filialGroups ?? {};
  for (const [canonical, members] of Object.entries(groups)) {
    if (normalizeFilialNameForMatch(canonical) === t) {
      return map?.[canonical] ?? map?.[members[0] ?? ''] ?? canonical;
    }
    for (const m of members) {
      if (normalizeFilialNameForMatch(m) === t) {
        return map?.[canonical] ?? map?.[m] ?? canonical;
      }
    }
  }

  return t;
}

/**
 * Soma vendas por filial quando vários códigos ERP compartilham o mesmo rótulo de exibição
 * (ex.: filiais de e-commerce → "E-COMMERCE"; Paulista → "PAULISTA").
 */
export function aggregateVendasPorFilialByDisplayLabel<
  T extends { filial: string; qtde12m: number; qtde60d: number },
>(rows: T[], company: CompanyConfig | null | undefined): T[] {
  const acc = new Map<string, { qtde12m: number; qtde60d: number }>();
  for (const r of rows) {
    const label = getFilialLabelForDisplay(company, r.filial);
    const prev = acc.get(label);
    if (!prev) {
      acc.set(label, { qtde12m: r.qtde12m, qtde60d: r.qtde60d });
    } else {
      acc.set(label, {
        qtde12m: prev.qtde12m + r.qtde12m,
        qtde60d: prev.qtde60d + r.qtde60d,
      });
    }
  }
  return Array.from(acc.entries()).map(([filial, v]) => ({
    filial,
    qtde12m: v.qtde12m,
    qtde60d: v.qtde60d,
  })) as T[];
}

export function aggregateEstoquePorFilialByDisplayLabel<
  T extends { filial: string; estoque: number },
>(rows: T[], company: CompanyConfig | null | undefined): T[] {
  const acc = new Map<string, number>();
  for (const row of rows) {
    const label = getFilialLabelForDisplay(company, row.filial);
    acc.set(label, (acc.get(label) ?? 0) + Number(row.estoque ?? 0));
  }
  return Array.from(acc.entries()).map(([filial, estoque]) => ({
    filial,
    estoque,
  })) as T[];
}

export function compareFilialDisplayOrder(
  a: string,
  b: string,
  company: CompanyConfig | null | undefined
): number {
  const ord = company?.estoqueFilialOrder ?? [];
  const ia = ord.indexOf(a);
  const ib = ord.indexOf(b);
  const fa = ia === -1 ? 999 : ia;
  const fb = ib === -1 ? 999 : ib;
  if (fa !== fb) return fa - fb;
  return a.localeCompare(b, "pt-BR");
}
