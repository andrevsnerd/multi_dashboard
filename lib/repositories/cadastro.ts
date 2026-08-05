/**
 * Alteração de CADASTRO no Linx: dimensões (grupo, subgrupo, linha, tipo, griffe,
 * coleção) e campos do produto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O FATO QUE DEFINE ESTE ARQUIVO
 * ─────────────────────────────────────────────────────────────────────────────
 * No Linx, o NOME da dimensão É a chave primária da tabela mestre:
 *
 *   PRODUTOS_GRUPO     PK (GRUPO_PRODUTO)                     — 194 registros
 *   PRODUTOS_SUBGRUPO  PK (GRUPO_PRODUTO, SUBGRUPO_PRODUTO)   — escopado no grupo
 *   PRODUTOS_LINHAS    PK (LINHA)
 *   PRODUTOS_TIPOS     PK (TIPO_PRODUTO)
 *   PRODUTOS_GRIFFES   PK (GRIFFE)
 *
 * `PRODUTOS.GRUPO_PRODUTO` guarda o texto, não um código. Então renomear um grupo
 * é ALTERAR UMA CHAVE PRIMÁRIA — e o Linx já sabe propagar isso sozinho, por dois
 * caminhos que se somam:
 *
 *   1. FK declarativa ON UPDATE CASCADE:
 *      PRODUTOS_GRUPO → PRODUTOS_SUBGRUPO → PRODUTOS (+ GRIFFE_GRUPO, TAB_MEDIDAS…)
 *      PRODUTOS_LINHAS → PRODUTOS  ·  PRODUTOS_TIPOS → PRODUTOS  ·  COLECOES → PRODUTOS
 *   2. Triggers LXU_PRODUTOS_GRUPO / _SUBGRUPO / _LINHAS, com blocos explícitos
 *      "Parent Update Cascade" e "Parent Update Restrict".
 *
 * DAÍ A REGRA CENTRAL: **renomear é UM ÚNICO UPDATE na tabela mestre.**
 * Nunca atualizamos PRODUTOS na mão junto — os triggers já fazem, e o UPDATE
 * manual aplicaria o efeito duas vezes (é a mesma armadilha da exclusão de
 * romaneio, onde os triggers LXD já revertiam o estoque).
 *
 * Efeito colateral bom: como a cascata roda DENTRO do statement, ela é atômica de
 * graça. Não precisamos de transação — que é justamente o que não existe atrás do
 * proxy HTTP em produção, onde cada statement é uma requisição isolada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE O LINX NÃO CONSERTA
 * ─────────────────────────────────────────────────────────────────────────────
 * As regras do nosso dashboard que casam por STRING literal ('ELETRONICOS',
 * 'PANNEAUX', 'VISCOSE') e os campos que guardamos por cópia no Neon (categoria do
 * catálogo corporativo). Ver `lib/config/cadastro-nomes-sensiveis.ts` — a tela
 * avisa antes de gravar em vez de deixar descobrir pelo número errado depois.
 *
 * Alterar produto segue o fluxo do `precos.ts`: ler → alterar → RELER para
 * confirmar → gravar histórico. Estorno é um lote novo (nada é apagado).
 */

import sql from 'mssql';

import { withRequest } from '@/lib/db/connection';
import type { RequestLike } from '@/lib/db/proxy';
import { AVISOS_COPIA_LOCAL, avisosNomeSensivel } from '@/lib/config/cadastro-nomes-sensiveis';

const CHUNK = 400;
/** Teto de produtos devolvidos para a grade da tela de massa. */
export const LIMITE_PRODUTOS = 3000;
/** Teto de células por execução em massa. */
export const LIMITE_ALTERACOES = 20000;

export type CadastroCompany = 'nerd' | 'scarfme';

/** Mesmo mapa de EMPRESA usado em `precos.ts` / `faturamento.ts`. */
const EMPRESA_CODES: Record<CadastroCompany, number[]> = {
  nerd: [8],
  scarfme: [1, 10, 13, 15, 16],
};

// ═════════════════════════════ dimensões ═════════════════════════════

export type DimensaoTipo = 'grupo' | 'subgrupo' | 'linha' | 'tipo' | 'griffe' | 'colecao';

interface DimensaoDef {
  tipo: DimensaoTipo;
  label: string;
  /** Tabela mestre. Sempre literal deste arquivo — nunca vem do cliente. */
  tabela: string;
  /** Coluna que guarda o NOME exibido. */
  colunaNome: string;
  /**
   * Coluna que IDENTIFICA o registro e com a qual `PRODUTOS.<colunaProduto>` casa.
   * Igual a `colunaNome` quando o nome é a chave; em coleção é o código (COLECAO),
   * porque lá o produto guarda 'L8' e o nome é só a descrição. Contar/atualizar
   * pela coluna de nome nesse caso daria zero produto e UPDATE em nada.
   */
  colunaChave: string;
  /**
   * `true` quando o nome é (parte da) chave primária: renomear dispara a cascata
   * do Linx. `false` = é só uma descrição (coleção), rename sem efeito colateral.
   */
  nomeEhChave: boolean;
  maxNome: number;
  /** Coluna do código curto, quando existe. */
  colunaCodigo: string | null;
  /** O código tem índice UNIQUE (entra no código do produto: `N4.7P.0100`). */
  codigoUnico: boolean;
  codigoMax: number;
  /** Código é NOT NULL na tabela (precisa ser informado ao criar). */
  codigoObrigatorio: boolean;
  /** Coluna de escopo — só o subgrupo tem (pertence a um grupo). */
  colunaPai: string | null;
  /** Coluna equivalente em PRODUTOS, para contar uso. */
  colunaProduto: string;
  temInativo: boolean;
  /** Permite criar novos registros pela tela. */
  podeCriar: boolean;
  /**
   * `false` quando a FK de PRODUTOS para esta mestre é NO_ACTION no UPDATE: aí
   * renomear só funciona se NENHUM produto usar o valor (o próprio SQL Server
   * rejeita). É o caso de GRIFFE (XFK12596_PRODUTOS, ON UPDATE NO_ACTION).
   */
  renomeiaComUso: boolean;
  /** Chave usada no aviso de nome fixo em código. */
  chaveAviso: 'grupo' | 'subgrupo' | 'linha' | 'colecao' | null;
}

const DIMENSOES: Record<DimensaoTipo, DimensaoDef> = {
  grupo: {
    tipo: 'grupo',
    label: 'Grupo',
    tabela: 'PRODUTOS_GRUPO',
    colunaNome: 'GRUPO_PRODUTO',
    colunaChave: 'GRUPO_PRODUTO',
    nomeEhChave: true,
    maxNome: 25,
    colunaCodigo: 'CODIGO_GRUPO',
    codigoUnico: true,
    codigoMax: 3,
    codigoObrigatorio: false,
    colunaPai: null,
    colunaProduto: 'GRUPO_PRODUTO',
    temInativo: true,
    podeCriar: true,
    renomeiaComUso: true,
    chaveAviso: 'grupo',
  },
  subgrupo: {
    tipo: 'subgrupo',
    label: 'Subgrupo',
    tabela: 'PRODUTOS_SUBGRUPO',
    colunaNome: 'SUBGRUPO_PRODUTO',
    colunaChave: 'SUBGRUPO_PRODUTO',
    nomeEhChave: true,
    maxNome: 25,
    colunaCodigo: 'CODIGO_SUBGRUPO',
    codigoUnico: true, // unique dentro do grupo (XAK1PRODUTOS_SUBGRUPO)
    codigoMax: 3,
    codigoObrigatorio: false,
    colunaPai: 'GRUPO_PRODUTO',
    colunaProduto: 'SUBGRUPO_PRODUTO',
    temInativo: true,
    podeCriar: true,
    renomeiaComUso: true,
    chaveAviso: 'subgrupo',
  },
  linha: {
    tipo: 'linha',
    label: 'Linha',
    tabela: 'PRODUTOS_LINHAS',
    colunaNome: 'LINHA',
    colunaChave: 'LINHA',
    nomeEhChave: true,
    maxNome: 25,
    colunaCodigo: 'COD_LINHA',
    codigoUnico: false, // há códigos repetidos na base (COD_LINHA '19' em 7 linhas)
    codigoMax: 2,
    codigoObrigatorio: true,
    colunaPai: null,
    colunaProduto: 'LINHA',
    temInativo: true,
    podeCriar: true,
    renomeiaComUso: true,
    chaveAviso: 'linha',
  },
  tipo: {
    tipo: 'tipo',
    label: 'Tipo',
    tabela: 'PRODUTOS_TIPOS',
    colunaNome: 'TIPO_PRODUTO',
    colunaChave: 'TIPO_PRODUTO',
    nomeEhChave: true,
    maxNome: 25,
    colunaCodigo: 'COD_TIPO_PRODUTO',
    codigoUnico: false,
    codigoMax: 3,
    codigoObrigatorio: false,
    colunaPai: null,
    colunaProduto: 'TIPO_PRODUTO',
    temInativo: true,
    podeCriar: true,
    renomeiaComUso: true,
    chaveAviso: null,
  },
  griffe: {
    tipo: 'griffe',
    label: 'Griffe',
    tabela: 'PRODUTOS_GRIFFES',
    colunaNome: 'GRIFFE',
    colunaChave: 'GRIFFE',
    nomeEhChave: true,
    maxNome: 25,
    colunaCodigo: 'COD_GRIFFE',
    codigoUnico: false,
    codigoMax: 10,
    codigoObrigatorio: true,
    colunaPai: null,
    colunaProduto: 'GRIFFE',
    temInativo: true,
    // A FK PRODUTOS→PRODUTOS_GRIFFES é NO_ACTION no UPDATE: com produto usando,
    // o banco rejeita o rename. Criar tem outros NOT NULL (LICENCIADO/LICENCIADOR),
    // então a tela só renomeia/inativa griffe.
    podeCriar: false,
    renomeiaComUso: false,
    chaveAviso: null,
  },
  colecao: {
    tipo: 'colecao',
    label: 'Coleção',
    tabela: 'COLECOES',
    // A chave é COLECAO (código 'L8'); o NOME é a descrição. Renomear coleção é
    // trocar uma coluna comum: zero cascata, zero risco no ERP.
    colunaNome: 'DESC_COLECAO',
    colunaChave: 'COLECAO',
    nomeEhChave: false,
    maxNome: 40,
    colunaCodigo: 'COLECAO',
    codigoUnico: true,
    codigoMax: 6,
    codigoObrigatorio: true,
    colunaPai: null,
    colunaProduto: 'COLECAO',
    temInativo: true,
    podeCriar: false,
    renomeiaComUso: true,
    chaveAviso: 'colecao',
  },
};

export function parseDimensaoTipo(value: unknown): DimensaoTipo | null {
  return typeof value === 'string' && value in DIMENSOES ? (value as DimensaoTipo) : null;
}

export interface DimensaoMeta {
  tipo: DimensaoTipo;
  label: string;
  nomeEhChave: boolean;
  maxNome: number;
  temCodigo: boolean;
  codigoUnico: boolean;
  codigoMax: number;
  codigoObrigatorio: boolean;
  temPai: boolean;
  temInativo: boolean;
  podeCriar: boolean;
  renomeiaComUso: boolean;
}

export function listarDimensoesMeta(): DimensaoMeta[] {
  return Object.values(DIMENSOES).map((d) => ({
    tipo: d.tipo,
    label: d.label,
    nomeEhChave: d.nomeEhChave,
    maxNome: d.maxNome,
    temCodigo: d.colunaCodigo !== null,
    codigoUnico: d.codigoUnico,
    codigoMax: d.codigoMax,
    codigoObrigatorio: d.codigoObrigatorio,
    temPai: d.colunaPai !== null,
    temInativo: d.temInativo,
    podeCriar: d.podeCriar,
    renomeiaComUso: d.renomeiaComUso,
  }));
}

// ───────────────────────── helpers ─────────────────────────

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

/** `PRODUTO IN (@pfx0, ...)` com os parâmetros já registrados. */
function inProdutos(
  request: sql.Request | RequestLike,
  produtos: string[],
  prefixo: string
): string {
  produtos.forEach((p, i) => request.input(`${prefixo}${i}`, sql.VarChar, p));
  return produtos.map((_, i) => `@${prefixo}${i}`).join(', ');
}

function filtroEmpresa(
  request: sql.Request | RequestLike,
  company: CadastroCompany,
  todoCadastro: boolean,
  prefixo = 'emp'
): string {
  if (todoCadastro) return '';
  const codes = EMPRESA_CODES[company] ?? [];
  if (codes.length === 0) return '';
  codes.forEach((c, i) => request.input(`${prefixo}${i}`, sql.Int, c));
  return `AND p.EMPRESA IN (${codes.map((_, i) => `@${prefixo}${i}`).join(', ')})`;
}

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

