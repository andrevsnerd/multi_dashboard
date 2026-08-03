/**
 * Alteração de Custo / Preço no cadastro do Linx.
 *
 * Porte do script `AUTOMACOES/alterar_custo_produto.py` para o dashboard, com filtros
 * de catálogo (código, nome, grupo, subgrupo, linha, coleção, grade, tipo) e edição
 * individual OU em massa, escolhendo quais colunas alterar.
 *
 * Duas fontes de valor, exatamente como no script:
 *
 *  1. PRODUTOS       → cadastro do produto (1 linha por produto).
 *                      CUSTO_REPOSICAO1..4, PRECO_REPOSICAO_1..4, PRECO_A_VISTA_REPOSICAO_1..4.
 *                      ATENÇÃO: PRODUTOS **não tem** PRECO_LIQUIDO1..4 nesta base (o script
 *                      tentava e caía no fallback silencioso). Aqui nem tentamos.
 *  2. PRODUTOS_PRECOS → tabelas de preço (PK PRODUTO + CODIGO_TAB_PRECO).
 *                      PRECO1..4 e PRECO_LIQUIDO1..4, descrição em TABELAS_PRECO.
 *
 * Espelhos (mesma regra do script, opcional na tela):
 *  - PRECOn        → PRECO_LIQUIDOn        (o script sempre gravava os dois juntos)
 *  - PRECO_REPOSICAO_n → PRECO_A_VISTA_REPOSICAO_n (hoje são idênticos em 100% da base)
 * Os espelhos entram como ALTERAÇÕES EXPLÍCITAS (mesma trilha de auditoria e de estorno),
 * não como um SET extra escondido.
 *
 * Não existe transação: em produção as queries passam pelo proxy HTTP, onde cada
 * statement é uma requisição isolada. Por isso o fluxo é ler → alterar → reler para
 * confirmar → gravar histórico, e o estorno é uma nova alteração (nada é apagado),
 * igual ao "desfazer" do Ajuste de Estoque.
 */

import sql from 'mssql';

import { withRequest } from '@/lib/db/connection';
import type { RequestLike } from '@/lib/db/proxy';

/** SQL Server aceita ~2100 parâmetros; 400 produtos (2 params cada) é folgado. */
const CHUNK = 400;
/** Teto de linhas devolvidas para a grade (evita travar o navegador). */
export const LIMITE_PRODUTOS = 3000;
/** Teto de células por execução. */
export const LIMITE_ALTERACOES = 20000;

export type PrecoCompany = 'nerd' | 'scarfme';
export type PrecoOrigem = 'PRODUTOS' | 'PRODUTOS_PRECOS';

/**
 * PRODUTOS.EMPRESA por empresa do dashboard. Mesmo mapa de `faturamento.ts`
 * (nerd = 8; scarfme = 1 + entidades fiscais). No cadastro só aparecem 1, 8 e um
 * punhado de itens soltos em outros códigos — daí o escopo "todo o cadastro".
 */
const EMPRESA_CODES: Record<PrecoCompany, number[]> = {
  nerd: [8],
  scarfme: [1, 10, 13, 15, 16],
};

// ───────────────────────── campos alteráveis ─────────────────────────

interface CampoDef {
  campo: string;
  label: string;
  /** Coluna espelhada quando o usuário mantém a sincronização ligada. */
  espelho?: string;
  /** Fora do conjunto principal — só aparece com "mostrar campos avançados". */
  avancado: boolean;
}

/** Colunas alteráveis em PRODUTOS (whitelist — nada aqui vem do cliente). */
const CAMPOS_PRODUTOS: CampoDef[] = [
  { campo: 'CUSTO_REPOSICAO1', label: 'Custo de reposição', avancado: false },
  { campo: 'PRECO_REPOSICAO_1', label: 'Preço sugerido', espelho: 'PRECO_A_VISTA_REPOSICAO_1', avancado: false },
  { campo: 'PRECO_A_VISTA_REPOSICAO_1', label: 'Preço à vista', avancado: true },
  { campo: 'CUSTO_REPOSICAO2', label: 'Custo de reposição 2', avancado: true },
  { campo: 'CUSTO_REPOSICAO3', label: 'Custo de reposição 3', avancado: true },
  { campo: 'CUSTO_REPOSICAO4', label: 'Custo de reposição 4', avancado: true },
  { campo: 'PRECO_REPOSICAO_2', label: 'Preço sugerido 2', espelho: 'PRECO_A_VISTA_REPOSICAO_2', avancado: true },
  { campo: 'PRECO_REPOSICAO_3', label: 'Preço sugerido 3', espelho: 'PRECO_A_VISTA_REPOSICAO_3', avancado: true },
  { campo: 'PRECO_REPOSICAO_4', label: 'Preço sugerido 4', espelho: 'PRECO_A_VISTA_REPOSICAO_4', avancado: true },
  { campo: 'PRECO_A_VISTA_REPOSICAO_2', label: 'Preço à vista 2', avancado: true },
  { campo: 'PRECO_A_VISTA_REPOSICAO_3', label: 'Preço à vista 3', avancado: true },
  { campo: 'PRECO_A_VISTA_REPOSICAO_4', label: 'Preço à vista 4', avancado: true },
];

/** Colunas alteráveis em PRODUTOS_PRECOS (whitelist). */
const CAMPOS_PRECOS: CampoDef[] = [
  { campo: 'PRECO1', label: 'Preço (1)', espelho: 'PRECO_LIQUIDO1', avancado: false },
  { campo: 'PRECO_LIQUIDO1', label: 'Preço líquido (1)', avancado: false },
  { campo: 'PRECO2', label: 'Preço (2)', espelho: 'PRECO_LIQUIDO2', avancado: true },
  { campo: 'PRECO_LIQUIDO2', label: 'Preço líquido (2)', avancado: true },
  { campo: 'PRECO3', label: 'Preço (3)', espelho: 'PRECO_LIQUIDO3', avancado: true },
  { campo: 'PRECO_LIQUIDO3', label: 'Preço líquido (3)', avancado: true },
  { campo: 'PRECO4', label: 'Preço (4)', espelho: 'PRECO_LIQUIDO4', avancado: true },
  { campo: 'PRECO_LIQUIDO4', label: 'Preço líquido (4)', avancado: true },
];

const MAPA_PRODUTOS = new Map(CAMPOS_PRODUTOS.map((c) => [c.campo, c] as const));
const MAPA_PRECOS = new Map(CAMPOS_PRECOS.map((c) => [c.campo, c] as const));

export interface CampoAlvo {
  /** Chave estável usada pela UI: `P::COLUNA` ou `T::<tabela>::COLUNA`. */
  key: string;
  origem: PrecoOrigem;
  campo: string;
  codigoTabela: string | null;
  label: string;
  espelho: string | null;
  avancado: boolean;
}

/** Código de tabela de preço é CHAR(2) alfanumérico ('00'..'99', 'ND', 'MX'). */
const TABELA_RE = /^[A-Z0-9]{1,2}$/;

export function campoKeyProdutos(campo: string): string {
  return `P::${campo}`;
}

export function campoKeyTabela(codigoTabela: string, campo: string): string {
  return `T::${codigoTabela}::${campo}`;
}

/**
 * Converte a chave vinda do cliente em um alvo validado. Retorna null para
 * qualquer coisa fora da whitelist — nunca interpolamos texto do cliente em SQL.
 */
export function parseCampoKey(key: string): CampoAlvo | null {
  const raw = (key ?? '').trim();
  if (raw.startsWith('P::')) {
    const campo = raw.slice(3);
    const def = MAPA_PRODUTOS.get(campo);
    if (!def) return null;
    return {
      key: campoKeyProdutos(campo),
      origem: 'PRODUTOS',
      campo,
      codigoTabela: null,
      label: def.label,
      espelho: def.espelho ?? null,
      avancado: def.avancado,
    };
  }
  if (raw.startsWith('T::')) {
    const [, tabela, campo] = raw.split('::');
    const cod = (tabela ?? '').trim().toUpperCase();
    const def = MAPA_PRECOS.get(campo ?? '');
    if (!def || !TABELA_RE.test(cod)) return null;
    return {
      key: campoKeyTabela(cod, def.campo),
      origem: 'PRODUTOS_PRECOS',
      campo: def.campo,
      codigoTabela: cod,
      label: def.label,
      espelho: def.espelho ?? null,
      avancado: def.avancado,
    };
  }
  return null;
}

/** Catálogo de colunas alteráveis do cadastro (PRODUTOS), para montar a UI. */
export function listarCamposProduto(): CampoAlvo[] {
  return CAMPOS_PRODUTOS.map((def) => ({
    key: campoKeyProdutos(def.campo),
    origem: 'PRODUTOS' as const,
    campo: def.campo,
    codigoTabela: null,
    label: def.label,
    espelho: def.espelho ?? null,
    avancado: def.avancado,
  }));
}

/** Catálogo de colunas alteráveis de uma tabela de preço. */
export function listarCamposTabela(codigoTabela: string): CampoAlvo[] {
  const cod = codigoTabela.trim().toUpperCase();
  return CAMPOS_PRECOS.map((def) => ({
    key: campoKeyTabela(cod, def.campo),
    origem: 'PRODUTOS_PRECOS' as const,
    campo: def.campo,
    codigoTabela: cod,
    label: def.label,
    espelho: def.espelho ?? null,
    avancado: def.avancado,
  }));
}