// ───────────────────────── leitura de dimensões ─────────────────────────

/** Um registro físico da mestre: no subgrupo, o par (grupo, subgrupo). */
export interface DimensaoPar {
  grupo: string;
  codigo: string | null;
  inativo: boolean;
  produtos: number;
  produtosEmpresa: number;
}

export interface DimensaoRow {
  nome: string;
  /**
   * Identificador do registro para as ações. Igual ao nome quando o nome é a
   * chave; em coleção é o código ('L8'), porque lá o nome é só descrição.
   */
  chave: string;
  codigo: string | null;
  /**
   * Grupo do subgrupo. `null` na linha AGRUPADA (um subgrupo que vive em vários
   * grupos aparece como uma linha só) e nas dimensões que não têm pai.
   */
  pai: string | null;
  /**
   * Os registros físicos que compõem esta linha. Na linha agregada de subgrupo é
   * um par por grupo — é o que deixa claro que "CREPE DE SEDA" é UM subgrupo em 12
   * grupos, e não 12 subgrupos diferentes, e o que alimenta a lista de detalhe com
   * checkbox. Vazio nas dimensões globais (a própria linha já é o registro).
   */
  pares: DimensaoPar[];
  /** `true` quando TODOS os pares estão inativos. */
  inativo: boolean;
  /** `true` quando só PARTE dos pares está inativa. */
  inativoParcial: boolean;
  /** Produtos que usam esse valor no cadastro inteiro (soma dos pares). */
  produtos: number;
  /** Produtos da empresa selecionada. */
  produtosEmpresa: number;
}

export interface DimensaoListaResult {
  rows: DimensaoRow[];
  meta: DimensaoMeta;
  /** `true` quando as linhas estão agregadas por nome (subgrupo sem filtro de grupo). */
  agrupado: boolean;
}

/**
 * Lista uma dimensão com a contagem de uso. A contagem sai de PRODUTOS (não das
 * vendas): a tela precisa mostrar o raio de alcance de um rename, inclusive para
 * dimensão que nunca vendeu.
 */
export async function fetchDimensao(
  company: CadastroCompany,
  tipo: DimensaoTipo,
  opts: {
    pai?: string | null;
    busca?: string | null;
    incluirInativos?: boolean;
    /**
     * Força a lista par-a-par (uma linha por grupo) numa dimensão que normalmente
     * agrega. Usado quando o usuário quer mexer num grupo específico.
     */
    porGrupo?: boolean;
  } = {}
): Promise<DimensaoListaResult> {
  const def = DIMENSOES[tipo];
  const meta = listarDimensoesMeta().find((m) => m.tipo === tipo)!;
  const codes = EMPRESA_CODES[company] ?? [];
  const pai = limpar(opts.pai);

  /**
   * Subgrupo sem filtro de grupo vem AGREGADO POR NOME. No Linx a PK é o par
   * (grupo, subgrupo), então "CREPE DE SEDA" são 12 linhas físicas — mas para
   * quem usa é UM subgrupo que está atrelado a 12 grupos. Listar as 12 linhas
   * separadas dá a impressão errada de 12 subgrupos diferentes e obrigaria a
   * renomear 12 vezes.
   */
  const agrupado = def.colunaPai !== null && !pai && !opts.porGrupo;

  if (agrupado) {
    const rows = await fetchDimensaoAgrupada(def, codes, opts);
    return { meta, rows, agrupado: true };
  }

  const rows = await withRequest(async (request) => {
    const where: string[] = [];

    if (def.colunaPai && pai) {
      request.input('dimPai', sql.VarChar, pai);
      where.push(`AND d.${def.colunaPai} = @dimPai`);
    }
    if (!opts.incluirInativos && def.temInativo) {
      where.push('AND ISNULL(d.INATIVO, 0) = 0');
    }
    const busca = limpar(opts.busca);
    if (busca.length >= 2) {
      request.input('dimBusca', sql.VarChar, `%${busca}%`);
      where.push(`AND d.${def.colunaNome} LIKE @dimBusca`);
    }

    codes.forEach((c, i) => request.input(`dimEmp${i}`, sql.Int, c));
    const empresaIn = codes.length > 0 ? codes.map((_, i) => `@dimEmp${i}`).join(', ') : 'NULL';

    // O JOIN de contagem casa pela MESMA coluna que o Linx usa na FK. No subgrupo
    // é o par (grupo, subgrupo) — 'VISCOSE' existe em 45 grupos diferentes, então
    // contar só pelo nome do subgrupo daria um número que não é deste registro.
    const joinUso = def.colunaPai
      ? `p.${def.colunaProduto} = d.${def.colunaChave} AND p.${def.colunaPai} = d.${def.colunaPai}`
      : `p.${def.colunaProduto} = d.${def.colunaChave}`;

    const query = `
      SELECT
        LTRIM(RTRIM(d.${def.colunaNome})) AS nome,
        LTRIM(RTRIM(CONVERT(VARCHAR(60), d.${def.colunaChave}))) AS chave,
        ${def.colunaCodigo ? `LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(20), d.${def.colunaCodigo}), '')))` : `''`} AS codigo,
        ${def.colunaPai ? `LTRIM(RTRIM(d.${def.colunaPai}))` : `''`} AS pai,
        ${def.temInativo ? 'CAST(ISNULL(d.INATIVO, 0) AS INT)' : '0'} AS inativo,
        (SELECT COUNT(*) FROM PRODUTOS p WITH (NOLOCK) WHERE ${joinUso}) AS produtos,
        (SELECT COUNT(*) FROM PRODUTOS p WITH (NOLOCK)
          WHERE ${joinUso} AND p.EMPRESA IN (${empresaIn})) AS produtosEmpresa
      FROM ${def.tabela} d WITH (NOLOCK)
      WHERE 1 = 1
      ${where.join('\n      ')}
      ORDER BY ${def.colunaPai ? `d.${def.colunaPai}, ` : ''}d.${def.colunaNome}
    `;

    const r = await request.query<{
      nome: string;
      chave: string;
      codigo: string;
      pai: string;
      inativo: number;
      produtos: number;
      produtosEmpresa: number;
    }>(query);
    return r.recordset;
  });

  return {
    meta,
    agrupado: false,
    rows: rows.map((row) => ({
      nome: limpar(row.nome),
      chave: limpar(row.chave),
      codigo: limpar(row.codigo) || null,
      pai: limpar(row.pai) || null,
      pares: [],
      inativo: Number(row.inativo ?? 0) === 1,
      inativoParcial: false,
      produtos: Number(row.produtos ?? 0),
      produtosEmpresa: Number(row.produtosEmpresa ?? 0),
    })),
  };
}

/**
 * Lista de subgrupos agregada por NOME: uma linha por subgrupo, com os grupos aos
 * quais ele está atrelado. Lê os pares e agrega em JS — a agregação precisa da
 * lista de grupos e dos códigos por grupo, que em SQL sairia como XML costurado.
 */