// ───────────────────────── helpers SQL ─────────────────────────

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function limpar(value: unknown): string {
  return String(value ?? '').trim();
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Valores viajam como texto e são convertidos no SQL — evita ruído de float. */
function valorParam(valor: number): string {
  return valor.toFixed(4);
}

/** `PRODUTO IN (@pfx0, @pfx1, ...)`, com os parâmetros já registrados. */
function inProdutos(
  request: sql.Request | RequestLike,
  produtos: string[],
  prefixo: string
): string {
  produtos.forEach((p, i) => request.input(`${prefixo}${i}`, sql.VarChar, p));
  return produtos.map((_, i) => `@${prefixo}${i}`).join(', ');
}

/**
 * Filtro de EMPRESA do cadastro. `todoCadastro` desliga o escopo (existem poucos
 * itens carimbados em códigos de empresa avulsos que sumiriam da busca).
 */
function filtroEmpresa(
  request: sql.Request | RequestLike,
  company: PrecoCompany,
  todoCadastro: boolean,
  prefixo = 'emp'
): string {
  if (todoCadastro) return '';
  const codes = EMPRESA_CODES[company] ?? [];
  if (codes.length === 0) return '';
  codes.forEach((c, i) => request.input(`${prefixo}${i}`, sql.Int, c));
  return `AND p.EMPRESA IN (${codes.map((_, i) => `@${prefixo}${i}`).join(', ')})`;
}

/** `AND UPPER(RTRIM(LTRIM(ISNULL(<expr>, '')))) IN (...)` para listas de filtro. */
function filtroLista(
  request: sql.Request | RequestLike,
  valores: string[] | null | undefined,
  expr: string,
  prefixo: string
): string {
  const lista = (valores ?? []).map((v) => v.trim().toUpperCase()).filter(Boolean);
  if (lista.length === 0) return '';
  lista.forEach((v, i) => request.input(`${prefixo}${i}`, sql.VarChar, v));
  const ph = lista.map((_, i) => `@${prefixo}${i}`).join(', ');
  return `AND UPPER(LTRIM(RTRIM(ISNULL(${expr}, '')))) IN (${ph})`;
}

// ───────────────────────── opções de filtro ─────────────────────────

export interface PrecoFiltroOpcoes {
  grupos: string[];
  subgrupos: string[];
  linhas: string[];
  colecoes: Array<{ value: string; label: string }>;
  grades: string[];
  tipos: string[];
}

/**
 * Opções dos filtros lidas do CADASTRO (PRODUTOS), não das vendas: a tela precisa
 * alcançar produto que nunca vendeu. Uma query só, agregando as dimensões.
 */
export async function fetchPrecoFiltroOpcoes(
  company: PrecoCompany,
  opts: { todoCadastro?: boolean; incluirInativos?: boolean } = {}
): Promise<PrecoFiltroOpcoes> {
  return withRequest(async (request) => {
    const empresa = filtroEmpresa(request, company, !!opts.todoCadastro);
    const inativos = opts.incluirInativos ? '' : 'AND ISNULL(p.INATIVO, 0) = 0';

    const query = `
      SELECT 'GRUPO' AS dim, UPPER(LTRIM(RTRIM(p.GRUPO_PRODUTO))) AS valor, '' AS descricao
      FROM PRODUTOS p WITH (NOLOCK)
      WHERE ISNULL(p.GRUPO_PRODUTO, '') <> '' ${empresa} ${inativos}
      GROUP BY UPPER(LTRIM(RTRIM(p.GRUPO_PRODUTO)))
      UNION ALL
      SELECT 'SUBGRUPO', UPPER(LTRIM(RTRIM(p.SUBGRUPO_PRODUTO))), ''
      FROM PRODUTOS p WITH (NOLOCK)
      WHERE ISNULL(p.SUBGRUPO_PRODUTO, '') <> '' ${empresa} ${inativos}
      GROUP BY UPPER(LTRIM(RTRIM(p.SUBGRUPO_PRODUTO)))
      UNION ALL
      SELECT 'LINHA', UPPER(LTRIM(RTRIM(p.LINHA))), ''
      FROM PRODUTOS p WITH (NOLOCK)
      WHERE ISNULL(p.LINHA, '') <> '' ${empresa} ${inativos}
      GROUP BY UPPER(LTRIM(RTRIM(p.LINHA)))
      UNION ALL
      SELECT 'GRADE', UPPER(LTRIM(RTRIM(CONVERT(VARCHAR(50), p.GRADE)))), ''
      FROM PRODUTOS p WITH (NOLOCK)
      WHERE ISNULL(CONVERT(VARCHAR(50), p.GRADE), '') <> '' ${empresa} ${inativos}
      GROUP BY UPPER(LTRIM(RTRIM(CONVERT(VARCHAR(50), p.GRADE))))
      UNION ALL
      SELECT 'TIPO', UPPER(LTRIM(RTRIM(p.TIPO_PRODUTO))), ''
      FROM PRODUTOS p WITH (NOLOCK)
      WHERE ISNULL(p.TIPO_PRODUTO, '') <> '' ${empresa} ${inativos}
      GROUP BY UPPER(LTRIM(RTRIM(p.TIPO_PRODUTO)))
      UNION ALL
      SELECT 'COLECAO', UPPER(LTRIM(RTRIM(p.COLECAO))), MAX(LTRIM(RTRIM(ISNULL(c.DESC_COLECAO, ''))))
      FROM PRODUTOS p WITH (NOLOCK)
      LEFT JOIN COLECOES c WITH (NOLOCK) ON c.COLECAO = p.COLECAO
      WHERE ISNULL(p.COLECAO, '') <> '' ${empresa} ${inativos}
      GROUP BY UPPER(LTRIM(RTRIM(p.COLECAO)))
    `;

    const result = await request.query<{ dim: string; valor: string; descricao: string }>(query);

    const bucket: Record<string, string[]> = { GRUPO: [], SUBGRUPO: [], LINHA: [], GRADE: [], TIPO: [] };
    const colecoes: Array<{ value: string; label: string }> = [];

    for (const row of result.recordset) {
      const valor = limpar(row.valor);
      if (!valor) continue;
      if (row.dim === 'COLECAO') {
        const desc = limpar(row.descricao);
        colecoes.push({ value: valor, label: desc ? `${desc} (${valor})` : valor });
      } else if (bucket[row.dim]) {
        bucket[row.dim].push(valor);
      }
    }

    const ordenar = (v: string[]) => [...new Set(v)].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    return {
      grupos: ordenar(bucket.GRUPO),
      subgrupos: ordenar(bucket.SUBGRUPO),
      linhas: ordenar(bucket.LINHA),
      grades: ordenar(bucket.GRADE),
      tipos: ordenar(bucket.TIPO),
      colecoes: colecoes.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    };
  });
}

// ───────────────────────── resolução de códigos ─────────────────────────

export interface ResolucaoCodigos {
  produtos: string[];
  naoEncontrados: string[];
}

/**
 * Aceita código de produto OU código de barras, como o script. Resolve em dois
 * passos (PRODUTOS, depois PRODUTOS_BARRA) e preserva a ordem digitada.
 */
export async function resolverCodigosOuBarras(entradas: string[]): Promise<ResolucaoCodigos> {
  const limpos = [...new Set(entradas.map(limpar).filter(Boolean))];
  if (limpos.length === 0) return { produtos: [], naoEncontrados: [] };

  const mapa = new Map<string, string>();

  for (const lote of chunk(limpos, CHUNK)) {
    const encontrados = await withRequest(async (request) => {
      const ph = inProdutos(request, lote, 'codProd');
      const r = await request.query<{ produto: string }>(`
        SELECT LTRIM(RTRIM(PRODUTO)) AS produto
        FROM PRODUTOS WITH (NOLOCK)
        WHERE PRODUTO IN (${ph})
      `);
      return r.recordset.map((row) => limpar(row.produto));
    });
    for (const p of encontrados) mapa.set(p, p);
  }

  const restantes = limpos.filter((e) => !mapa.has(e));
  for (const lote of chunk(restantes, CHUNK)) {
    const encontrados = await withRequest(async (request) => {
      const ph = inProdutos(request, lote, 'codBarra');
      const r = await request.query<{ barra: string; produto: string }>(`
        SELECT DISTINCT
          LTRIM(RTRIM(CAST(CODIGO_BARRA AS VARCHAR(50)))) AS barra,
          LTRIM(RTRIM(PRODUTO)) AS produto
        FROM PRODUTOS_BARRA WITH (NOLOCK)
        WHERE LTRIM(RTRIM(CAST(CODIGO_BARRA AS VARCHAR(50)))) IN (${ph})
      `);
      return r.recordset;
    });
    for (const row of encontrados) mapa.set(limpar(row.barra), limpar(row.produto));
  }

  const produtos: string[] = [];
  const naoEncontrados: string[] = [];
  const vistos = new Set<string>();
  for (const entrada of limpos) {
    const produto = mapa.get(entrada);
    if (!produto) {
      naoEncontrados.push(entrada);
      continue;
    }
    if (vistos.has(produto)) continue;
    vistos.add(produto);
    produtos.push(produto);
  }

  return { produtos, naoEncontrados };
}

// ───────────────────────── busca de produtos + valores ─────────────────────────

export interface PrecoFiltros {
  company: PrecoCompany;
  /** Códigos de produto ou de barras colados; quando presente, ignora os demais filtros. */
  codigos?: string[] | null;
  /** Trecho do nome (DESC_PRODUTO) ou do código do produto. */
  busca?: string | null;
  grupos?: string[] | null;
  subgrupos?: string[] | null;
  linhas?: string[] | null;
  colecoes?: string[] | null;
  grades?: string[] | null;
  tipos?: string[] | null;
  incluirInativos?: boolean;
  todoCadastro?: boolean;
  /** Colunas do cadastro (nomes de coluna de PRODUTOS). Default: custo + preço sugerido. */
  camposCadastro?: string[] | null;
  /**
   * Restringe as tabelas de preço trazidas. Default: TODAS as que os produtos
   * encontrados realmente têm — é o que deixa a comparação entre tabelas visível.
   */
  tabelas?: string[] | null;
  /** Traz também PRECO2..4 / PRECO_LIQUIDO2..4 e os campos avançados do cadastro. */
  incluirAvancados?: boolean;
  limite?: number;
}

export interface PrecoProdutoRow {
  produto: string;
  descricao: string;
  grupo: string;
  subgrupo: string;
  linha: string;
  colecao: string;
  grade: string;
  tipo: string;
  inativo: boolean;
  /**
   * Valores alinhados por índice a `campos[]`. Array em vez de objeto porque a grade
   * traz o produto em TODAS as tabelas: com chave por coluna o JSON triplicava.
   */
  v: Array<number | null>;
  /**
   * Índices de `campos[]` em que o produto não tem LINHA na tabela de preço —
   * diferente de valor nulo com linha existente (esse é alterável).
   */
  sr: number[];
}

/** Tabela de preço presente na seleção atual (não no cadastro inteiro). */
export interface TabelaSelecionada {
  codigo: string;
  descricao: string;
  inativa: boolean;
  /** Quantos dos produtos encontrados têm linha nesta tabela. */
  comRegistro: number;
}

/**
 * Faixa/média/contagem por coluna são calculadas NO CLIENTE, a partir de `rows`,
 * porque precisam acompanhar os produtos que o usuário marca na grade (marcar um
 * produto tem que mudar os números do resumo). Aqui só vêm os dados crus.
 */
export interface PrecoProdutosResult {
  rows: PrecoProdutoRow[];
  total: number;
  truncated: boolean;
  naoEncontrados: string[];
  campos: CampoAlvo[];
  tabelas: TabelaSelecionada[];
}

/** Valor de uma coluna para um produto. `existe` distingue linha ausente de coluna nula. */
interface ValorAtual {
  existe: boolean;
  valor: number | null;
}

/**
 * Lê os valores atuais das colunas pedidas. Em PRODUTOS_PRECOS a coluna pode vir
 * NULL numa linha que EXISTE (é o caso de PRECO_LIQUIDO1 na tabela ND) — por isso
 * `existe` é separado do valor: null-com-linha é alterável, sem-linha não é.
 */
async function carregarValores(
  produtos: string[],
  campos: CampoAlvo[]
): Promise<Map<string, Map<string, ValorAtual>>> {
  const porProduto = new Map<string, Map<string, ValorAtual>>();
  for (const p of produtos) porProduto.set(p, new Map());
  if (produtos.length === 0 || campos.length === 0) return porProduto;

  const camposProduto = campos.filter((c) => c.origem === 'PRODUTOS');
  const camposTabela = campos.filter((c) => c.origem === 'PRODUTOS_PRECOS');
  const tabelas = [...new Set(camposTabela.map((c) => c.codigoTabela!))];

  for (const lote of chunk(produtos, CHUNK)) {
    if (camposProduto.length > 0) {
      const colunas = [...new Set(camposProduto.map((c) => c.campo))];
      const rows = await withRequest(async (request) => {
        const ph = inProdutos(request, lote, 'valProd');
        const select = colunas.map((col) => `p.${col} AS [${col}]`).join(', ');
        const r = await request.query<Record<string, unknown>>(`
          SELECT LTRIM(RTRIM(p.PRODUTO)) AS produto, ${select}
          FROM PRODUTOS p WITH (NOLOCK)
          WHERE p.PRODUTO IN (${ph})
        `);
        return r.recordset;
      });
      for (const row of rows) {
        const alvo = porProduto.get(limpar(row.produto));
        if (!alvo) continue;
        for (const campo of camposProduto) {
          alvo.set(campo.key, { existe: true, valor: toNumber(row[campo.campo]) });
        }
      }
    }

    if (camposTabela.length > 0) {
      const colunas = [...new Set(camposTabela.map((c) => c.campo))];
      const rows = await withRequest(async (request) => {
        const ph = inProdutos(request, lote, 'valPreco');
        tabelas.forEach((t, i) => request.input(`valTab${i}`, sql.VarChar, t));
        const phTab = tabelas.map((_, i) => `@valTab${i}`).join(', ');
        const select = colunas.map((col) => `pp.${col} AS [${col}]`).join(', ');
        const r = await request.query<Record<string, unknown>>(`
          SELECT
            LTRIM(RTRIM(pp.PRODUTO)) AS produto,
            LTRIM(RTRIM(pp.CODIGO_TAB_PRECO)) AS tabela,
            ${select}
          FROM PRODUTOS_PRECOS pp WITH (NOLOCK)
          WHERE pp.PRODUTO IN (${ph}) AND pp.CODIGO_TAB_PRECO IN (${phTab})
        `);
        return r.recordset;
      });
      for (const row of rows) {
        const alvo = porProduto.get(limpar(row.produto));
        if (!alvo) continue;
        const tabela = limpar(row.tabela).toUpperCase();
        for (const campo of camposTabela) {
          if (campo.codigoTabela !== tabela) continue;
          alvo.set(campo.key, { existe: true, valor: toNumber(row[campo.campo]) });
        }
      }
    }
  }

  return porProduto;
}

/**
 * Descobre quais tabelas de preço os produtos DA SELEÇÃO realmente têm, com quantos
 * produtos cada uma cobre. É o que substitui a lista global (que mostrava "4.294 itens"
 * mesmo com um produto só selecionado).
 */
async function descobrirTabelasDaSelecao(produtos: string[]): Promise<TabelaSelecionada[]> {
  if (produtos.length === 0) return [];
  const acc = new Map<string, TabelaSelecionada>();

  for (const lote of chunk(produtos, CHUNK)) {
    const rows = await withRequest(async (request) => {
      const ph = inProdutos(request, lote, 'descTab');
      const r = await request.query<{
        codigo: string;
        descricao: string;
        inativa: number;
        comRegistro: number;
      }>(`
        SELECT
          LTRIM(RTRIM(pp.CODIGO_TAB_PRECO)) AS codigo,
          LTRIM(RTRIM(ISNULL(tp.TABELA, ''))) AS descricao,
          MAX(CAST(ISNULL(tp.INATIVO, 0) AS INT)) AS inativa,
          COUNT(DISTINCT pp.PRODUTO) AS comRegistro
        FROM PRODUTOS_PRECOS pp WITH (NOLOCK)
        LEFT JOIN TABELAS_PRECO tp WITH (NOLOCK) ON tp.CODIGO_TAB_PRECO = pp.CODIGO_TAB_PRECO
        WHERE pp.PRODUTO IN (${ph})
        GROUP BY LTRIM(RTRIM(pp.CODIGO_TAB_PRECO)), LTRIM(RTRIM(ISNULL(tp.TABELA, '')))
      `);
      return r.recordset;
    });

    for (const row of rows) {
      const codigo = limpar(row.codigo).toUpperCase();
      if (!TABELA_RE.test(codigo)) continue;
      const atual = acc.get(codigo);
      if (atual) {
        atual.comRegistro += Number(row.comRegistro ?? 0);
      } else {
        acc.set(codigo, {
          codigo,
          descricao: limpar(row.descricao) || codigo,
          inativa: Number(row.inativa ?? 0) === 1,
          comRegistro: Number(row.comRegistro ?? 0),
        });
      }
    }
  }

  // Ativas na frente e, dentro de cada bloco, as que cobrem mais produtos.
  return [...acc.values()].sort((a, b) => {
    if (a.inativa !== b.inativa) return a.inativa ? 1 : -1;
    if (a.comRegistro !== b.comRegistro) return b.comRegistro - a.comRegistro;
    return a.codigo.localeCompare(b.codigo);
  });
}

/**
 * Colunas do cadastro. Sem lista explícita: custo + preço sugerido no modo leve, e o
 * catálogo INTEIRO com `incluirAvancados` — é o que traz CUSTO_REPOSICAO2..4, que a
 * lista de custos do produto mostra (mesmo zerados, como no script).
 */
function resolverCamposCadastro(nomes: string[] | null | undefined, incluirAvancados: boolean): CampoAlvo[] {
  const pedidos = (nomes ?? []).map(limpar).filter(Boolean);
  if (pedidos.length > 0) {
    return pedidos
      .map((campo) => parseCampoKey(campoKeyProdutos(campo)))
      .filter((c): c is CampoAlvo => c !== null);
  }
  if (incluirAvancados) return listarCamposProduto();
  return ['CUSTO_REPOSICAO1', 'PRECO_REPOSICAO_1']
    .map((campo) => parseCampoKey(campoKeyProdutos(campo)))
    .filter((c): c is CampoAlvo => c !== null);
}

/** Produtos que batem nos filtros + valor em cada tabela de preço que eles têm. */
export async function fetchProdutosPrecos(filtros: PrecoFiltros): Promise<PrecoProdutosResult> {
  const incluirAvancados = !!filtros.incluirAvancados;
  const limite = Math.min(filtros.limite && filtros.limite > 0 ? filtros.limite : LIMITE_PRODUTOS, LIMITE_PRODUTOS);

  const vazio = (naoEncontrados: string[]): PrecoProdutosResult => ({
    rows: [],
    total: 0,
    truncated: false,
    naoEncontrados,
    campos: [],
    tabelas: [],
  });

  let produtosExplicitos: string[] | null = null;
  let naoEncontrados: string[] = [];
  const codigos = (filtros.codigos ?? []).map(limpar).filter(Boolean);
  if (codigos.length > 0) {
    const resolucao = await resolverCodigosOuBarras(codigos);
    produtosExplicitos = resolucao.produtos;
    naoEncontrados = resolucao.naoEncontrados;
    if (produtosExplicitos.length === 0) return vazio(naoEncontrados);
  }

  const base = await withRequest(async (request) => {
    const where: string[] = [];

    if (produtosExplicitos) {
      // Lista explícita: vale exatamente o que foi colado, sem escopo de empresa
      // (o dono às vezes precisa mexer num item carimbado na outra empresa).
      const ph = inProdutos(request, produtosExplicitos.slice(0, LIMITE_PRODUTOS), 'filtProd');
      where.push(`AND p.PRODUTO IN (${ph})`);
    } else {
      where.push(filtroEmpresa(request, filtros.company, !!filtros.todoCadastro));
      where.push(filtroLista(request, filtros.grupos, 'p.GRUPO_PRODUTO', 'filtGrupo'));
      where.push(filtroLista(request, filtros.subgrupos, 'p.SUBGRUPO_PRODUTO', 'filtSub'));
      where.push(filtroLista(request, filtros.linhas, 'p.LINHA', 'filtLinha'));
      where.push(filtroLista(request, filtros.colecoes, 'p.COLECAO', 'filtColecao'));
      where.push(filtroLista(request, filtros.grades, 'CONVERT(VARCHAR(50), p.GRADE)', 'filtGrade'));
      where.push(filtroLista(request, filtros.tipos, 'p.TIPO_PRODUTO', 'filtTipo'));

      const busca = limpar(filtros.busca);
      if (busca.length >= 2) {
        request.input('filtBusca', sql.VarChar, `%${busca}%`);
        where.push(`AND (p.DESC_PRODUTO LIKE @filtBusca OR p.PRODUTO LIKE @filtBusca)`);
      }
    }

    if (!filtros.incluirInativos) where.push('AND ISNULL(p.INATIVO, 0) = 0');

    const whereSql = where.filter(Boolean).join('\n        ');

    const r = await request.query<{
      produto: string;
      descricao: string;
      grupo: string;
      subgrupo: string;
      linha: string;
      colecao: string;
      grade: string;
      tipo: string;
      inativo: number;
      total: number;
    }>(`
      WITH filtrados AS (
        SELECT
          LTRIM(RTRIM(p.PRODUTO)) AS produto,
          LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, ''))) AS descricao,
          LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, ''))) AS grupo,
          LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, ''))) AS subgrupo,
          LTRIM(RTRIM(ISNULL(p.LINHA, ''))) AS linha,
          LTRIM(RTRIM(ISNULL(p.COLECAO, ''))) AS colecao,
          LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(50), p.GRADE), ''))) AS grade,
          LTRIM(RTRIM(ISNULL(p.TIPO_PRODUTO, ''))) AS tipo,
          CAST(ISNULL(p.INATIVO, 0) AS INT) AS inativo
        FROM PRODUTOS p WITH (NOLOCK)
        WHERE 1 = 1
        ${whereSql}
      )
      SELECT TOP ${limite + 1} *, (SELECT COUNT(*) FROM filtrados) AS total
      FROM filtrados
      ORDER BY produto
    `);
    return r.recordset;
  });

  const total = base.length > 0 ? Number(base[0].total ?? base.length) : 0;
  const truncated = base.length > limite;
  const usados = truncated ? base.slice(0, limite) : base;
  const produtos = usados.map((row) => limpar(row.produto));

  if (produtos.length === 0) return vazio(naoEncontrados);

  // As tabelas saem dos PRODUTOS ENCONTRADOS, não do cadastro inteiro.
  const todasTabelas = await descobrirTabelasDaSelecao(produtos);
  const restringir = (filtros.tabelas ?? []).map((t) => limpar(t).toUpperCase()).filter(Boolean);
  const tabelas = restringir.length > 0
    ? todasTabelas.filter((t) => restringir.includes(t.codigo))
    : todasTabelas;

  // Colunas: cadastro primeiro, depois cada tabela com Preço e Preço líquido juntos —
  // é essa vizinhança que deixa a comparação entre tabelas legível na grade.
  const campos: CampoAlvo[] = [
    ...resolverCamposCadastro(filtros.camposCadastro, incluirAvancados),
    ...tabelas.flatMap((tabela) =>
      listarCamposTabela(tabela.codigo).filter((c) => incluirAvancados || !c.avancado)
    ),
  ];

  const valores = await carregarValores(produtos, campos);

  const rows: PrecoProdutoRow[] = usados.map((row) => {
    const produto = limpar(row.produto);
    const mapa = valores.get(produto) ?? new Map<string, ValorAtual>();
    const v: Array<number | null> = [];
    const sr: number[] = [];
    campos.forEach((campo, indice) => {
      const atual = mapa.get(campo.key);
      v.push(atual?.valor ?? null);
      if (!atual?.existe) sr.push(indice);
    });
    return {
      produto,
      descricao: limpar(row.descricao),
      grupo: limpar(row.grupo),
      subgrupo: limpar(row.subgrupo),
      linha: limpar(row.linha),
      colecao: limpar(row.colecao),
      grade: limpar(row.grade),
      tipo: limpar(row.tipo),
      inativo: Number(row.inativo ?? 0) === 1,
      v,
      sr,
    };
  });

  return { rows, total, truncated, naoEncontrados, campos, tabelas };
}

// ───────────────────────── histórico / auditoria ─────────────────────────

const TABELA_HISTORICO = 'NERD_PRECO_HISTORICO';

let historicoGarantido = false;

/** Cria a tabela de histórico na primeira gravação (mesmo padrão do ajuste-historico). */
export async function ensureHistoricoTable(): Promise<void> {
  if (historicoGarantido) return;
  await withRequest(async (request) => {
    await request.query(`
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'${TABELA_HISTORICO}') AND type = N'U')
      CREATE TABLE ${TABELA_HISTORICO} (
        ID             INT IDENTITY(1,1) PRIMARY KEY,
        LOTE           VARCHAR(40)   NOT NULL,
        DATA_ALTERACAO DATETIME      NOT NULL DEFAULT GETDATE(),
        EMPRESA        VARCHAR(20)   NOT NULL,
        USUARIO        VARCHAR(100)  NOT NULL,
        PRODUTO        VARCHAR(20)   NOT NULL,
        ORIGEM         VARCHAR(20)   NOT NULL,
        COD_TABELA     VARCHAR(10)   NULL,
        CAMPO          VARCHAR(40)   NOT NULL,
        VALOR_ANTERIOR NUMERIC(14,4) NULL,
        VALOR_NOVO     NUMERIC(14,4) NULL,
        OBS            VARCHAR(300)  NULL,
        REVERTE_LOTE   VARCHAR(40)   NULL
      )
    `);
    // VALOR_NOVO nasceu NOT NULL; o estorno de uma coluna que era NULL precisa
    // registrar NULL de volta. Ajusta bases criadas antes dessa correção.
    await request.query(`
      IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = '${TABELA_HISTORICO}' AND COLUMN_NAME = 'VALOR_NOVO' AND IS_NULLABLE = 'NO'
      )
      ALTER TABLE ${TABELA_HISTORICO} ALTER COLUMN VALOR_NOVO NUMERIC(14,4) NULL
    `);
  });
  historicoGarantido = true;
}

export interface HistoricoLinha {
  id: number;
  lote: string;
  data: string;
  empresa: string;
  usuario: string;
  produto: string;
  origem: PrecoOrigem;
  codTabela: string | null;
  campo: string;
  valorAnterior: number | null;
  valorNovo: number;
  obs: string | null;
  reverteLote: string | null;
}

export interface HistoricoLote {
  lote: string;
  data: string;
  usuario: string;
  empresa: string;
  alteracoes: number;
  produtos: number;
  campos: string[];
  obs: string | null;
  /** Lote que este lote estornou (quando é um estorno). */
  reverteLote: string | null;
  /** Lote de estorno já aplicado sobre este (quando já foi desfeito). */
  revertidoPor: string | null;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return limpar(value);
}

/** Últimos lotes de alteração da empresa, para a aba Histórico. */
export async function fetchHistoricoLotes(
  company: PrecoCompany,
  limite = 30
): Promise<HistoricoLote[]> {
  await ensureHistoricoTable();
  const top = Math.min(Math.max(limite, 1), 200);
  return withRequest(async (request) => {
    request.input('histEmpresa', sql.VarChar, company);
    const r = await request.query<{
      lote: string;
      data: Date | string;
      usuario: string;
      empresa: string;
      alteracoes: number;
      produtos: number;
      campos: string;
      obs: string | null;
      reverteLote: string | null;
      revertidoPor: string | null;
    }>(`
      SELECT TOP ${top}
        h.LOTE AS lote,
        MIN(h.DATA_ALTERACAO) AS data,
        MAX(h.USUARIO) AS usuario,
        MAX(h.EMPRESA) AS empresa,
        COUNT(*) AS alteracoes,
        COUNT(DISTINCT h.PRODUTO) AS produtos,
        MAX(ISNULL(h.OBS, '')) AS obs,
        MAX(ISNULL(h.REVERTE_LOTE, '')) AS reverteLote,
        (
          SELECT TOP 1 e.LOTE FROM ${TABELA_HISTORICO} e WITH (NOLOCK)
          WHERE e.REVERTE_LOTE = h.LOTE
        ) AS revertidoPor,
        STUFF((
          SELECT DISTINCT ', ' + LTRIM(RTRIM(ISNULL(d.COD_TABELA, 'CADASTRO'))) + '/' + LTRIM(RTRIM(d.CAMPO))
          FROM ${TABELA_HISTORICO} d WITH (NOLOCK)
          WHERE d.LOTE = h.LOTE
          FOR XML PATH(''), TYPE
        ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS campos
      FROM ${TABELA_HISTORICO} h WITH (NOLOCK)
      WHERE h.EMPRESA = @histEmpresa
      GROUP BY h.LOTE
      ORDER BY MIN(h.DATA_ALTERACAO) DESC
    `);

    return r.recordset.map((row) => ({
      lote: limpar(row.lote),
      data: toIso(row.data),
      usuario: limpar(row.usuario),
      empresa: limpar(row.empresa),
      alteracoes: Number(row.alteracoes ?? 0),
      produtos: Number(row.produtos ?? 0),
      campos: limpar(row.campos)
        .split(', ')
        .map((c) => c.trim())
        .filter(Boolean),
      obs: limpar(row.obs) || null,
      reverteLote: limpar(row.reverteLote) || null,
      revertidoPor: limpar(row.revertidoPor) || null,
    }));
  });
}

/** Linhas de um lote (usado no detalhe e no estorno). */
export async function fetchHistoricoLinhas(lote: string): Promise<HistoricoLinha[]> {
  await ensureHistoricoTable();
  const loteLimpo = limpar(lote);
  if (!loteLimpo) return [];
  return withRequest(async (request) => {
    request.input('loteId', sql.VarChar, loteLimpo);
    const r = await request.query<Record<string, unknown>>(`
      SELECT ID, LOTE, DATA_ALTERACAO, EMPRESA, USUARIO, PRODUTO, ORIGEM,
             COD_TABELA, CAMPO, VALOR_ANTERIOR, VALOR_NOVO, OBS, REVERTE_LOTE
      FROM ${TABELA_HISTORICO} WITH (NOLOCK)
      WHERE LOTE = @loteId
      ORDER BY ID
    `);
    return r.recordset.map((row) => ({
      id: Number(row.ID ?? 0),
      lote: limpar(row.LOTE),
      data: toIso(row.DATA_ALTERACAO),
      empresa: limpar(row.EMPRESA),
      usuario: limpar(row.USUARIO),
      produto: limpar(row.PRODUTO),
      origem: (limpar(row.ORIGEM) === 'PRODUTOS' ? 'PRODUTOS' : 'PRODUTOS_PRECOS') as PrecoOrigem,
      codTabela: limpar(row.COD_TABELA) || null,
      campo: limpar(row.CAMPO),
      valorAnterior: toNumber(row.VALOR_ANTERIOR),
      valorNovo: toNumber(row.VALOR_NOVO) ?? 0,
      obs: limpar(row.OBS) || null,
      reverteLote: limpar(row.REVERTE_LOTE) || null,
    }));
  });
}

async function gravarHistorico(
  lote: string,
  company: PrecoCompany,
  usuario: string,
  obs: string | null,
  reverteLote: string | null,
  linhas: Array<{ produto: string; campo: CampoAlvo; anterior: number | null; novo: number | null }>
): Promise<void> {
  if (linhas.length === 0) return;
  await ensureHistoricoTable();

  for (const lotePartes of chunk(linhas, 100)) {
    await withRequest(async (request) => {
      request.input('hLote', sql.VarChar, lote);
      request.input('hEmpresa', sql.VarChar, company);
      request.input('hUsuario', sql.VarChar, usuario.slice(0, 100));
      request.input('hObs', sql.VarChar, obs ? obs.slice(0, 300) : null);
      request.input('hReverte', sql.VarChar, reverteLote);

      const values = lotePartes.map((linha, i) => {
        request.input(`hp${i}`, sql.VarChar, linha.produto);
        request.input(`ho${i}`, sql.VarChar, linha.campo.origem);
        request.input(`ht${i}`, sql.VarChar, linha.campo.codigoTabela);
        request.input(`hc${i}`, sql.VarChar, linha.campo.campo);
        request.input(`ha${i}`, sql.VarChar, linha.anterior === null ? null : valorParam(linha.anterior));
        request.input(`hn${i}`, sql.VarChar, linha.novo === null ? null : valorParam(linha.novo));
        return `(@hLote, @hEmpresa, @hUsuario, @hp${i}, @ho${i}, @ht${i}, @hc${i}, CAST(@ha${i} AS NUMERIC(14,4)), CAST(@hn${i} AS NUMERIC(14,4)), @hObs, @hReverte)`;
      });

      await request.query(`
        INSERT INTO ${TABELA_HISTORICO}
          (LOTE, EMPRESA, USUARIO, PRODUTO, ORIGEM, COD_TABELA, CAMPO, VALOR_ANTERIOR, VALOR_NOVO, OBS, REVERTE_LOTE)
        VALUES ${values.join(', ')}
      `);
    });
  }
}

// ───────────────────────── execução ─────────────────────────

export interface AlteracaoInput {
  produto: string;
  campoKey: string;
  /** `null` só é aceito no estorno (ver `permitirNulo`) — a tela nunca envia null. */
  valor: number | null;
}

export interface ExecutarPrecosParams {
  company: PrecoCompany;
  usuario: string;
  alteracoes: AlteracaoInput[];
  /**
   * Libera gravar NULL. Uso exclusivo do estorno: se a coluna era NULL antes do
   * lote (ex.: PRECO_LIQUIDO1 na tabela ND), desfazer tem que devolver NULL, não zero.
   */
  permitirNulo?: boolean;
  /** PRECOn grava também PRECO_LIQUIDOn (regra do script). */
  sincronizarPrecoLiquido: boolean;
  /** PRECO_REPOSICAO_n grava também PRECO_A_VISTA_REPOSICAO_n. */
  sincronizarPrecoAVista: boolean;
  obs?: string | null;
  reverteLote?: string | null;
}

export interface ResumoCampo {
  campoKey: string;
  label: string;
  codTabela: string | null;
  campo: string;
  aplicados: number;
  semMudanca: number;
  semRegistro: number;
  naoConfirmados: number;
}

export interface ExecutarPrecosResult {
  lote: string;
  aplicados: number;
  semMudanca: number;
  semRegistro: number;
  naoConfirmados: number;
  porCampo: ResumoCampo[];
  erros: string[];
}

/** Difere com tolerância de meio centavo — as colunas são NUMERIC(14,2)/(14,4). */
function mudou(atual: number | null, novo: number | null): boolean {
  if (atual === null || novo === null) return atual !== novo;
  return Math.abs(atual - novo) > 0.005;
}

function novoLoteId(): string {
  const agora = new Date();
  const stamp = agora.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `PRC${stamp}${rand}`;
}

/**
 * Expande espelhos: PRECOn → PRECO_LIQUIDOn e PRECO_REPOSICAO_n → PRECO_A_VISTA_n.
 * Vira alteração de verdade (com histórico e estorno próprios) em vez de um SET
 * escondido — o que o usuário vê no preview é exatamente o que vai ao banco.
 */
function expandirEspelhos(
  itens: Array<{ produto: string; campo: CampoAlvo; valor: number | null }>,
  sincronizarPrecoLiquido: boolean,
  sincronizarPrecoAVista: boolean
): Array<{ produto: string; campo: CampoAlvo; valor: number | null }> {
  const porChave = new Map<string, { produto: string; campo: CampoAlvo; valor: number | null }>();
  for (const item of itens) porChave.set(`${item.produto}||${item.campo.key}`, item);

  for (const item of itens) {
    const espelho = item.campo.espelho;
    if (!espelho) continue;
    const ligado = item.campo.origem === 'PRODUTOS_PRECOS' ? sincronizarPrecoLiquido : sincronizarPrecoAVista;
    if (!ligado) continue;

    const key =
      item.campo.origem === 'PRODUTOS'
        ? campoKeyProdutos(espelho)
        : campoKeyTabela(item.campo.codigoTabela!, espelho);
    const alvo = parseCampoKey(key);
    if (!alvo) continue;
    const chave = `${item.produto}||${alvo.key}`;
    // Edição explícita do espelho vence a sincronização.
    if (porChave.has(chave)) continue;
    porChave.set(chave, { produto: item.produto, campo: alvo, valor: item.valor });
  }

  return [...porChave.values()];
}

/** UPDATE em lote: uma sentença por chunk, com os valores vindo de um VALUES. */
async function aplicarUpdate(
  campo: CampoAlvo,
  itens: Array<{ produto: string; valor: number | null }>
): Promise<void> {
  for (const lote of chunk(itens, CHUNK)) {
    await withRequest(async (request) => {
      const values = lote.map((item, i) => {
        request.input(`up${i}`, sql.VarChar, item.produto);
        // Valor NULL vira NULL na coluna (CAST(NULL) = NULL) — usado só pelo estorno.
        request.input(`uv${i}`, sql.VarChar, item.valor === null ? null : valorParam(item.valor));
        return `(@up${i}, @uv${i})`;
      });

      if (campo.origem === 'PRODUTOS') {
        await request.query(`
          UPDATE p
          SET p.${campo.campo} = CAST(v.VAL AS NUMERIC(14,4))
          FROM PRODUTOS p
          INNER JOIN (VALUES ${values.join(', ')}) AS v(PRODUTO, VAL)
            ON p.PRODUTO = v.PRODUTO
        `);
      } else {
        request.input('upTabela', sql.VarChar, campo.codigoTabela);
        await request.query(`
          UPDATE pp
          SET pp.${campo.campo} = CAST(v.VAL AS NUMERIC(14,4))
          FROM PRODUTOS_PRECOS pp
          INNER JOIN (VALUES ${values.join(', ')}) AS v(PRODUTO, VAL)
            ON pp.PRODUTO = v.PRODUTO
          WHERE pp.CODIGO_TAB_PRECO = @upTabela
        `);
      }
    });
  }
}

/**
 * Aplica as alterações e devolve o resumo do que entrou. Nada é alterado sem
 * releitura de confirmação; o histórico só recebe o que o banco confirmou.
 */
export async function executarAlteracaoPrecos(
  params: ExecutarPrecosParams
): Promise<ExecutarPrecosResult> {
  const erros: string[] = [];

  const itens: Array<{ produto: string; campo: CampoAlvo; valor: number | null }> = [];
  for (const alteracao of params.alteracoes) {
    const produto = limpar(alteracao.produto);
    const campo = parseCampoKey(alteracao.campoKey);
    if (!produto || !campo) {
      erros.push(`Alteração inválida ignorada (${limpar(alteracao.campoKey)} / ${produto || 'sem produto'}).`);
      continue;
    }
    if (alteracao.valor === null || alteracao.valor === undefined) {
      if (!params.permitirNulo) {
        erros.push(`Valor vazio não é permitido para ${produto} em ${campo.label}.`);
        continue;
      }
      itens.push({ produto, campo, valor: null });
      continue;
    }
    const valor = Number(alteracao.valor);
    if (!Number.isFinite(valor) || valor < 0) {
      erros.push(`Valor inválido para ${produto} em ${campo.label}.`);
      continue;
    }
    itens.push({ produto, campo, valor });
  }

  const expandidos = expandirEspelhos(itens, params.sincronizarPrecoLiquido, params.sincronizarPrecoAVista);

  if (expandidos.length === 0) {
    return { lote: '', aplicados: 0, semMudanca: 0, semRegistro: 0, naoConfirmados: 0, porCampo: [], erros };
  }
  if (expandidos.length > LIMITE_ALTERACOES) {
    throw new Error(
      `São ${expandidos.length} alterações (limite ${LIMITE_ALTERACOES}). Reduza a seleção e execute em partes.`
    );
  }

  // Agrupa por coluna: cada coluna vira um bloco ler → alterar → reler.
  const porCampoKey = new Map<string, { campo: CampoAlvo; itens: Array<{ produto: string; valor: number | null }> }>();
  for (const item of expandidos) {
    const bucket = porCampoKey.get(item.campo.key);
    if (bucket) bucket.itens.push({ produto: item.produto, valor: item.valor });
    else porCampoKey.set(item.campo.key, { campo: item.campo, itens: [{ produto: item.produto, valor: item.valor }] });
  }

  const lote = novoLoteId();
  const resumo: ResumoCampo[] = [];
  const paraHistorico: Array<{ produto: string; campo: CampoAlvo; anterior: number | null; novo: number | null }> = [];

  for (const { campo, itens: itensCampo } of porCampoKey.values()) {
    const produtos = itensCampo.map((i) => i.produto);
    const antes = await carregarValores(produtos, [campo]);

    const aAlterar: Array<{ produto: string; valor: number | null; anterior: number | null }> = [];
    let semMudanca = 0;
    let semRegistro = 0;

    for (const item of itensCampo) {
      const atual = antes.get(item.produto)?.get(campo.key);
      // Linha inexistente (produto fora daquela tabela de preço, ou produto que sumiu
      // do cadastro): criar a linha seria cadastro, não alteração — fora do escopo.
      // Coluna NULL numa linha que existe É alterável (ex.: PRECO_LIQUIDO1 na tabela ND).
      if (!atual?.existe) {
        semRegistro += 1;
        continue;
      }
      if (!mudou(atual.valor, item.valor)) {
        semMudanca += 1;
        continue;
      }
      aAlterar.push({ produto: item.produto, valor: item.valor, anterior: atual.valor });
    }

    let aplicados = 0;
    let naoConfirmados = 0;

    if (aAlterar.length > 0) {
      try {
        await aplicarUpdate(campo, aAlterar.map((i) => ({ produto: i.produto, valor: i.valor })));

        const depois = await carregarValores(aAlterar.map((i) => i.produto), [campo]);
        for (const item of aAlterar) {
          const atual = depois.get(item.produto)?.get(campo.key)?.valor ?? null;
          if (!mudou(atual, item.valor)) {
            aplicados += 1;
            paraHistorico.push({ produto: item.produto, campo, anterior: item.anterior, novo: item.valor });
          } else {
            naoConfirmados += 1;
          }
        }
      } catch (error) {
        naoConfirmados += aAlterar.length;
        const detalhe = error instanceof Error ? error.message : String(error);
        const ondeLabel = campo.codigoTabela ? ` (tabela ${campo.codigoTabela})` : ' (cadastro)';
        erros.push(`Falha ao alterar ${campo.label}${ondeLabel}: ${detalhe}`);
      }
    }

    resumo.push({
      campoKey: campo.key,
      label: campo.label,
      codTabela: campo.codigoTabela,
      campo: campo.campo,
      aplicados,
      semMudanca,
      semRegistro,
      naoConfirmados,
    });
  }

  await gravarHistorico(
    lote,
    params.company,
    params.usuario,
    params.obs ?? null,
    params.reverteLote ?? null,
    paraHistorico
  );

  return {
    lote: paraHistorico.length > 0 ? lote : '',
    aplicados: resumo.reduce((acc, r) => acc + r.aplicados, 0),
    semMudanca: resumo.reduce((acc, r) => acc + r.semMudanca, 0),
    semRegistro: resumo.reduce((acc, r) => acc + r.semRegistro, 0),
    naoConfirmados: resumo.reduce((acc, r) => acc + r.naoConfirmados, 0),
    porCampo: resumo,
    erros,
  };
}

/**
 * Desfaz um lote reaplicando os valores anteriores. Não apaga nada: o estorno é
 * um novo lote, marcado com REVERTE_LOTE, igual ao estorno do Ajuste de Estoque.
 */
export async function reverterLotePrecos(
  lote: string,
  company: PrecoCompany,
  usuario: string
): Promise<ExecutarPrecosResult> {
  const linhas = await fetchHistoricoLinhas(lote);
  if (linhas.length === 0) {
    throw new Error('Lote não encontrado no histórico.');
  }
  if (linhas.some((l) => l.empresa !== company)) {
    throw new Error('Este lote pertence a outra empresa.');
  }

  const jaRevertido = await withRequest(async (request) => {
    request.input('revLote', sql.VarChar, limpar(lote));
    const r = await request.query<{ lote: string }>(`
      SELECT TOP 1 LOTE AS lote FROM ${TABELA_HISTORICO} WITH (NOLOCK) WHERE REVERTE_LOTE = @revLote
    `);
    return r.recordset[0]?.lote ?? null;
  });
  if (jaRevertido) {
    throw new Error(`Este lote já foi desfeito pelo lote ${limpar(jaRevertido)}.`);
  }

  const alteracoes: AlteracaoInput[] = [];
  for (const linha of linhas) {
    const campoKey =
      linha.origem === 'PRODUTOS'
        ? campoKeyProdutos(linha.campo)
        : campoKeyTabela(linha.codTabela ?? '', linha.campo);
    if (!parseCampoKey(campoKey)) continue;
    // valorAnterior null = a coluna estava vazia antes; desfazer devolve NULL, não zero.
    alteracoes.push({ produto: linha.produto, campoKey, valor: linha.valorAnterior });
  }

  if (alteracoes.length === 0) {
    throw new Error('Não há alterações registradas para desfazer neste lote.');
  }

  // Sem espelho automático: o lote original já registrou cada coluna que tocou.
  return executarAlteracaoPrecos({
    company,
    usuario,
    alteracoes,
    permitirNulo: true,
    sincronizarPrecoLiquido: false,
    sincronizarPrecoAVista: false,
    obs: `Estorno do lote ${limpar(lote)}`,
    reverteLote: limpar(lote),
  });
}