async function fetchDimensaoAgrupada(
  def: DimensaoDef,
  codes: number[],
  opts: { busca?: string | null; incluirInativos?: boolean }
): Promise<DimensaoRow[]> {
  const pares = await withRequest(async (request) => {
    const where: string[] = [];
    if (!opts.incluirInativos && def.temInativo) where.push('AND ISNULL(d.INATIVO, 0) = 0');
    const busca = limpar(opts.busca);
    if (busca.length >= 2) {
      request.input('agBusca', sql.VarChar, `%${busca}%`);
      where.push(`AND d.${def.colunaNome} LIKE @agBusca`);
    }

    codes.forEach((c, i) => request.input(`agEmp${i}`, sql.Int, c));
    const empresaIn = codes.length > 0 ? codes.map((_, i) => `@agEmp${i}`).join(', ') : 'NULL';
    const joinUso = `p.${def.colunaProduto} = d.${def.colunaChave} AND p.${def.colunaPai} = d.${def.colunaPai}`;

    const r = await request.query<{
      nome: string;
      pai: string;
      codigo: string;
      inativo: number;
      produtos: number;
      produtosEmpresa: number;
    }>(`
      SELECT
        LTRIM(RTRIM(d.${def.colunaNome})) AS nome,
        LTRIM(RTRIM(d.${def.colunaPai})) AS pai,
        ${def.colunaCodigo ? `LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(20), d.${def.colunaCodigo}), '')))` : `''`} AS codigo,
        ${def.temInativo ? 'CAST(ISNULL(d.INATIVO, 0) AS INT)' : '0'} AS inativo,
        (SELECT COUNT(*) FROM PRODUTOS p WITH (NOLOCK) WHERE ${joinUso}) AS produtos,
        (SELECT COUNT(*) FROM PRODUTOS p WITH (NOLOCK)
          WHERE ${joinUso} AND p.EMPRESA IN (${empresaIn})) AS produtosEmpresa
      FROM ${def.tabela} d WITH (NOLOCK)
      WHERE 1 = 1
      ${where.join('\n      ')}
      ORDER BY d.${def.colunaNome}, d.${def.colunaPai}
    `);
    return r.recordset;
  });

  const porNome = new Map<string, DimensaoRow & { ativos: number }>();

  for (const par of pares) {
    const nome = limpar(par.nome);
    if (!nome) continue;
    const grupo = limpar(par.pai);
    const inativo = Number(par.inativo ?? 0) === 1;

    let atual = porNome.get(nome);
    if (!atual) {
      atual = {
        nome,
        chave: nome,
        codigo: null,
        pai: null,
        pares: [],
        inativo: true,
        inativoParcial: false,
        produtos: 0,
        produtosEmpresa: 0,
        ativos: 0,
      };
      porNome.set(nome, atual);
    }

    atual.pares.push({
      grupo,
      codigo: limpar(par.codigo) || null,
      inativo,
      produtos: Number(par.produtos ?? 0),
      produtosEmpresa: Number(par.produtosEmpresa ?? 0),
    });
    atual.produtos += Number(par.produtos ?? 0);
    atual.produtosEmpresa += Number(par.produtosEmpresa ?? 0);
    if (!inativo) {
      atual.inativo = false;
      atual.ativos += 1;
    }
  }

  return [...porNome.values()]
    .map(({ ativos, ...row }) => {
      const codigos = [...new Set(row.pares.map((p) => p.codigo).filter(Boolean))];
      return {
        ...row,
        // Um código só faz sentido exibir quando é o mesmo em todos os grupos;
        // o código é por par, então normalmente difere.
        codigo: codigos.length === 1 ? codigos[0]! : null,
        inativoParcial: !row.inativo && ativos < row.pares.length,
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Grupos disponíveis para escopar a lista de subgrupos e os seletores do produto. */
export async function fetchGruposParaSelecao(): Promise<string[]> {
  return withRequest(async (request) => {
    const r = await request.query<{ nome: string }>(`
      SELECT LTRIM(RTRIM(GRUPO_PRODUTO)) AS nome
      FROM PRODUTOS_GRUPO WITH (NOLOCK)
      ORDER BY GRUPO_PRODUTO
    `);
    return r.recordset.map((row) => limpar(row.nome)).filter(Boolean);
  });
}

// ───────────────────────── pré-checagens do rename ─────────────────────────

export interface ImpactoDimensao {
  /** Produtos que o rename vai cascatear (cadastro inteiro). */
  produtos: number;
  /** Produtos da empresa selecionada — o que o dono reconhece como "seus". */
  produtosEmpresa: number;
  /** Nome novo já existe na mestre → seria uma mesclagem (não suportada). */
  nomeJaExiste: boolean;
  /** Código novo já usado por outro registro (índice UNIQUE). */
  codigoJaExiste: boolean;
  /** Regras do dashboard que casam esse nome por string literal. */
  avisosCodigo: string[];
  /** Campos que guardamos por cópia e ficam velhos sozinhos. */
  avisosCopia: string[];
  /** Renomear com produto em uso é rejeitado pelo banco nesta dimensão. */
  bloqueadoPorUso: boolean;
  /**
   * Grupos alcançados quando o rename de subgrupo é global (um por par a alterar).
   * Vazio nas outras dimensões e no rename escopado num grupo só.
   */
  gruposAfetados: string[];
  /**
   * Grupos onde o nome de destino JÁ existe. Ali o rename seria mesclagem (viola a
   * PK do par), então esses grupos bloqueiam a operação e são listados por nome.
   */
  colisoes: string[];
}

/** Grupos aos quais um nome de subgrupo está atrelado, em ordem alfabética. */
async function listarGruposDoSubgrupo(def: DimensaoDef, nome: string): Promise<string[]> {
  if (!def.colunaPai) return [];
  const alvo = limpar(nome);
  if (!alvo) return [];
  return withRequest(async (request) => {
    request.input('lgNome', sql.VarChar, alvo);
    const r = await request.query<{ pai: string }>(`
      SELECT LTRIM(RTRIM(d.${def.colunaPai})) AS pai
      FROM ${def.tabela} d WITH (NOLOCK)
      WHERE d.${def.colunaNome} = @lgNome
      ORDER BY d.${def.colunaPai}
    `);
    return r.recordset.map((row) => limpar(row.pai)).filter(Boolean);
  });
}

/**
 * Tudo o que a tela precisa mostrar ANTES de gravar. Uma pré-checagem que falha
 * aqui vira mensagem; o mesmo caso, se passasse, viraria erro do trigger ou
 * violação de PK — a diferença é que aqui o usuário entende o motivo.
 */
export async function avaliarImpactoDimensao(
  company: CadastroCompany,
  tipo: DimensaoTipo,
  params: {
    nomeAtual: string;
    nomeNovo?: string | null;
    pai?: string | null;
    codigoNovo?: string | null;
    /** Chave do registro; só é diferente do nome em coleção. */
    chave?: string | null;
    /**
     * Restringe os grupos-alvo a uma lista explícita. Usado pelo estorno, que tem
     * de reverter exatamente os pares do lote — nunca mais que isso.
     */
    grupos?: string[] | null;
  }
): Promise<ImpactoDimensao> {
  const def = DIMENSOES[tipo];
  const nomeAtual = limpar(params.nomeAtual);
  const nomeNovo = limpar(params.nomeNovo);
  const pai = limpar(params.pai);
  const codigoNovo = limpar(params.codigoNovo);
  const chave = def.nomeEhChave ? nomeAtual : limpar(params.chave);
  const codes = EMPRESA_CODES[company] ?? [];

  /**
   * Grupos que o rename vai tocar — resolvidos ANTES da contagem, porque é a
   * contagem que depende deles. Lista explícita (a seleção da tela) vence; senão
   * é o grupo pedido; senão todos os grupos que têm esse nome de subgrupo.
   */
  const gruposExplicitos = (params.grupos ?? []).map(limpar).filter(Boolean);
  const gruposAfetados = !def.colunaPai
    ? []
    : gruposExplicitos.length > 0
      ? gruposExplicitos
      : pai
        ? [pai]
        : await listarGruposDoSubgrupo(def, nomeAtual);

  const contagens = await withRequest(async (request) => {
    // A contagem casa a coluna de PRODUTOS com a CHAVE, não com o nome exibido.
    request.input('impNome', sql.VarChar, chave);
    codes.forEach((c, i) => request.input(`impEmp${i}`, sql.Int, c));
    const empresaIn = codes.length > 0 ? codes.map((_, i) => `@impEmp${i}`).join(', ') : 'NULL';

    /**
     * Restringe aos grupos-alvo. Sem isso, desmarcar um grupo na tela não mudaria o
     * número de produtos — o preview prometeria uma cascata maior do que a real.
     */
    let whereGrupos = '';
    if (def.colunaPai && gruposAfetados.length > 0) {
      gruposAfetados.forEach((g, i) => request.input(`impGr${i}`, sql.VarChar, g));
      const ph = gruposAfetados.map((_, i) => `@impGr${i}`).join(', ');
      whereGrupos = `AND p.${def.colunaPai} IN (${ph})`;
    }

    const r = await request.query<{ produtos: number; produtosEmpresa: number }>(`
      SELECT
        COUNT(*) AS produtos,
        SUM(CASE WHEN p.EMPRESA IN (${empresaIn}) THEN 1 ELSE 0 END) AS produtosEmpresa
      FROM PRODUTOS p WITH (NOLOCK)
      WHERE p.${def.colunaProduto} = @impNome ${whereGrupos}
    `);
    return r.recordset[0] ?? { produtos: 0, produtosEmpresa: 0 };
  });

  // Colidir só é problema quando o nome É a chave (PK). Descrição de coleção pode
  // repetir sem quebrar nada, então nem checamos.
  let nomeJaExiste = false;
  let colisoes: string[] = [];
  if (def.nomeEhChave && nomeNovo && nomeNovo.toUpperCase() !== nomeAtual.toUpperCase()) {
    if (def.colunaPai) {
      // Por par: o destino pode estar livre em 9 grupos e ocupado em 3. Listamos
      // exatamente quais bloqueiam, em vez de um "já existe" que não diz onde.
      const ocupados = await listarGruposDoSubgrupo(def, nomeNovo);
      const alvo = new Set(gruposAfetados);
      colisoes = ocupados.filter((g) => alvo.has(g));
      nomeJaExiste = colisoes.length > 0;
    } else {
      nomeJaExiste = await withRequest(async (request) => {
        request.input('exNome', sql.VarChar, nomeNovo);
        const r = await request.query<{ n: number }>(`
          SELECT COUNT(*) AS n FROM ${def.tabela} d WITH (NOLOCK)
          WHERE d.${def.colunaNome} = @exNome
        `);
        return Number(r.recordset[0]?.n ?? 0) > 0;
      });
    }
  }

  let codigoJaExiste = false;
  if (codigoNovo && def.colunaCodigo && def.codigoUnico) {
    codigoJaExiste = await withRequest(async (request) => {
      request.input('exCod', sql.VarChar, codigoNovo);
      request.input('exCodNome', sql.VarChar, nomeAtual);
      if (def.colunaPai && pai) request.input('exCodPai', sql.VarChar, pai);
      const wherePai = def.colunaPai && pai ? `AND d.${def.colunaPai} = @exCodPai` : '';
      const r = await request.query<{ n: number }>(`
        SELECT COUNT(*) AS n FROM ${def.tabela} d WITH (NOLOCK)
        WHERE LTRIM(RTRIM(CONVERT(VARCHAR(20), d.${def.colunaCodigo}))) = @exCod
          AND d.${def.colunaNome} <> @exCodNome ${wherePai}
      `);
      return Number(r.recordset[0]?.n ?? 0) > 0;
    });
  }

  const produtos = Number(contagens.produtos ?? 0);

  return {
    produtos,
    produtosEmpresa: Number(contagens.produtosEmpresa ?? 0),
    nomeJaExiste,
    codigoJaExiste,
    gruposAfetados,
    colisoes,
    avisosCodigo: def.chaveAviso ? avisosNomeSensivel(def.chaveAviso, nomeAtual) : [],
    avisosCopia: produtos > 0 ? AVISOS_COPIA_LOCAL[tipo] ?? [] : [],
    bloqueadoPorUso: !def.renomeiaComUso && produtos > 0,
  };
}

/** Próximo código curto livre, para a criação não colidir com o índice UNIQUE. */
export async function sugerirCodigoDimensao(
  tipo: DimensaoTipo,
  pai?: string | null
): Promise<string | null> {
  const def = DIMENSOES[tipo];
  if (!def.colunaCodigo) return null;

  const usados = await withRequest(async (request) => {
    if (def.colunaPai && limpar(pai)) request.input('sugPai', sql.VarChar, limpar(pai));
    const wherePai = def.colunaPai && limpar(pai) ? `WHERE d.${def.colunaPai} = @sugPai` : '';
    const r = await request.query<{ codigo: string }>(`
      SELECT LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(20), d.${def.colunaCodigo}), ''))) AS codigo
      FROM ${def.tabela} d WITH (NOLOCK) ${wherePai}
    `);
    return new Set(r.recordset.map((row) => limpar(row.codigo).toUpperCase()).filter(Boolean));
  });

  // Numérico com zero à esquerda é o padrão da base ('01', '07', '21'). Depois
  // dos numéricos, cai para o alfanumérico que o Linx também usa ('7P', 'W9').
  const largura = Math.min(def.codigoMax, 2);
  const limite = 10 ** largura;
  for (let n = 1; n < limite; n += 1) {
    const cod = String(n).padStart(largura, '0');
    if (!usados.has(cod)) return cod;
  }
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const a of letras) {
    for (let n = 0; n < 10; n += 1) {
      const cod = `${n}${a}`;
      if (!usados.has(cod)) return cod;
    }
  }
  return null;
}

// ═════════════════════════════ histórico ═════════════════════════════

const TABELA_HISTORICO = 'NERD_CADASTRO_HISTORICO';

let historicoGarantido = false;

/** Cria a tabela de histórico na primeira gravação (padrão do NERD_PRECO_HISTORICO). */
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
        ESCOPO         VARCHAR(20)   NOT NULL,
        ACAO           VARCHAR(20)   NOT NULL,
        DIMENSAO       VARCHAR(20)   NULL,
        ALVO           VARCHAR(120)  NOT NULL,
        -- Chave do registro na mestre. Igual a ALVO quando o nome é a chave; em
        -- coleção é o código ('L8'), sem o qual o estorno não acha a linha.
        CHAVE          VARCHAR(60)   NULL,
        PAI            VARCHAR(60)   NULL,
        CAMPO          VARCHAR(60)   NOT NULL,
        VALOR_ANTERIOR VARCHAR(300)  NULL,
        VALOR_NOVO     VARCHAR(300)  NULL,
        PRODUTOS       INT           NULL,
        OBS            VARCHAR(300)  NULL,
        REVERTE_LOTE   VARCHAR(40)   NULL
      )
    `);
  });
  historicoGarantido = true;
}

export type EscopoHistorico = 'DIMENSAO' | 'PRODUTO';
export type AcaoHistorico = 'RENOMEAR' | 'CRIAR' | 'INATIVAR' | 'REATIVAR' | 'CAMPO';

export interface HistoricoLinha {
  id: number;
  lote: string;
  data: string;
  empresa: string;
  usuario: string;
  escopo: EscopoHistorico;
  acao: AcaoHistorico;
  dimensao: DimensaoTipo | null;
  alvo: string;
  chave: string | null;
  pai: string | null;
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
  produtos: number | null;
  obs: string | null;
  reverteLote: string | null;
}

export interface HistoricoLote {
  lote: string;
  data: string;
  usuario: string;
  empresa: string;
  escopo: EscopoHistorico;
  acao: AcaoHistorico;
  alteracoes: number;
  alvos: number;
  resumo: string;
  /** Produtos que a cascata alcançou (rename de dimensão). */
  produtos: number | null;
  obs: string | null;
  reverteLote: string | null;
  revertidoPor: string | null;
  /** `false` para lotes de criação: desfazer seria DELETE — use inativar. */
  reversivel: boolean;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return limpar(value);
}

interface LinhaHistoricoInput {
  escopo: EscopoHistorico;
  acao: AcaoHistorico;
  dimensao: DimensaoTipo | null;
  alvo: string;
  chave: string | null;
  pai: string | null;
  campo: string;
  anterior: string | null;
  novo: string | null;
  produtos: number | null;
}

async function gravarHistorico(
  lote: string,
  company: CadastroCompany,
  usuario: string,
  obs: string | null,
  reverteLote: string | null,
  linhas: LinhaHistoricoInput[]
): Promise<void> {
  if (linhas.length === 0) return;
  await ensureHistoricoTable();

  for (const parte of chunk(linhas, 100)) {
    await withRequest(async (request) => {
      request.input('hLote', sql.VarChar, lote);
      request.input('hEmpresa', sql.VarChar, company);
      request.input('hUsuario', sql.VarChar, usuario.slice(0, 100));
      request.input('hObs', sql.VarChar, obs ? obs.slice(0, 300) : null);
      request.input('hReverte', sql.VarChar, reverteLote);

      const values = parte.map((linha, i) => {
        request.input(`he${i}`, sql.VarChar, linha.escopo);
        request.input(`hac${i}`, sql.VarChar, linha.acao);
        request.input(`hd${i}`, sql.VarChar, linha.dimensao);
        request.input(`hal${i}`, sql.VarChar, linha.alvo.slice(0, 120));
        request.input(`hch${i}`, sql.VarChar, linha.chave ? linha.chave.slice(0, 60) : null);
        request.input(`hpa${i}`, sql.VarChar, linha.pai ? linha.pai.slice(0, 60) : null);
        request.input(`hc${i}`, sql.VarChar, linha.campo.slice(0, 60));
        request.input(`hva${i}`, sql.VarChar, linha.anterior === null ? null : linha.anterior.slice(0, 300));
        request.input(`hvn${i}`, sql.VarChar, linha.novo === null ? null : linha.novo.slice(0, 300));
        request.input(`hpr${i}`, sql.Int, linha.produtos);
        return `(@hLote, @hEmpresa, @hUsuario, @he${i}, @hac${i}, @hd${i}, @hal${i}, @hch${i}, @hpa${i}, @hc${i}, @hva${i}, @hvn${i}, @hpr${i}, @hObs, @hReverte)`;
      });

      await request.query(`
        INSERT INTO ${TABELA_HISTORICO}
          (LOTE, EMPRESA, USUARIO, ESCOPO, ACAO, DIMENSAO, ALVO, CHAVE, PAI, CAMPO,
           VALOR_ANTERIOR, VALOR_NOVO, PRODUTOS, OBS, REVERTE_LOTE)
        VALUES ${values.join(', ')}
      `);
    });
  }
}

export async function fetchHistoricoLotes(
  company: CadastroCompany,
  limite = 30
): Promise<HistoricoLote[]> {
  await ensureHistoricoTable();
  const top = Math.min(Math.max(limite, 1), 200);
  return withRequest(async (request) => {
    request.input('histEmpresa', sql.VarChar, company);
    const r = await request.query<Record<string, unknown>>(`
      SELECT TOP ${top}
        h.LOTE AS lote,
        MIN(h.DATA_ALTERACAO) AS data,
        MAX(h.USUARIO) AS usuario,
        MAX(h.EMPRESA) AS empresa,
        MAX(h.ESCOPO) AS escopo,
        MAX(h.ACAO) AS acao,
        COUNT(*) AS alteracoes,
        COUNT(DISTINCT h.ALVO) AS alvos,
        MAX(ISNULL(h.PRODUTOS, 0)) AS produtos,
        MAX(ISNULL(h.OBS, '')) AS obs,
        MAX(ISNULL(h.REVERTE_LOTE, '')) AS reverteLote,
        (
          SELECT TOP 1 e.LOTE FROM ${TABELA_HISTORICO} e WITH (NOLOCK)
          WHERE e.REVERTE_LOTE = h.LOTE
        ) AS revertidoPor,
        STUFF((
          SELECT DISTINCT ', ' + LTRIM(RTRIM(d.CAMPO))
          FROM ${TABELA_HISTORICO} d WITH (NOLOCK)
          WHERE d.LOTE = h.LOTE
          FOR XML PATH(''), TYPE
        ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS resumo
      FROM ${TABELA_HISTORICO} h WITH (NOLOCK)
      WHERE h.EMPRESA = @histEmpresa
      GROUP BY h.LOTE
      ORDER BY MIN(h.DATA_ALTERACAO) DESC
    `);

    return r.recordset.map((row) => {
      const acao = (limpar(row.acao) || 'CAMPO') as AcaoHistorico;
      return {
        lote: limpar(row.lote),
        data: toIso(row.data),
        usuario: limpar(row.usuario),
        empresa: limpar(row.empresa),
        escopo: (limpar(row.escopo) === 'DIMENSAO' ? 'DIMENSAO' : 'PRODUTO') as EscopoHistorico,
        acao,
        alteracoes: Number(row.alteracoes ?? 0),
        alvos: Number(row.alvos ?? 0),
        resumo: limpar(row.resumo),
        produtos: Number(row.produtos ?? 0) || null,
        obs: limpar(row.obs) || null,
        reverteLote: limpar(row.reverteLote) || null,
        revertidoPor: limpar(row.revertidoPor) || null,
        // Criar é o único caso sem estorno: desfazer seria DELETE na mestre, e
        // um DELETE arrasta filhas por CASCADE. O caminho certo é inativar.
        reversivel: acao !== 'CRIAR',
      };
    });
  });
}

export async function fetchHistoricoLinhas(lote: string): Promise<HistoricoLinha[]> {
  await ensureHistoricoTable();
  const loteLimpo = limpar(lote);
  if (!loteLimpo) return [];
  return withRequest(async (request) => {
    request.input('loteId', sql.VarChar, loteLimpo);
    const r = await request.query<Record<string, unknown>>(`
      SELECT ID, LOTE, DATA_ALTERACAO, EMPRESA, USUARIO, ESCOPO, ACAO, DIMENSAO,
             ALVO, CHAVE, PAI, CAMPO, VALOR_ANTERIOR, VALOR_NOVO, PRODUTOS, OBS, REVERTE_LOTE
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
      escopo: (limpar(row.ESCOPO) === 'DIMENSAO' ? 'DIMENSAO' : 'PRODUTO') as EscopoHistorico,
      acao: (limpar(row.ACAO) || 'CAMPO') as AcaoHistorico,
      dimensao: parseDimensaoTipo(limpar(row.DIMENSAO)),
      alvo: limpar(row.ALVO),
      chave: limpar(row.CHAVE) || null,
      pai: limpar(row.PAI) || null,
      campo: limpar(row.CAMPO),
      valorAnterior: row.VALOR_ANTERIOR === null ? null : limpar(row.VALOR_ANTERIOR),
      valorNovo: row.VALOR_NOVO === null ? null : limpar(row.VALOR_NOVO),
      produtos: toNumber(row.PRODUTOS),
      obs: limpar(row.OBS) || null,
      reverteLote: limpar(row.REVERTE_LOTE) || null,
    }));
  });
}

function novoLoteId(): string {
  const agora = new Date();
  const stamp = agora.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CAD${stamp}${rand}`;
}

// ═════════════════════════ execução: dimensões ═════════════════════════

export interface ResultadoDimensao {
  lote: string;
  ok: boolean;
  /** Produtos que a cascata do Linx alcançou (confirmado por releitura). */
  produtosAfetados: number;
  /** Grupos efetivamente renomeados (subgrupo). Vazio nas outras dimensões. */
  gruposRenomeados: string[];
  mensagem: string;
  avisos: string[];
}

/**
 * Renomeia uma dimensão. Um UPDATE na tabela mestre POR REGISTRO — e o "por
 * registro" não é preciosismo, é obrigatório no subgrupo. Ver abaixo.
 *
 * A cascata para PRODUTOS e para as filhas é do Linx (FK ON UPDATE CASCADE +
 * triggers LXU_*). Não tocamos PRODUTOS aqui de propósito — fazer isso aplicaria
 * o efeito duas vezes. A confirmação é por releitura.
 *
 * ── POR QUE NUNCA UM UPDATE DE VÁRIAS LINHAS ──────────────────────────────────
 * O subgrupo tem PK (GRUPO, SUBGRUPO): "CREPE DE SEDA" são 12 linhas físicas, uma
 * por grupo. Seria natural renomear as 12 num único
 *   `UPDATE PRODUTOS_SUBGRUPO SET SUBGRUPO_PRODUTO=@novo WHERE SUBGRUPO_PRODUTO=@velho`
 * — e isso é PERIGOSO. O trigger `LXU_PRODUTOS_SUBGRUPO` cascateia assim:
 *
 *   DECLARE CURI CURSOR FOR SELECT SUBGRUPO_PRODUTO, GRUPO_PRODUTO FROM INSERTED
 *   DECLARE CURD CURSOR FOR SELECT SUBGRUPO_PRODUTO, GRUPO_PRODUTO FROM DELETED
 *   -- avança os dois em paralelo, pareando por POSIÇÃO
 *   UPDATE PRODUTOS SET SUBGRUPO=@ins, GRUPO=@insGrupo
 *   WHERE SUBGRUPO=@del AND GRUPO=@delGrupo
 *
 * `INSERTED` e `DELETED` não têm ordem correlacionada. Com várias linhas, o par
 * (novo de um grupo) × (velho de OUTRO grupo) é possível — e o UPDATE resultante
 * moveria produtos de um grupo para outro, sem violar FK, sem erro, em silêncio.
 * Com uma linha por statement o pareamento é inequívoco por construção.
 *
 * O preço é perder atomicidade entre os pares. Mitigado com pré-checagem de TODAS
 * as colisões antes de começar (o único modo de falha realista) e histórico por
 * par no mesmo lote — um lote parcial é revertível.
 */
export async function renomearDimensao(params: {
  company: CadastroCompany;
  usuario: string;
  tipo: DimensaoTipo;
  nomeAtual: string;
  nomeNovo: string;
  pai?: string | null;
  /** Chave do registro; só difere do nome em coleção. */
  chave?: string | null;
  /**
   * Grupos-alvo explícitos (subgrupo). Usado pelo estorno para reverter exatamente
   * os pares do lote — sem isso um estorno global poderia pegar um grupo que já
   * tinha o nome de destino antes do lote.
   */
  grupos?: string[] | null;
  obs?: string | null;
  reverteLote?: string | null;
}): Promise<ResultadoDimensao> {
  const def = DIMENSOES[params.tipo];
  const nomeAtual = limpar(params.nomeAtual);
  const nomeNovo = limpar(params.nomeNovo);
  const pai = limpar(params.pai);
  const chave = def.nomeEhChave ? nomeAtual : limpar(params.chave);

  if (!def.nomeEhChave && !chave) {
    throw new Error(`Informe o código da ${def.label.toLowerCase()} a renomear.`);
  }
  if (!nomeAtual) throw new Error('Informe o nome atual da dimensão.');
  if (!nomeNovo) throw new Error('Informe o nome novo.');
  if (nomeNovo.length > def.maxNome) {
    throw new Error(`O nome novo tem ${nomeNovo.length} caracteres; o limite do Linx é ${def.maxNome}.`);
  }
  if (nomeNovo === nomeAtual) throw new Error('O nome novo é igual ao atual.');

  const impacto = await avaliarImpactoDimensao(params.company, params.tipo, {
    nomeAtual,
    nomeNovo,
    pai,
    chave,
    grupos: params.grupos ?? null,
  });

  if (impacto.bloqueadoPorUso) {
    throw new Error(
      `${def.label} em uso por ${impacto.produtos} produto(s). Nesta dimensão o banco ` +
        'rejeita o rename com produto vinculado (FK sem cascata) — só dá para renomear ' +
        `${def.label.toLowerCase()} sem nenhum produto.`
    );
  }

  if (impacto.nomeJaExiste) {
    if (def.colunaPai && impacto.colisoes.length > 0) {
      throw new Error(
        `O nome "${nomeNovo}" já existe como ${def.label.toLowerCase()} em: ` +
          `${impacto.colisoes.join(', ')}. Nesses grupos o rename seria uma MESCLAGEM ` +
          '(dois subgrupos virando um), que o Linx não faz por UPDATE. Renomeie nos outros ' +
          'grupos escolhendo o grupo específico, ou use outro nome.'
      );
    }
    throw new Error(
      `Já existe ${def.label.toLowerCase()} com o nome "${nomeNovo}". ` +
        'Renomear para um nome existente seria uma MESCLAGEM (juntar dois cadastros em um), ' +
        'que o Linx não faz por UPDATE — escolha outro nome.'
    );
  }

  /**
   * Alvos: no subgrupo, um por grupo (global) ou só o grupo pedido. Nas demais
   * dimensões, um alvo só — a própria chave.
   */
  const alvos: Array<string | null> = def.colunaPai
    ? impacto.gruposAfetados.length > 0
      ? impacto.gruposAfetados
      : []
    : [null];

  if (alvos.length === 0) {
    throw new Error(
      `Nenhum registro de ${def.label.toLowerCase()} "${nomeAtual}" foi encontrado para renomear.`
    );
  }

  const lote = novoLoteId();
  const linhasHistorico: LinhaHistoricoInput[] = [];
  const gruposRenomeados: string[] = [];
  const falhas: string[] = [];
  let produtosAfetados = 0;

  // Uma linha por statement, sempre. O motivo está no cabeçalho da função.
  for (const grupo of alvos) {
    try {
      await withRequest(async (request) => {
        request.input('renNovo', sql.VarChar, nomeNovo);
        request.input('renChave', sql.VarChar, chave);
        const wherePai = grupo ? `AND ${def.colunaPai} = @renPai` : '';
        if (grupo) request.input('renPai', sql.VarChar, grupo);
        await request.query(`
          UPDATE ${def.tabela}
          SET ${def.colunaNome} = @renNovo
          WHERE ${def.colunaChave} = @renChave ${wherePai}
        `);
      });

      /**
       * Releitura de confirmação. Quando o nome É a chave, a prova é dupla: o nome
       * antigo desapareceu e o novo apareceu. Quando é só descrição (coleção), a
       * chave não mudou — a prova é a descrição estar com o valor novo.
       */
      const confirmacao = await withRequest(async (request) => {
        request.input('cfAtual', sql.VarChar, nomeAtual);
        request.input('cfNovo', sql.VarChar, nomeNovo);
        request.input('cfChave', sql.VarChar, chave);
        const wherePai = grupo ? `AND d.${def.colunaPai} = @cfPai` : '';
        const whereProdPai = grupo ? `AND p.${def.colunaPai} = @cfPai` : '';
        if (grupo) request.input('cfPai', sql.VarChar, grupo);

        const chaveNova = def.nomeEhChave ? '@cfNovo' : '@cfChave';
        const chaveAntiga = def.nomeEhChave ? '@cfAtual' : '@cfChave';
        const r = await request.query<{ antigos: number; novos: number; produtosNovo: number }>(`
          SELECT
            (SELECT COUNT(*) FROM ${def.tabela} d WITH (NOLOCK)
              WHERE d.${def.colunaNome} = @cfAtual
                AND d.${def.colunaChave} = ${chaveAntiga} ${wherePai}) AS antigos,
            (SELECT COUNT(*) FROM ${def.tabela} d WITH (NOLOCK)
              WHERE d.${def.colunaNome} = @cfNovo
                AND d.${def.colunaChave} = ${chaveNova} ${wherePai}) AS novos,
            (SELECT COUNT(*) FROM PRODUTOS p WITH (NOLOCK)
              WHERE p.${def.colunaProduto} = ${chaveNova} ${whereProdPai}) AS produtosNovo
        `);
        return r.recordset[0] ?? { antigos: 0, novos: 0, produtosNovo: 0 };
      });

      if (Number(confirmacao.antigos ?? 0) !== 0 || Number(confirmacao.novos ?? 0) === 0) {
        falhas.push(grupo ? `${grupo} (banco não confirmou)` : 'banco não confirmou');
        continue;
      }

      const produtos = Number(confirmacao.produtosNovo ?? 0);
      produtosAfetados += produtos;
      if (grupo) gruposRenomeados.push(grupo);

      linhasHistorico.push({
        escopo: 'DIMENSAO',
        acao: 'RENOMEAR',
        dimensao: params.tipo,
        alvo: nomeNovo,
        chave: def.nomeEhChave ? nomeNovo : chave,
        pai: grupo,
        campo: `${def.label} · nome`,
        anterior: nomeAtual,
        novo: nomeNovo,
        produtos,
      });
    } catch (error) {
      const detalhe = error instanceof Error ? error.message : String(error);
      falhas.push(grupo ? `${grupo}: ${detalhe}` : detalhe);
    }
  }

  // Só grava histórico do que o banco confirmou — nada de registrar intenção.
  await gravarHistorico(
    lote,
    params.company,
    params.usuario,
    params.obs ?? null,
    params.reverteLote ?? null,
    linhasHistorico
  );

  if (linhasHistorico.length === 0) {
    throw new Error(
      `Nenhum registro foi renomeado. ${falhas.join(' · ')}. Nada foi gravado no histórico.`
    );
  }

  const escopoTexto = def.colunaPai
    ? gruposRenomeados.length === 1
      ? ` no grupo ${gruposRenomeados[0]}`
      : ` em ${gruposRenomeados.length} grupos`
    : '';

  const avisos = [...impacto.avisosCodigo, ...impacto.avisosCopia];
  if (falhas.length > 0) {
    avisos.unshift(
      `Atenção: ${falhas.length} registro(s) NÃO foram renomeados — ${falhas.join(' · ')}. ` +
        'O lote ficou parcial; desfazer reverte só o que entrou.'
    );
  }

  return {
    lote,
    ok: falhas.length === 0,
    produtosAfetados,
    gruposRenomeados,
    mensagem:
      produtosAfetados > 0
        ? `"${nomeAtual}" virou "${nomeNovo}"${escopoTexto}. A cascata do Linx atualizou ${produtosAfetados} produto(s).`
        : `"${nomeAtual}" virou "${nomeNovo}"${escopoTexto}. Nenhum produto usava esse valor.`,
    avisos,
  };
}

/** Um alvo de ativo/inativo: o nome (+ chave) e os grupos em que ele deve mudar. */
export interface AlvoInativo {
  nome: string;
  /** Chave do registro; só difere do nome em coleção. */
  chave?: string | null;
  /** Grupos escolhidos (subgrupo). Vazio = todos os grupos do nome. */
  grupos?: string[] | null;
}

/**
 * Liga/desliga o bit INATIVO da mestre. Não toca em nenhum produto.
 *
 * Aceita VÁRIOS alvos porque a tela permite marcar N dimensões e inativar todas de
 * uma vez — e todas têm de cair no MESMO lote, senão desfazer viraria N estornos.
 */
export async function alternarInativoDimensao(params: {
  company: CadastroCompany;
  usuario: string;
  tipo: DimensaoTipo;
  /** Alvo único (atalho). Ignorado quando `alvos` vem preenchido. */
  nome?: string;
  pai?: string | null;
  chave?: string | null;
  grupos?: string[] | null;
  /** Vários alvos de uma vez. */
  alvos?: AlvoInativo[] | null;
  inativo: boolean;
  obs?: string | null;
  reverteLote?: string | null;
}): Promise<ResultadoDimensao> {
  const def = DIMENSOES[params.tipo];
  if (!def.temInativo) throw new Error(`${def.label} não tem controle de ativo/inativo no Linx.`);

  const pai = limpar(params.pai);
  const alvosEntrada: AlvoInativo[] =
    params.alvos && params.alvos.length > 0
      ? params.alvos
      : [
          {
            nome: limpar(params.nome),
            chave: params.chave ?? null,
            grupos: params.grupos ?? (pai ? [pai] : null),
          },
        ];

  const lote = novoLoteId();
  const linhasHistorico: LinhaHistoricoInput[] = [];
  const gruposAlterados: string[] = [];
  const nomesAlterados = new Set<string>();
  const falhas: string[] = [];
  let produtosTocados = 0;

  for (const alvo of alvosEntrada) {
    const nome = limpar(alvo.nome);
    const chave = def.nomeEhChave ? nome : limpar(alvo.chave);
    if (!nome) {
      falhas.push('alvo sem nome');
      continue;
    }
    if (!chave) {
      falhas.push(`${nome}: sem código`);
      continue;
    }

    const impacto = await avaliarImpactoDimensao(params.company, params.tipo, {
      nomeAtual: nome,
      chave,
      grupos: alvo.grupos ?? null,
    });
    produtosTocados += impacto.produtos;

    // Um statement por registro, igual ao rename — mantém um só modelo de escopo.
    const grupos: Array<string | null> = def.colunaPai ? impacto.gruposAfetados : [null];
    if (grupos.length === 0) {
      falhas.push(`${nome}: nenhum registro encontrado`);
      continue;
    }

    for (const grupo of grupos) {
      try {
        await withRequest(async (request) => {
          request.input('inaChave', sql.VarChar, chave);
          request.input('inaValor', sql.Bit, params.inativo);
          const wherePai = grupo ? `AND ${def.colunaPai} = @inaPai` : '';
          if (grupo) request.input('inaPai', sql.VarChar, grupo);
          await request.query(`
            UPDATE ${def.tabela}
            SET INATIVO = @inaValor
            WHERE ${def.colunaChave} = @inaChave ${wherePai}
          `);
        });

        const confirmado = await withRequest(async (request) => {
          request.input('cfiChave', sql.VarChar, chave);
          const wherePai = grupo ? `AND d.${def.colunaPai} = @cfiPai` : '';
          if (grupo) request.input('cfiPai', sql.VarChar, grupo);
          const r = await request.query<{ inativo: number }>(`
            SELECT CAST(ISNULL(d.INATIVO, 0) AS INT) AS inativo
            FROM ${def.tabela} d WITH (NOLOCK)
            WHERE d.${def.colunaChave} = @cfiChave ${wherePai}
          `);
          return Number(r.recordset[0]?.inativo ?? 0) === 1;
        });

        if (confirmado !== params.inativo) {
          falhas.push(grupo ? `${nome} / ${grupo} (não confirmou)` : `${nome} (não confirmou)`);
          continue;
        }

        if (grupo) gruposAlterados.push(grupo);
        nomesAlterados.add(nome);
        linhasHistorico.push({
          escopo: 'DIMENSAO',
          acao: params.inativo ? 'INATIVAR' : 'REATIVAR',
          dimensao: params.tipo,
          alvo: nome,
          chave,
          pai: grupo,
          campo: `${def.label} · INATIVO`,
          anterior: params.inativo ? '0' : '1',
          novo: params.inativo ? '1' : '0',
          produtos: impacto.produtos,
        });
      } catch (error) {
        const detalhe = error instanceof Error ? error.message : String(error);
        falhas.push(grupo ? `${nome} / ${grupo}: ${detalhe}` : `${nome}: ${detalhe}`);
      }
    }
  }

  await gravarHistorico(
    lote,
    params.company,
    params.usuario,
    params.obs ?? null,
    params.reverteLote ?? null,
    linhasHistorico
  );

  if (linhasHistorico.length === 0) {
    throw new Error(
      `O banco não confirmou a mudança de ativo/inativo. ${falhas.join(' · ')}. Nada foi registrado.`
    );
  }

  const quantos = linhasHistorico.length;
  const nomes = [...nomesAlterados];
  const alvoTexto =
    nomes.length === 1
      ? `"${nomes[0]}"`
      : `${nomes.length} ${def.label.toLowerCase()}s`;
  const escopoTexto = quantos > 1 ? ` (${quantos} registro(s))` : '';

  const avisos = params.inativo && def.chaveAviso
    ? nomes.flatMap((n) => avisosNomeSensivel(def.chaveAviso!, n))
    : [];
  if (falhas.length > 0) {
    avisos.unshift(`Atenção: ${falhas.length} registro(s) não mudaram — ${falhas.join(' · ')}.`);
  }

  return {
    lote,
    ok: falhas.length === 0,
    produtosAfetados: 0,
    gruposRenomeados: [...new Set(gruposAlterados)],
    mensagem: params.inativo
      ? `${alvoTexto} inativado${escopoTexto}. Os ${produtosTocados} produto(s) que já usam ` +
        'continuam intactos — o inativo só impede escolher esse valor em cadastro novo.'
      : `${alvoTexto} reativado${escopoTexto}.`,
    avisos,
  };
}

/** Cria uma dimensão nova na mestre. INSERT simples: os LXI_* só carimbam data. */
export async function criarDimensao(params: {
  company: CadastroCompany;
  usuario: string;
  tipo: DimensaoTipo;
  nome: string;
  codigo?: string | null;
  pai?: string | null;
  obs?: string | null;
}): Promise<ResultadoDimensao> {
  const def = DIMENSOES[params.tipo];
  if (!def.podeCriar) throw new Error(`Criar ${def.label.toLowerCase()} não é suportado por esta tela.`);

  const nome = limpar(params.nome);
  const pai = limpar(params.pai);
  const codigo = limpar(params.codigo).toUpperCase();

  if (!nome) throw new Error('Informe o nome.');
  if (nome.length > def.maxNome) {
    throw new Error(`O nome tem ${nome.length} caracteres; o limite do Linx é ${def.maxNome}.`);
  }
  if (def.colunaPai && !pai) throw new Error('Informe o grupo ao qual o subgrupo pertence.');
  if (def.codigoObrigatorio && !codigo) throw new Error(`O código é obrigatório para ${def.label.toLowerCase()}.`);
  if (codigo && codigo.length > def.codigoMax) {
    throw new Error(`O código tem ${codigo.length} caracteres; o limite é ${def.codigoMax}.`);
  }

  const impacto = await avaliarImpactoDimensao(params.company, params.tipo, {
    nomeAtual: nome,
    nomeNovo: nome,
    pai,
    codigoNovo: codigo,
  });
  // nomeAtual === nomeNovo faz o avaliador pular a checagem de existência; aqui
  // ela é obrigatória, então conferimos direto.
  const jaExiste = await withRequest(async (request) => {
    request.input('crNome', sql.VarChar, nome);
    const wherePai = def.colunaPai && pai ? `AND d.${def.colunaPai} = @crPai` : '';
    if (def.colunaPai && pai) request.input('crPai', sql.VarChar, pai);
    const r = await request.query<{ n: number }>(`
      SELECT COUNT(*) AS n FROM ${def.tabela} d WITH (NOLOCK)
      WHERE d.${def.colunaNome} = @crNome ${wherePai}
    `);
    return Number(r.recordset[0]?.n ?? 0) > 0;
  });
  if (jaExiste) {
    throw new Error(
      def.colunaPai
        ? `O grupo "${pai}" já tem o subgrupo "${nome}".`
        : `Já existe ${def.label.toLowerCase()} "${nome}".`
    );
  }
  if (impacto.codigoJaExiste) {
    throw new Error(
      `O código "${codigo}" já está em uso${def.colunaPai ? ` no grupo "${pai}"` : ''}. ` +
        'Esse código entra no código do produto (ex.: N4.7P.0100), então precisa ser livre.'
    );
  }

  const lote = novoLoteId();

  await withRequest(async (request) => {
    const colunas: string[] = [def.colunaNome];
    const valores: string[] = ['@crvNome'];
    request.input('crvNome', sql.VarChar, nome);

    if (def.colunaPai && pai) {
      colunas.push(def.colunaPai);
      valores.push('@crvPai');
      request.input('crvPai', sql.VarChar, pai);
    }
    if (def.colunaCodigo && codigo) {
      colunas.push(def.colunaCodigo);
      valores.push('@crvCod');
      request.input('crvCod', sql.VarChar, codigo);
    }
    if (def.temInativo) {
      colunas.push('INATIVO');
      valores.push('0');
    }
    // O sequencial do subgrupo é o contador de código de produto: começa em zero.
    if (params.tipo === 'subgrupo') {
      colunas.push('CODIGO_SEQUENCIAL');
      valores.push(`'0000'`);
    }

    await request.query(`
      INSERT INTO ${def.tabela} (${colunas.join(', ')})
      VALUES (${valores.join(', ')})
    `);
  });

  const confirmado = await withRequest(async (request) => {
    request.input('cfcNome', sql.VarChar, nome);
    const wherePai = def.colunaPai && pai ? `AND d.${def.colunaPai} = @cfcPai` : '';
    if (def.colunaPai && pai) request.input('cfcPai', sql.VarChar, pai);
    const r = await request.query<{ n: number }>(`
      SELECT COUNT(*) AS n FROM ${def.tabela} d WITH (NOLOCK)
      WHERE d.${def.colunaNome} = @cfcNome ${wherePai}
    `);
    return Number(r.recordset[0]?.n ?? 0) > 0;
  });
  if (!confirmado) throw new Error('O banco não confirmou a criação. Nada foi registrado no histórico.');

  await gravarHistorico(lote, params.company, params.usuario, params.obs ?? null, null, [
    {
      escopo: 'DIMENSAO',
      acao: 'CRIAR',
      dimensao: params.tipo,
      alvo: nome,
      chave: nome,
      pai: pai || null,
      campo: `${def.label} · criação`,
      anterior: null,
      novo: codigo ? `${nome} (${codigo})` : nome,
      produtos: 0,
    },
  ]);

  return {
    lote,
    ok: true,
    produtosAfetados: 0,
    gruposRenomeados: pai ? [pai] : [],
    mensagem: `${def.label} "${nome}" criado${codigo ? ` com o código ${codigo}` : ''}${
      pai ? ` no grupo ${pai}` : ''
    }.`,
    avisos: [
      'Criação não tem "desfazer": apagar a mestre arrastaria filhas por CASCADE. ' +
        'Se criou por engano, inative.',
    ],
  };
}

// ═════════════════════════ campos do produto ═════════════════════════

export type TipoCampoProduto = 'texto' | 'dimensao' | 'bool' | 'inteiro' | 'decimal';

/** Fonte de valores válidos quando o campo é validado por FK. */
export type FonteDimensao =
  | DimensaoTipo
  | 'unidade'
  | 'fabricante'
  | 'grade';

export interface CampoProdutoDef {
  campo: string;
  label: string;
  tipo: TipoCampoProduto;
  fonte?: FonteDimensao;
  max?: number;
  /** NOT NULL na tabela: não aceita valor vazio. */
  obrigatorio: boolean;
  /** Aparece na ficha, nunca é gravado. */
  somenteLeitura?: boolean;
  /** Explicação do porquê de ser somente leitura / do risco. */
  nota?: string;
  /** Faz parte do par grupo+subgrupo, validado junto pela FK XFK12602. */
  par?: boolean;
  /** Disponível na alteração em massa. */
  massa: boolean;
}

/**
 * Whitelist de campos alteráveis. Escopo escolhido: comerciais + classificação.
 * Nada de tributação (CLASSIF_FISCAL, TRIBUT_ICMS/ORIGEM, CEST) — errar ali sai
 * em nota fiscal. GRADE fica só leitura: os códigos de barras são POR TAMANHO
 * (PRODUTOS_BARRA.TAMANHO), então trocar a grade de um produto que já tem barras
 * desalinha a grade inteira.
 */
const CAMPOS_PRODUTO: CampoProdutoDef[] = [
  { campo: 'DESC_PRODUTO', label: 'Nome do produto', tipo: 'texto', max: 40, obrigatorio: true, massa: false },
  {
    campo: 'DESC_PROD_NF',
    label: 'Descrição na nota fiscal',
    tipo: 'texto',
    max: 40,
    obrigatorio: true,
    massa: false,
    nota: 'Sai impresso na NF. Confira antes de gravar.',
  },
  { campo: 'GRUPO_PRODUTO', label: 'Grupo', tipo: 'dimensao', fonte: 'grupo', obrigatorio: true, par: true, massa: true },
  { campo: 'SUBGRUPO_PRODUTO', label: 'Subgrupo', tipo: 'dimensao', fonte: 'subgrupo', obrigatorio: true, par: true, massa: true },
  { campo: 'LINHA', label: 'Linha', tipo: 'dimensao', fonte: 'linha', obrigatorio: true, massa: true },
  { campo: 'TIPO_PRODUTO', label: 'Tipo', tipo: 'dimensao', fonte: 'tipo', obrigatorio: true, massa: true },
  { campo: 'GRIFFE', label: 'Griffe', tipo: 'dimensao', fonte: 'griffe', obrigatorio: true, massa: true },
  { campo: 'COLECAO', label: 'Coleção', tipo: 'dimensao', fonte: 'colecao', obrigatorio: true, massa: true },
  { campo: 'UNIDADE', label: 'Unidade', tipo: 'dimensao', fonte: 'unidade', obrigatorio: true, massa: true },
  { campo: 'FABRICANTE', label: 'Fabricante', tipo: 'dimensao', fonte: 'fabricante', obrigatorio: true, massa: true },
  { campo: 'INATIVO', label: 'Inativo', tipo: 'bool', obrigatorio: true, massa: true },
  { campo: 'PESO', label: 'Peso', tipo: 'decimal', obrigatorio: false, massa: true },
  { campo: 'ESTOQUE_MINIMO', label: 'Estoque mínimo', tipo: 'inteiro', obrigatorio: false, massa: true },
  { campo: 'REFER_FABRICANTE', label: 'Referência do fabricante', tipo: 'texto', max: 25, obrigatorio: false, massa: true },
  {
    campo: 'GRADE',
    label: 'Grade',
    tipo: 'dimensao',
    fonte: 'grade',
    obrigatorio: true,
    somenteLeitura: true,
    massa: false,
    nota:
      'Bloqueada de propósito: os códigos de barras são por tamanho (PRODUTOS_BARRA.TAMANHO). ' +
      'Trocar a grade de um produto que já tem barras/estoque desalinha a grade inteira — ' +
      'isso se faz no Linx, item por item.',
  },
];

const MAPA_CAMPOS = new Map(CAMPOS_PRODUTO.map((c) => [c.campo, c] as const));

export function listarCamposProduto(): CampoProdutoDef[] {
  return CAMPOS_PRODUTO.map((c) => ({ ...c }));
}

/** Converte o nome de campo vindo do cliente em definição validada (ou null). */
export function parseCampoProduto(campo: unknown): CampoProdutoDef | null {
  const nome = limpar(campo).toUpperCase();
  const def = MAPA_CAMPOS.get(nome);
  if (!def || def.somenteLeitura) return null;
  return def;
}

// ───────────────────────── leitura de produtos ─────────────────────────

export interface CadastroFiltros {
  company: CadastroCompany;
  codigos?: string[] | null;
  busca?: string | null;
  grupos?: string[] | null;
  subgrupos?: string[] | null;
  linhas?: string[] | null;
  colecoes?: string[] | null;
  tipos?: string[] | null;
  griffes?: string[] | null;
  grades?: string[] | null;
  incluirInativos?: boolean;
  todoCadastro?: boolean;
  limite?: number;
}

export interface CadastroProdutoRow {
  produto: string;
  /** Valores por nome de coluna — o cadastro é texto curto, cabe em objeto. */
  valores: Record<string, string | number | boolean | null>;
}

export interface CadastroProdutosResult {
  rows: CadastroProdutoRow[];
  campos: CampoProdutoDef[];
  total: number;
  truncated: boolean;
  naoEncontrados: string[];
}

/** Aceita código de produto OU código de barras (mesma resolução do precos.ts). */
export async function resolverCodigosOuBarras(entradas: string[]): Promise<{
  produtos: string[];
  naoEncontrados: string[];
}> {
  const limpos = [...new Set(entradas.map(limpar).filter(Boolean))];
  if (limpos.length === 0) return { produtos: [], naoEncontrados: [] };

  const mapa = new Map<string, string>();

  for (const lote of chunk(limpos, CHUNK)) {
    const encontrados = await withRequest(async (request) => {
      const ph = inProdutos(request, lote, 'codProd');
      const r = await request.query<{ produto: string }>(`
        SELECT LTRIM(RTRIM(PRODUTO)) AS produto FROM PRODUTOS WITH (NOLOCK)
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

function selectCampos(): string {
  return CAMPOS_PRODUTO.map((c) => {
    if (c.tipo === 'bool') return `CAST(ISNULL(p.${c.campo}, 0) AS INT) AS [${c.campo}]`;
    if (c.tipo === 'inteiro' || c.tipo === 'decimal') return `p.${c.campo} AS [${c.campo}]`;
    return `LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(200), p.${c.campo}), ''))) AS [${c.campo}]`;
  }).join(',\n          ');
}

function montarValores(row: Record<string, unknown>): CadastroProdutoRow['valores'] {
  const valores: CadastroProdutoRow['valores'] = {};
  for (const campo of CAMPOS_PRODUTO) {
    const bruto = row[campo.campo];
    if (campo.tipo === 'bool') valores[campo.campo] = Number(bruto ?? 0) === 1;
    else if (campo.tipo === 'inteiro' || campo.tipo === 'decimal') valores[campo.campo] = toNumber(bruto);
    else valores[campo.campo] = limpar(bruto);
  }
  return valores;
}

/** Ficha completa de um produto (aba "Alterar Produto"). */
export async function fetchProdutoCadastro(codigo: string): Promise<CadastroProdutoRow | null> {
  const resolucao = await resolverCodigosOuBarras([codigo]);
  const produto = resolucao.produtos[0];
  if (!produto) return null;

  return withRequest(async (request) => {
    request.input('fichaProd', sql.VarChar, produto);
    const r = await request.query<Record<string, unknown>>(`
      SELECT LTRIM(RTRIM(p.PRODUTO)) AS PRODUTO,
          ${selectCampos()}
      FROM PRODUTOS p WITH (NOLOCK)
      WHERE p.PRODUTO = @fichaProd
    `);
    const row = r.recordset[0];
    if (!row) return null;
    return { produto: limpar(row.PRODUTO), valores: montarValores(row) };
  });
}

/** Lista para a tela de massa: mesmos filtros abertos da Alterar Custo / Preço. */
export async function fetchProdutosCadastro(
  filtros: CadastroFiltros
): Promise<CadastroProdutosResult> {
  const limite = Math.min(
    filtros.limite && filtros.limite > 0 ? filtros.limite : LIMITE_PRODUTOS,
    LIMITE_PRODUTOS
  );

  let produtosExplicitos: string[] | null = null;
  let naoEncontrados: string[] = [];
  const codigos = (filtros.codigos ?? []).map(limpar).filter(Boolean);
  if (codigos.length > 0) {
    const resolucao = await resolverCodigosOuBarras(codigos);
    produtosExplicitos = resolucao.produtos;
    naoEncontrados = resolucao.naoEncontrados;
    if (produtosExplicitos.length === 0) {
      return { rows: [], campos: listarCamposProduto(), total: 0, truncated: false, naoEncontrados };
    }
  }

  const base = await withRequest(async (request) => {
    const where: string[] = [];

    if (produtosExplicitos) {
      const ph = inProdutos(request, produtosExplicitos.slice(0, LIMITE_PRODUTOS), 'filtProd');
      where.push(`AND p.PRODUTO IN (${ph})`);
    } else {
      where.push(filtroEmpresa(request, filtros.company, !!filtros.todoCadastro));
      where.push(filtroLista(request, filtros.grupos, 'p.GRUPO_PRODUTO', 'filtGrupo'));
      where.push(filtroLista(request, filtros.subgrupos, 'p.SUBGRUPO_PRODUTO', 'filtSub'));
      where.push(filtroLista(request, filtros.linhas, 'p.LINHA', 'filtLinha'));
      where.push(filtroLista(request, filtros.colecoes, 'p.COLECAO', 'filtColecao'));
      where.push(filtroLista(request, filtros.tipos, 'p.TIPO_PRODUTO', 'filtTipo'));
      where.push(filtroLista(request, filtros.griffes, 'p.GRIFFE', 'filtGriffe'));
      where.push(filtroLista(request, filtros.grades, 'CONVERT(VARCHAR(50), p.GRADE)', 'filtGrade'));

      const busca = limpar(filtros.busca);
      if (busca.length >= 2) {
        request.input('filtBusca', sql.VarChar, `%${busca}%`);
        where.push('AND (p.DESC_PRODUTO LIKE @filtBusca OR p.PRODUTO LIKE @filtBusca)');
      }
    }

    if (!filtros.incluirInativos) where.push('AND ISNULL(p.INATIVO, 0) = 0');

    const r = await request.query<Record<string, unknown>>(`
      WITH filtrados AS (
        SELECT
          LTRIM(RTRIM(p.PRODUTO)) AS PRODUTO,
          ${selectCampos()}
        FROM PRODUTOS p WITH (NOLOCK)
        WHERE 1 = 1
        ${where.filter(Boolean).join('\n        ')}
      )
      SELECT TOP ${limite + 1} *, (SELECT COUNT(*) FROM filtrados) AS TOTAL_FILTRADO
      FROM filtrados
      ORDER BY PRODUTO
    `);
    return r.recordset;
  });

  const total = base.length > 0 ? Number(base[0].TOTAL_FILTRADO ?? base.length) : 0;
  const truncated = base.length > limite;
  const usados = truncated ? base.slice(0, limite) : base;

  return {
    rows: usados.map((row) => ({ produto: limpar(row.PRODUTO), valores: montarValores(row) })),
    campos: listarCamposProduto(),
    total,
    truncated,
    naoEncontrados,
  };
}

// ───────────────────── valores válidos das dimensões ─────────────────────

export interface OpcoesDimensoes {
  grupos: string[];
  /** Subgrupos por grupo — o par (grupo, subgrupo) é validado pela FK. */
  subgruposPorGrupo: Record<string, string[]>;
  linhas: string[];
  tipos: string[];
  griffes: string[];
  colecoes: Array<{ value: string; label: string }>;
  unidades: string[];
  grades: string[];
}

/**
 * Valores aceitos em cada campo de dimensão, lidos das MESTRES (não das vendas
 * nem de DISTINCT em PRODUTOS): é a mestre que a FK valida. Sem isso a tela
 * ofereceria valor que o banco recusa.
 */
export async function fetchOpcoesDimensoes(
  opts: { incluirInativos?: boolean } = {}
): Promise<OpcoesDimensoes> {
  const inativos = opts.incluirInativos ? '' : 'WHERE ISNULL(INATIVO, 0) = 0';

  return withRequest(async (request) => {
    const r = await request.query<{ dim: string; valor: string; extra: string }>(`
      SELECT 'GRUPO' AS dim, LTRIM(RTRIM(GRUPO_PRODUTO)) AS valor, '' AS extra
      FROM PRODUTOS_GRUPO WITH (NOLOCK) ${inativos}
      UNION ALL
      SELECT 'SUBGRUPO', LTRIM(RTRIM(SUBGRUPO_PRODUTO)), LTRIM(RTRIM(GRUPO_PRODUTO))
      FROM PRODUTOS_SUBGRUPO WITH (NOLOCK) ${inativos}
      UNION ALL
      SELECT 'LINHA', LTRIM(RTRIM(LINHA)), '' FROM PRODUTOS_LINHAS WITH (NOLOCK) ${inativos}
      UNION ALL
      SELECT 'TIPO', LTRIM(RTRIM(TIPO_PRODUTO)), '' FROM PRODUTOS_TIPOS WITH (NOLOCK) ${inativos}
      UNION ALL
      SELECT 'GRIFFE', LTRIM(RTRIM(GRIFFE)), '' FROM PRODUTOS_GRIFFES WITH (NOLOCK) ${inativos}
      UNION ALL
      SELECT 'COLECAO', LTRIM(RTRIM(COLECAO)), LTRIM(RTRIM(ISNULL(DESC_COLECAO, '')))
      FROM COLECOES WITH (NOLOCK) ${inativos}
      UNION ALL
      SELECT 'UNIDADE', LTRIM(RTRIM(UNIDADE)), '' FROM UNIDADES WITH (NOLOCK)
      UNION ALL
      SELECT 'GRADE', LTRIM(RTRIM(GRADE)), '' FROM PRODUTOS_TAMANHOS WITH (NOLOCK)
    `);

    const grupos: string[] = [];
    const subgruposPorGrupo: Record<string, string[]> = {};
    const linhas: string[] = [];
    const tipos: string[] = [];
    const griffes: string[] = [];
    const colecoes: Array<{ value: string; label: string }> = [];
    const unidades: string[] = [];
    const grades: string[] = [];

    for (const row of r.recordset) {
      const valor = limpar(row.valor);
      if (!valor) continue;
      switch (row.dim) {
        case 'GRUPO':
          grupos.push(valor);
          break;
        case 'SUBGRUPO': {
          const grupo = limpar(row.extra);
          if (!grupo) break;
          (subgruposPorGrupo[grupo] ??= []).push(valor);
          break;
        }
        case 'LINHA':
          linhas.push(valor);
          break;
        case 'TIPO':
          tipos.push(valor);
          break;
        case 'GRIFFE':
          griffes.push(valor);
          break;
        case 'COLECAO': {
          const desc = limpar(row.extra);
          colecoes.push({ value: valor, label: desc ? `${desc} (${valor})` : valor });
          break;
        }
        case 'UNIDADE':
          unidades.push(valor);
          break;
        case 'GRADE':
          grades.push(valor);
          break;
      }
    }

    const ordenar = (v: string[]) => [...new Set(v)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    for (const grupo of Object.keys(subgruposPorGrupo)) {
      subgruposPorGrupo[grupo] = ordenar(subgruposPorGrupo[grupo]);
    }

    return {
      grupos: ordenar(grupos),
      subgruposPorGrupo,
      linhas: ordenar(linhas),
      tipos: ordenar(tipos),
      griffes: ordenar(griffes),
      colecoes: colecoes.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
      unidades: ordenar(unidades),
      grades: ordenar(grades),
    };
  });
}

// ═════════════════════ execução: campos do produto ═════════════════════

export interface AlteracaoProdutoInput {
  produto: string;
  campo: string;
  /** Texto para dimensão/texto, número para numérico, boolean para bit. */
  valor: string | number | boolean | null;
}

export interface ResumoCampoProduto {
  campo: string;
  label: string;
  aplicados: number;
  semMudanca: number;
  naoConfirmados: number;
  invalidos: number;
}

export interface ResultadoProdutos {
  lote: string;
  aplicados: number;
  semMudanca: number;
  naoConfirmados: number;
  invalidos: number;
  porCampo: ResumoCampoProduto[];
  erros: string[];
}

/** Normaliza o valor recebido conforme o tipo da coluna. */
function normalizarValor(
  def: CampoProdutoDef,
  valor: unknown
): { ok: true; valor: string | number | boolean | null } | { ok: false; erro: string } {
  if (def.tipo === 'bool') {
    if (typeof valor === 'boolean') return { ok: true, valor };
    const texto = limpar(valor).toLowerCase();
    if (['1', 'true', 'sim', 's'].includes(texto)) return { ok: true, valor: true };
    if (['0', 'false', 'nao', 'não', 'n'].includes(texto)) return { ok: true, valor: false };
    return { ok: false, erro: `${def.label}: use sim/não.` };
  }

  if (def.tipo === 'inteiro' || def.tipo === 'decimal') {
    if (valor === null || limpar(valor) === '') {
      if (def.obrigatorio) return { ok: false, erro: `${def.label} não aceita vazio.` };
      return { ok: true, valor: null };
    }
    const texto = limpar(valor).replace(/\./g, '').replace(',', '.');
    const n = Number(texto);
    if (!Number.isFinite(n) || n < 0) return { ok: false, erro: `${def.label}: valor numérico inválido.` };
    return { ok: true, valor: def.tipo === 'inteiro' ? Math.round(n) : n };
  }

  const texto = limpar(valor);
  if (!texto) {
    if (def.obrigatorio) return { ok: false, erro: `${def.label} não aceita vazio (NOT NULL no Linx).` };
    return { ok: true, valor: '' };
  }
  if (def.max && texto.length > def.max) {
    return { ok: false, erro: `${def.label}: ${texto.length} caracteres (limite ${def.max}).` };
  }
  return { ok: true, valor: texto };
}

/**
 * Valida os valores de dimensão contra as mestres ANTES de gravar. Sem isso o
 * usuário receberia um erro cru de FK; com isso ele recebe "esse subgrupo não
 * existe nesse grupo", que é o problema de verdade.
 */
async function validarDimensoes(
  itens: Array<{ produto: string; def: CampoProdutoDef; valor: string | number | boolean | null }>,
  valoresAtuais: Map<string, Record<string, string | number | boolean | null>>
): Promise<{ erros: string[]; invalidos: Set<string> }> {
  const erros: string[] = [];
  const invalidos = new Set<string>();
  const opcoes = await fetchOpcoesDimensoes({ incluirInativos: true });

  const setDe = (fonte: FonteDimensao): Set<string> | null => {
    switch (fonte) {
      case 'grupo': return new Set(opcoes.grupos.map((v) => v.toUpperCase()));
      case 'linha': return new Set(opcoes.linhas.map((v) => v.toUpperCase()));
      case 'tipo': return new Set(opcoes.tipos.map((v) => v.toUpperCase()));
      case 'griffe': return new Set(opcoes.griffes.map((v) => v.toUpperCase()));
      case 'colecao': return new Set(opcoes.colecoes.map((c) => c.value.toUpperCase()));
      case 'unidade': return new Set(opcoes.unidades.map((v) => v.toUpperCase()));
      case 'grade': return new Set(opcoes.grades.map((v) => v.toUpperCase()));
      default: return null;
    }
  };

  // Pares grupo+subgrupo resultantes: o valor final pode vir da alteração OU do
  // que o produto já tem (mudar só o grupo mantém o subgrupo antigo, que talvez
  // não exista no grupo novo — é justamente o erro que a FK XFK12602 pegaria).
  const paresPorProduto = new Map<string, { grupo: string; subgrupo: string }>();
  for (const item of itens) {
    if (item.def.campo !== 'GRUPO_PRODUTO' && item.def.campo !== 'SUBGRUPO_PRODUTO') continue;
    const atual = valoresAtuais.get(item.produto) ?? {};
    const par = paresPorProduto.get(item.produto) ?? {
      grupo: limpar(atual.GRUPO_PRODUTO),
      subgrupo: limpar(atual.SUBGRUPO_PRODUTO),
    };
    if (item.def.campo === 'GRUPO_PRODUTO') par.grupo = limpar(item.valor);
    else par.subgrupo = limpar(item.valor);
    paresPorProduto.set(item.produto, par);
  }

  for (const [produto, par] of paresPorProduto) {
    const disponiveis = opcoes.subgruposPorGrupo[par.grupo] ?? [];
    const existe = disponiveis.some((s) => s.toUpperCase() === par.subgrupo.toUpperCase());
    if (!existe) {
      // A mensagem tem de explicar que o problema é o PAR, senão quem pediu para
      // trocar o GRUPO lê "subgrupo" e acha que a tela mexeu no campo errado.
      erros.push(
        `${produto}: o par "${par.grupo} / ${par.subgrupo}" não existe no cadastro. ` +
          'No Linx o subgrupo pertence ao grupo, então mover de grupo exige escolher também um ' +
          `subgrupo que exista no destino — ou criar "${par.subgrupo}" em "${par.grupo}" na aba Dimensões.`
      );
      invalidos.add(`${produto}||GRUPO_PRODUTO`);
      invalidos.add(`${produto}||SUBGRUPO_PRODUTO`);
    }
  }

  for (const item of itens) {
    if (item.def.tipo !== 'dimensao' || !item.def.fonte) continue;
    if (item.def.par) continue; // já validado como par
    const permitidos = setDe(item.def.fonte);
    if (!permitidos) continue;
    const valor = limpar(item.valor).toUpperCase();
    if (!permitidos.has(valor)) {
      erros.push(`${item.produto}: "${limpar(item.valor)}" não existe no cadastro de ${item.def.label}.`);
      invalidos.add(`${item.produto}||${item.def.campo}`);
    }
  }

  // FABRICANTE valida contra FORNECEDORES (muito grande para trazer inteiro).
  const fabricantes = [
    ...new Set(
      itens.filter((i) => i.def.campo === 'FABRICANTE').map((i) => limpar(i.valor)).filter(Boolean)
    ),
  ];
  if (fabricantes.length > 0) {
    const existentes = await withRequest(async (request) => {
      fabricantes.forEach((f, i) => request.input(`fab${i}`, sql.VarChar, f));
      const ph = fabricantes.map((_, i) => `@fab${i}`).join(', ');
      const r = await request.query<{ fornecedor: string }>(`
        SELECT LTRIM(RTRIM(FORNECEDOR)) AS fornecedor FROM FORNECEDORES WITH (NOLOCK)
        WHERE FORNECEDOR IN (${ph})
      `);
      return new Set(r.recordset.map((row) => limpar(row.fornecedor).toUpperCase()));
    });
    for (const item of itens) {
      if (item.def.campo !== 'FABRICANTE') continue;
      if (!existentes.has(limpar(item.valor).toUpperCase())) {
        erros.push(`${item.produto}: fabricante "${limpar(item.valor)}" não existe em FORNECEDORES.`);
        invalidos.add(`${item.produto}||FABRICANTE`);
      }
    }
  }

  return { erros, invalidos };
}

async function carregarValoresProduto(
  produtos: string[]
): Promise<Map<string, Record<string, string | number | boolean | null>>> {
  const mapa = new Map<string, Record<string, string | number | boolean | null>>();
  for (const lote of chunk(produtos, CHUNK)) {
    const rows = await withRequest(async (request) => {
      const ph = inProdutos(request, lote, 'lerProd');
      const r = await request.query<Record<string, unknown>>(`
        SELECT LTRIM(RTRIM(p.PRODUTO)) AS PRODUTO,
            ${selectCampos()}
        FROM PRODUTOS p WITH (NOLOCK)
        WHERE p.PRODUTO IN (${ph})
      `);
      return r.recordset;
    });
    for (const row of rows) mapa.set(limpar(row.PRODUTO), montarValores(row));
  }
  return mapa;
}

function mesmoValor(
  def: CampoProdutoDef,
  atual: string | number | boolean | null,
  novo: string | number | boolean | null
): boolean {
  if (def.tipo === 'bool') return Boolean(atual) === Boolean(novo);
  if (def.tipo === 'inteiro' || def.tipo === 'decimal') {
    const a = atual === null ? null : Number(atual);
    const b = novo === null ? null : Number(novo);
    if (a === null || b === null) return a === b;
    return Math.abs(a - b) < 0.0005;
  }
  return limpar(atual) === limpar(novo);
}

/** UPDATE em lote de uma coluna, com os valores vindo de um VALUES. */
async function aplicarUpdateProduto(
  def: CampoProdutoDef,
  itens: Array<{ produto: string; valor: string | number | boolean | null }>
): Promise<void> {
  for (const lote of chunk(itens, CHUNK)) {
    await withRequest(async (request) => {
      const values = lote.map((item, i) => {
        request.input(`up${i}`, sql.VarChar, item.produto);
        if (def.tipo === 'bool') {
          request.input(`uv${i}`, sql.VarChar, item.valor ? '1' : '0');
        } else if (def.tipo === 'inteiro' || def.tipo === 'decimal') {
          request.input(`uv${i}`, sql.VarChar, item.valor === null ? null : String(Number(item.valor)));
        } else {
          request.input(`uv${i}`, sql.VarChar, limpar(item.valor));
        }
        return `(@up${i}, @uv${i})`;
      });

      const cast =
        def.tipo === 'bool'
          ? 'CAST(v.VAL AS BIT)'
          : def.tipo === 'inteiro'
            ? 'CAST(v.VAL AS INT)'
            : def.tipo === 'decimal'
              ? 'CAST(v.VAL AS NUMERIC(14,4))'
              : `CAST(v.VAL AS VARCHAR(${def.max ?? 200}))`;

      await request.query(`
        UPDATE p
        SET p.${def.campo} = ${cast}
        FROM PRODUTOS p
        INNER JOIN (VALUES ${values.join(', ')}) AS v(PRODUTO, VAL)
          ON p.PRODUTO = v.PRODUTO
      `);
    });
  }
}

/**
 * Aplica alterações de campo do produto. Mesmo fluxo do precos.ts: ler → alterar
 * → RELER para confirmar → histórico. Só entra no histórico o que o banco
 * confirmou; os triggers de ETL do Linx ficam ligados de propósito (é o que
 * mantém o resto do ERP em sincronia).
 */
export async function executarAlteracaoCadastro(params: {
  company: CadastroCompany;
  usuario: string;
  alteracoes: AlteracaoProdutoInput[];
  obs?: string | null;
  reverteLote?: string | null;
}): Promise<ResultadoProdutos> {
  const erros: string[] = [];
  const itens: Array<{ produto: string; def: CampoProdutoDef; valor: string | number | boolean | null }> = [];

  for (const alteracao of params.alteracoes) {
    const produto = limpar(alteracao.produto);
    const def = parseCampoProduto(alteracao.campo);
    if (!produto || !def) {
      erros.push(`Alteração ignorada: campo "${limpar(alteracao.campo)}" não é alterável.`);
      continue;
    }
    const normalizado = normalizarValor(def, alteracao.valor);
    if (!normalizado.ok) {
      erros.push(`${produto}: ${normalizado.erro}`);
      continue;
    }
    itens.push({ produto, def, valor: normalizado.valor });
  }

  if (itens.length === 0) {
    return { lote: '', aplicados: 0, semMudanca: 0, naoConfirmados: 0, invalidos: 0, porCampo: [], erros };
  }
  if (itens.length > LIMITE_ALTERACOES) {
    throw new Error(
      `São ${itens.length} alterações (limite ${LIMITE_ALTERACOES}). Reduza a seleção e execute em partes.`
    );
  }

  const produtos = [...new Set(itens.map((i) => i.produto))];
  const antes = await carregarValoresProduto(produtos);

  for (const produto of produtos) {
    if (!antes.has(produto)) erros.push(`${produto}: não encontrado no cadastro.`);
  }

  const validacao = await validarDimensoes(itens, antes);
  erros.push(...validacao.erros);

  const lote = novoLoteId();
  const resumo: ResumoCampoProduto[] = [];
  const paraHistorico: LinhaHistoricoInput[] = [];

  // Um bloco por coluna: agrupar deixa o UPDATE em lote e a releitura baratos.
  const porCampo = new Map<string, { def: CampoProdutoDef; itens: typeof itens }>();
  for (const item of itens) {
    const bucket = porCampo.get(item.def.campo);
    if (bucket) bucket.itens.push(item);
    else porCampo.set(item.def.campo, { def: item.def, itens: [item] });
  }

  for (const { def, itens: itensCampo } of porCampo.values()) {
    const aAlterar: Array<{
      produto: string;
      valor: string | number | boolean | null;
      anterior: string | number | boolean | null;
    }> = [];
    let semMudanca = 0;
    let invalidos = 0;

    for (const item of itensCampo) {
      if (validacao.invalidos.has(`${item.produto}||${def.campo}`)) {
        invalidos += 1;
        continue;
      }
      const atuais = antes.get(item.produto);
      if (!atuais) {
        invalidos += 1;
        continue;
      }
      const atual = atuais[def.campo] ?? null;
      if (mesmoValor(def, atual, item.valor)) {
        semMudanca += 1;
        continue;
      }
      aAlterar.push({ produto: item.produto, valor: item.valor, anterior: atual });
    }

    let aplicados = 0;
    let naoConfirmados = 0;

    if (aAlterar.length > 0) {
      try {
        await aplicarUpdateProduto(def, aAlterar.map((i) => ({ produto: i.produto, valor: i.valor })));

        const depois = await carregarValoresProduto(aAlterar.map((i) => i.produto));
        for (const item of aAlterar) {
          const atual = depois.get(item.produto)?.[def.campo] ?? null;
          if (mesmoValor(def, atual, item.valor)) {
            aplicados += 1;
            paraHistorico.push({
              escopo: 'PRODUTO',
              acao: 'CAMPO',
              dimensao: null,
              alvo: item.produto,
              chave: item.produto,
              pai: null,
              campo: def.campo,
              anterior: item.anterior === null ? null : String(item.anterior),
              novo: item.valor === null ? null : String(item.valor),
              produtos: null,
            });
          } else {
            naoConfirmados += 1;
          }
        }
      } catch (error) {
        naoConfirmados += aAlterar.length;
        const detalhe = error instanceof Error ? error.message : String(error);
        erros.push(`Falha ao alterar ${def.label}: ${detalhe}`);
      }
    }

    resumo.push({ campo: def.campo, label: def.label, aplicados, semMudanca, naoConfirmados, invalidos });
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
    aplicados: resumo.reduce((a, r) => a + r.aplicados, 0),
    semMudanca: resumo.reduce((a, r) => a + r.semMudanca, 0),
    naoConfirmados: resumo.reduce((a, r) => a + r.naoConfirmados, 0),
    invalidos: resumo.reduce((a, r) => a + r.invalidos, 0),
    porCampo: resumo,
    erros,
  };
}

// ═════════════════════════════ estorno ═════════════════════════════

export interface ResultadoEstorno {
  lote: string;
  mensagem: string;
  avisos: string[];
}

/**
 * Desfaz um lote. Nada é apagado: o estorno é um lote NOVO marcado com
 * REVERTE_LOTE, igual ao "desfazer" do Ajuste de Estoque e do Alterar Preço.
 */
export async function reverterLoteCadastro(
  lote: string,
  company: CadastroCompany,
  usuario: string
): Promise<ResultadoEstorno> {
  const linhas = await fetchHistoricoLinhas(lote);
  if (linhas.length === 0) throw new Error('Lote não encontrado no histórico.');
  if (linhas.some((l) => l.empresa !== company)) throw new Error('Este lote pertence a outra empresa.');

  const jaRevertido = await withRequest(async (request) => {
    request.input('revLote', sql.VarChar, limpar(lote));
    const r = await request.query<{ lote: string }>(`
      SELECT TOP 1 LOTE AS lote FROM ${TABELA_HISTORICO} WITH (NOLOCK) WHERE REVERTE_LOTE = @revLote
    `);
    return r.recordset[0]?.lote ?? null;
  });
  if (jaRevertido) throw new Error(`Este lote já foi desfeito pelo lote ${limpar(jaRevertido)}.`);

  const primeira = linhas[0];

  if (primeira.escopo === 'DIMENSAO') {
    if (primeira.acao === 'CRIAR') {
      throw new Error(
        'Lote de criação não tem estorno: apagar a mestre arrastaria as filhas por CASCADE. ' +
          'Para tirar de uso, inative a dimensão.'
      );
    }
    if (!primeira.dimensao) throw new Error('Lote de dimensão sem tipo registrado.');

    /**
     * Um rename global de subgrupo grava UMA LINHA POR GRUPO no mesmo lote. O
     * estorno tem de desfazer exatamente esses pares — nem menos (deixaria metade
     * renomeada) nem mais (um grupo que já tinha o nome de destino antes do lote
     * não faz parte dele).
     */
    const gruposDoLote = [
      ...new Set(linhas.map((l) => l.pai).filter((p): p is string => Boolean(p))),
    ];

    if (primeira.acao === 'RENOMEAR') {
      const resultado = await renomearDimensao({
        company,
        usuario,
        tipo: primeira.dimensao,
        nomeAtual: primeira.valorNovo ?? primeira.alvo,
        nomeNovo: primeira.valorAnterior ?? '',
        pai: null,
        chave: primeira.chave,
        grupos: gruposDoLote.length > 0 ? gruposDoLote : null,
        obs: `Estorno do lote ${limpar(lote)}`,
        reverteLote: limpar(lote),
      });
      return { lote: resultado.lote, mensagem: resultado.mensagem, avisos: resultado.avisos };
    }

    /**
     * O lote pode ter vários nomes (inativar em massa). Reconstrói um alvo por
     * nome, cada um com os grupos que realmente entraram — reverter "todos os
     * grupos do nome" pegaria registros que não faziam parte do lote.
     */
    const porNome = new Map<string, { nome: string; chave: string | null; grupos: string[] }>();
    for (const linha of linhas) {
      const atual = porNome.get(linha.alvo) ?? {
        nome: linha.alvo,
        chave: linha.chave,
        grupos: [],
      };
      if (linha.pai) atual.grupos.push(linha.pai);
      porNome.set(linha.alvo, atual);
    }

    const resultado = await alternarInativoDimensao({
      company,
      usuario,
      tipo: primeira.dimensao,
      alvos: [...porNome.values()].map((a) => ({
        nome: a.nome,
        chave: a.chave,
        grupos: a.grupos.length > 0 ? a.grupos : null,
      })),
      inativo: primeira.acao !== 'INATIVAR',
      obs: `Estorno do lote ${limpar(lote)}`,
      reverteLote: limpar(lote),
    });
    return { lote: resultado.lote, mensagem: resultado.mensagem, avisos: resultado.avisos };
  }

  // Produto: devolve cada campo ao valor anterior.
  const alteracoes: AlteracaoProdutoInput[] = linhas
    .filter((l) => parseCampoProduto(l.campo) !== null)
    .map((l) => ({ produto: l.alvo, campo: l.campo, valor: l.valorAnterior }));

  if (alteracoes.length === 0) throw new Error('Não há alterações reversíveis neste lote.');

  const resultado = await executarAlteracaoCadastro({
    company,
    usuario,
    alteracoes,
    obs: `Estorno do lote ${limpar(lote)}`,
    reverteLote: limpar(lote),
  });

  return {
    lote: resultado.lote,
    mensagem: `${resultado.aplicados} campo(s) devolvido(s) ao valor anterior.`,
    avisos: resultado.erros,
  };
}
