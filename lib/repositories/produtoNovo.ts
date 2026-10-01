import 'server-only';

/**
 * Cadastro de PRODUTO NOVO no Linx — o mesmo processo da tela 002006SPK
 * (Produtos Acabados) do ERP, feito pelo dashboard numa tela de cadastro rápido.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COMO O LINX FAZ (levantado no banco de produção em 01/10/2026, não deduzido)
 * ─────────────────────────────────────────────────────────────────────────────
 * Nenhuma procedure cria produto: quem grava é o cliente do ERP. A ordem real,
 * lida pelos DATA_PARA_TRANSFERENCIA do N4.8M.0018 (cadastrado em 30/09/2026):
 *
 *  1. `PRODUTOS` — a ficha (abas Dados 1, Dados 2 e Complementos). O código é
 *     `CODIGO_GRUPO.CODIGO_SUBGRUPO.SEQUENCIAL` (N4.8M.0018), e o sequencial é
 *     `PRODUTOS_SUBGRUPO.CODIGO_SEQUENCIAL` + 1 com 4 dígitos — o ERP grava o
 *     número novo de volta no subgrupo. Confere em 100% dos subgrupos NERD que
 *     receberam produto desde jul/2026. Os triggers de PRODUTOS só validam FK
 *     (com mensagem ilegível: "#PRODUTOS #porque #X #não existe"), chamam
 *     LX_GIV_AGRUPAMENTO_PRODUTO e enfileiram o ETL das lojas — então validamos
 *     antes, com nome, e deixamos o resto com eles.
 *  2. `PRODUTO_CORES` + `PRODUTOS_BARRA` — aba Cores e aba Código de Barras.
 *     Mesma regra de "adicionar cor" (`produtoCores.ts`), inclusive o MESMO
 *     fragmento SQL de geração de interno + EAN-13: não existem duas versões.
 *  3. `PRODUTOS_PRECOS` — aba Tabela de Preços. Só DUAS tabelas são digitadas:
 *     a padrão (PARAMETROS.TABELA_PRECO_PADRAO = 01, preço de venda) e a de custo
 *     (PARAMETROS.TABELA_PRECO_CUSTO = 06). O trigger LXI_PRODUTOS_PRECOS faz o
 *     resto: cria as tabelas FILHAS pelo % da base (01 → 09, 12, 14, 99, ND → 66;
 *     06 → 97, 98), grava o custo em PRODUTOS.CUSTO_REPOSICAO1 e o preço em
 *     PRECO_REPOSICAO_1, e copia os dois para cada cor (por isso as cores vêm
 *     ANTES do preço). Os 175 produtos NERD criados desde jun/2026 têm
 *     exatamente esse conjunto de tabelas, e nenhum tem 15/16/17.
 *     Uma tabela POR STATEMENT — a armadilha do DISTINCT do trigger está
 *     descrita em `produtoCores.ts`.
 *
 * Os campos técnicos (contas contábeis, fatores, versão de ficha, flags de
 * envio…) são os que o ERP grava num produto novo, conferidos coluna a coluna
 * contra o N4.8M.0018 e contra a moda dos 416 produtos NERD do último ano. Os
 * campos de classificação (tipo, coleção, fabricante, categoria, NCM…) vêm
 * pré-preenchidos com o valor MAIS USADO no grupo escolhido, e são editáveis.
 *
 * Tudo roda num ÚNICO batch, em transação: ou o produto nasce inteiro (ficha +
 * cores + códigos + preços), ou nada fica gravado. `ensaio` roda o mesmo batch
 * e desfaz no fim — serve para validar contra o banco real sem gravar.
 */

import sql from 'mssql';

import { withRequest } from '@/lib/db/connection';
import {
  fetchOpcoesDimensoes,
  registrarHistoricoCadastro,
  type LinhaHistoricoCadastro,
  type OpcoesDimensoes,
} from '@/lib/repositories/cadastro';
import {
  fetchCatalogoCoresEmpresa,
  fetchPreviaSequenciais,
  SQL_DECLARAR_PAR_DE_CODIGOS,
  SQL_GRAVAR_PAR_DE_CODIGOS,
  type CorCatalogo,
} from '@/lib/repositories/produtoCores';

export type ProdutoNovoCompany = 'nerd' | 'scarfme';

/** PRODUTOS.EMPRESA por empresa do dashboard — mesmo mapa de cadastro.ts/precos.ts. */
const EMPRESA_CODES: Record<ProdutoNovoCompany, number[]> = {
  nerd: [8],
  scarfme: [1, 10, 13, 15, 16],
};

/** Janela usada para descobrir os valores que se repetem no cadastro. */
const MESES_PADRAO = 24;

const MAX_CORES = 40;
const MAX_TAMANHOS = 48;

/** Tabela do SPED (registro 0200, campo TIPO_ITEM). Não existe mestre no Linx. */
const ITENS_SPED: Array<{ codigo: string; nome: string }> = [
  { codigo: '00', nome: 'MERCADORIA PARA REVENDA' },
  { codigo: '01', nome: 'MATÉRIA-PRIMA' },
  { codigo: '02', nome: 'EMBALAGEM' },
  { codigo: '03', nome: 'PRODUTO EM PROCESSO' },
  { codigo: '04', nome: 'PRODUTO ACABADO' },
  { codigo: '05', nome: 'SUBPRODUTO' },
  { codigo: '06', nome: 'PRODUTO INTERMEDIÁRIO' },
  { codigo: '07', nome: 'MATERIAL DE USO E CONSUMO' },
  { codigo: '08', nome: 'ATIVO IMOBILIZADO' },
  { codigo: '09', nome: 'SERVIÇOS' },
  { codigo: '10', nome: 'OUTROS INSUMOS' },
  { codigo: '99', nome: 'OUTRAS' },
];

function limpar(value: unknown): string {
  return String(value ?? '').trim();
}

/** Caixa alta + espaço simples: o Linx guarda em maiúsculas e espaço duplo quebra busca. */
export function normalizarNome(value: unknown): string {
  return limpar(value).replace(/\s+/g, ' ').toUpperCase();
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** "198,00" / "198.00" / 198 → "198.00"; inválido → null. */
function parseDinheiro(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : null;
  const txt = limpar(value).replace(/\s|R\$/gi, '');
  if (!txt) return null;
  const normal = txt.includes(',') ? txt.replace(/\./g, '').replace(',', '.') : txt;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  return Number(normal).toFixed(2);
}

/* ═══════════════════════════ campos da ficha ═══════════════════════════ */

export interface CamposProdutoNovo {
  grupo: string;
  subgrupo: string;
  descProduto: string;
  /** Descrição fiscal (aba Dados 2) — sai na NF. Vazio = igual ao nome. */
  descProdNf: string;
  tipo: string;
  colecao: string;
  griffe: string;
  linha: string;
  fabricante: string;
  grade: string;
  unidade: string;
  /** '' = sem categoria. Categoria e subcategoria andam juntas (FK composta). */
  categoria: string;
  subcategoria: string;
  status: string;
  referFabricante: string;
  empresa: number | null;
  classifFiscal: string;
  idCestNcm: number | null;
  tributOrigem: string;
  tributIcms: string;
  indicadorCfop: number | null;
  tipoItemSped: string;
  contaContabil: string;
  periodoPcp: string;
  enviaLojaVarejo: boolean;
  enviaLojaAtacado: boolean;
}

/** Campos que recebem valor padrão (tudo menos grupo, subgrupo, nomes e referência). */
export type CampoPadrao = Exclude<
  keyof CamposProdutoNovo,
  'grupo' | 'subgrupo' | 'descProduto' | 'descProdNf' | 'referFabricante'
>;

export interface ValorPadrao {
  valor: string;
  usos: number;
  total: number;
}

export type PadraoCampos = Partial<Record<CampoPadrao, ValorPadrao>>;

/**
 * Último recurso, quando a empresa não cadastrou nada na janela: os valores do
 * produto novo do ERP (N4.8M.0018) que não dependem do que o produto é.
 */
const PADRAO_FIXO: Partial<Record<CampoPadrao, string>> = {
  grade: 'UNICO',
  unidade: 'PC',
  status: '01',
  tributOrigem: '0',
  tributIcms: '00',
  indicadorCfop: '11',
  tipoItemSped: '04',
  contaContabil: '11401',
  periodoPcp: 'PADRAO',
  enviaLojaVarejo: '1',
  enviaLojaAtacado: '1',
};

/* ═══════════════════════════ opções da tela ═══════════════════════════ */

export interface OpcaoSimples {
  codigo: string;
  nome: string;
  usos?: number;
}

export interface CategoriaOpcao {
  codigo: string;
  nome: string;
  usos: number;
  subcategorias: Array<{ codigo: string; nome: string; usos: number }>;
}

export interface CestOpcao {
  id: number;
  ncm: string;
  cest: string;
  descricao: string;
}

export interface TabelaPrecoResumo {
  codigo: string;
  nome: string;
  /** Tabelas que o trigger do Linx cria a partir desta, com o % acumulado. */
  filhas: Array<{ codigo: string; nome: string; pct: number; inativa: boolean }>;
}

export interface OpcoesProdutoNovo {
  dimensoes: OpcoesDimensoes;
  /** Código curto do grupo (entra no código do produto). */
  codigoGrupo: Record<string, string>;
  categorias: CategoriaOpcao[];
  fabricantes: OpcaoSimples[];
  status: OpcaoSimples[];
  ncms: OpcaoSimples[];
  cests: CestOpcao[];
  origens: OpcaoSimples[];
  icms: OpcaoSimples[];
  indicadoresCfop: OpcaoSimples[];
  itensSped: OpcaoSimples[];
  contas: OpcaoSimples[];
  empresas: OpcaoSimples[];
  /** Coleções ordenadas pelo uso na empresa (a lista crua tem 338). */
  usosColecao: Record<string, number>;
  usosTipo: Record<string, number>;
  cores: CorCatalogo[];
  padroes: { geral: PadraoCampos; porGrupo: Record<string, PadraoCampos>; fixo: typeof PADRAO_FIXO };
  tabelaVenda: TabelaPrecoResumo | null;
  tabelaCusto: TabelaPrecoResumo | null;
}

function filtroEmpresaSql(company: ProdutoNovoCompany, alias = 'p'): string {
  const codes = EMPRESA_CODES[company] ?? [];
  // EMPRESA serve aqui só para medir uso e escolher padrão — nunca para esconder
  // valor válido (ver produtos-empresa-nao-e-dono).
  return codes.length > 0 ? `${alias}.EMPRESA IN (${codes.join(', ')})` : '1 = 1';
}

export async function fetchOpcoesProdutoNovo(company: ProdutoNovoCompany): Promise<OpcoesProdutoNovo> {
  const [dimensoes, lookups, padroes, cores, tabelas] = await Promise.all([
    fetchOpcoesDimensoes(),
    fetchLookups(company),
    fetchPadroes(company),
    fetchCatalogoCoresEmpresa(company),
    fetchTabelasPreco(),
  ]);

  return {
    dimensoes,
    ...lookups,
    itensSped: ITENS_SPED,
    cores,
    padroes: { ...padroes, fixo: PADRAO_FIXO },
    tabelaVenda: tabelas.venda,
    tabelaCusto: tabelas.custo,
  };
}

type Lookups = Omit<
  OpcoesProdutoNovo,
  'dimensoes' | 'itensSped' | 'cores' | 'padroes' | 'tabelaVenda' | 'tabelaCusto'
>;

async function fetchLookups(company: ProdutoNovoCompany): Promise<Lookups> {
  const emp = filtroEmpresaSql(company);
  const codes = EMPRESA_CODES[company] ?? [];
  const janela = `p.DATA_CADASTRAMENTO >= DATEADD(MONTH, -${MESES_PADRAO}, GETDATE())`;

  const rows = await withRequest(async (request) => {
    const r = await request.query<{ k: string; a: string; b: string; c: string; d: string; n: number | null }>(`
      SET NOCOUNT ON;
      SELECT 'GRUPO' AS k, LTRIM(RTRIM(GRUPO_PRODUTO)) AS a, LTRIM(RTRIM(ISNULL(CODIGO_GRUPO, ''))) AS b,
             '' AS c, '' AS d, NULL AS n
      FROM PRODUTOS_GRUPO WITH (NOLOCK)
      UNION ALL
      SELECT 'CAT', LTRIM(RTRIM(c.COD_CATEGORIA)), LTRIM(RTRIM(ISNULL(c.CATEGORIA_PRODUTO, ''))),
             LTRIM(RTRIM(ISNULL(s.COD_SUBCATEGORIA, ''))), LTRIM(RTRIM(ISNULL(s.SUBCATEGORIA_PRODUTO, ''))),
             (SELECT COUNT(*) FROM PRODUTOS p WITH (NOLOCK)
               WHERE ${emp} AND ${janela} AND p.COD_CATEGORIA = c.COD_CATEGORIA
                 AND (s.COD_SUBCATEGORIA IS NULL OR p.COD_SUBCATEGORIA = s.COD_SUBCATEGORIA))
      FROM PRODUTOS_CATEGORIA c WITH (NOLOCK)
      LEFT JOIN PRODUTOS_SUBCATEGORIA s WITH (NOLOCK)
        ON s.COD_CATEGORIA = c.COD_CATEGORIA AND ISNULL(s.INATIVO, 0) = 0
      WHERE ISNULL(c.INATIVO, 0) = 0
      UNION ALL
      SELECT 'FAB', LTRIM(RTRIM(f.FORNECEDOR)), '', '', '',
             (SELECT COUNT(*) FROM PRODUTOS p WITH (NOLOCK) WHERE ${emp} AND ${janela} AND p.FABRICANTE = f.FORNECEDOR)
      FROM FORNECEDORES f WITH (NOLOCK)
      UNION ALL
      SELECT 'STATUS', LTRIM(RTRIM(STATUS_PRODUTO)), LTRIM(RTRIM(ISNULL(DESC_STATUS_PRODUTO, ''))), '', '', NULL
      FROM PRODUTOS_STATUS WITH (NOLOCK)
      UNION ALL
      SELECT 'NCM', LTRIM(RTRIM(cf.CLASSIF_FISCAL)), LTRIM(RTRIM(ISNULL(cf.DESC_CLASSIFICACAO, ''))), '', '',
             (SELECT COUNT(*) FROM PRODUTOS p WITH (NOLOCK) WHERE ${emp} AND ${janela} AND p.CLASSIF_FISCAL = cf.CLASSIF_FISCAL)
      FROM CLASSIF_FISCAL cf WITH (NOLOCK)
      WHERE ISNULL(cf.INATIVO, 0) = 0
      UNION ALL
      SELECT 'CEST', CAST(cn.ID AS VARCHAR(12)), LTRIM(RTRIM(n.CODIGO_NCM)), LTRIM(RTRIM(ce.CODIGO_CEST)),
             LTRIM(RTRIM(ISNULL(ce.DESCRICAO, ''))), NULL
      FROM CEST_NCM cn WITH (NOLOCK)
      JOIN TABELA_LX_NCM n WITH (NOLOCK) ON n.ID = cn.ID_NCM
      JOIN TABELA_LX_CEST ce WITH (NOLOCK) ON ce.ID = cn.ID_CEST
      WHERE ISNULL(cn.INATIVO, 0) = 0
        AND EXISTS (SELECT 1 FROM CLASSIF_FISCAL cf WITH (NOLOCK)
                    WHERE LTRIM(RTRIM(cf.CLASSIF_FISCAL)) = LTRIM(RTRIM(n.CODIGO_NCM)))
      UNION ALL
      SELECT 'ORIGEM', LTRIM(RTRIM(TRIBUT_ORIGEM)), LTRIM(RTRIM(ISNULL(DESCRICAO, ''))), '', '', NULL
      FROM TRIBUT_ORIGEM WITH (NOLOCK) WHERE ISNULL(INATIVO, 0) = 0
      UNION ALL
      SELECT 'ICMS', LTRIM(RTRIM(TRIBUT_ICMS)), LTRIM(RTRIM(ISNULL(DESCRICAO, ''))), '', '', NULL
      FROM TRIBUT_ICMS WITH (NOLOCK) WHERE ISNULL(INATIVO, 0) = 0
      UNION ALL
      SELECT 'CFOP', CAST(INDICADOR_CFOP AS VARCHAR(5)), LTRIM(RTRIM(ISNULL(DESCRICAO_INDICADOR_CFOP, ''))), '', '', NULL
      FROM CTB_LX_INDICADOR_CFOP WITH (NOLOCK) WHERE ISNULL(INATIVO, 0) = 0
      UNION ALL
      -- Só as contas que a empresa usa em produto (o plano de contas inteiro é
      -- enorme e não serve para escolher conta de estoque).
      SELECT 'CONTA', LTRIM(RTRIM(x.CONTA_CONTABIL)), LTRIM(RTRIM(ISNULL(cp.DESC_CONTA, ''))), '', '', x.n
      FROM (SELECT p.CONTA_CONTABIL, COUNT(*) AS n FROM PRODUTOS p WITH (NOLOCK)
            WHERE ${emp} AND p.CONTA_CONTABIL IS NOT NULL GROUP BY p.CONTA_CONTABIL) x
      LEFT JOIN CTB_CONTA_PLANO cp WITH (NOLOCK) ON cp.CONTA_CONTABIL = x.CONTA_CONTABIL
      UNION ALL
      SELECT 'EMPRESA', CAST(EMPRESA AS VARCHAR(5)), LTRIM(RTRIM(ISNULL(DESC_EMPRESA, ''))), '', '', NULL
      FROM EMPRESA WITH (NOLOCK)
      WHERE ${codes.length > 0 ? `EMPRESA IN (${codes.join(', ')})` : '1 = 1'}
      UNION ALL
      SELECT 'USO_COLECAO', LTRIM(RTRIM(p.COLECAO)), '', '', '', COUNT(*)
      FROM PRODUTOS p WITH (NOLOCK) WHERE ${emp} AND ${janela} GROUP BY p.COLECAO
      UNION ALL
      SELECT 'USO_TIPO', LTRIM(RTRIM(p.TIPO_PRODUTO)), '', '', '', COUNT(*)
      FROM PRODUTOS p WITH (NOLOCK) WHERE ${emp} AND ${janela} GROUP BY p.TIPO_PRODUTO
    `);
    return r.recordset;
  });

  const codigoGrupo: Record<string, string> = {};
  const categorias = new Map<string, CategoriaOpcao>();
  const fabricantes: OpcaoSimples[] = [];
  const status: OpcaoSimples[] = [];
  const ncms: OpcaoSimples[] = [];
  const cests: CestOpcao[] = [];
  const origens: OpcaoSimples[] = [];
  const icms: OpcaoSimples[] = [];
  const indicadoresCfop: OpcaoSimples[] = [];
  const contas: OpcaoSimples[] = [];
  const empresas: OpcaoSimples[] = [];
  const usosColecao: Record<string, number> = {};
  const usosTipo: Record<string, number> = {};

  for (const row of rows) {
    const a = limpar(row.a);
    const b = limpar(row.b);
    const n = Number(row.n ?? 0) || 0;
    if (!a) continue;
    switch (row.k) {
      case 'GRUPO':
        codigoGrupo[a] = b;
        break;
      case 'CAT': {
        const cat = categorias.get(a) ?? { codigo: a, nome: b, usos: 0, subcategorias: [] };
        const sub = limpar(row.c);
        if (sub) {
          cat.subcategorias.push({ codigo: sub, nome: limpar(row.d), usos: n });
          cat.usos += n;
        }
        categorias.set(a, cat);
        break;
      }
      case 'FAB':
        fabricantes.push({ codigo: a, nome: a, usos: n });
        break;
      case 'STATUS':
        status.push({ codigo: a, nome: b });
        break;
      case 'NCM':
        ncms.push({ codigo: a, nome: b, usos: n });
        break;
      case 'CEST':
        cests.push({ id: Number(a), ncm: b, cest: limpar(row.c), descricao: limpar(row.d) });
        break;
      case 'ORIGEM':
        origens.push({ codigo: a, nome: b });
        break;
      case 'ICMS':
        icms.push({ codigo: a, nome: b });
        break;
      case 'CFOP':
        indicadoresCfop.push({ codigo: a, nome: b });
        break;
      case 'CONTA':
        contas.push({ codigo: a, nome: b, usos: n });
        break;
      case 'EMPRESA':
        empresas.push({ codigo: a, nome: b });
        break;
      case 'USO_COLECAO':
        usosColecao[a] = n;
        break;
      case 'USO_TIPO':
        usosTipo[a] = n;
        break;
    }
  }

  const porUso = (x: OpcaoSimples, y: OpcaoSimples) =>
    (y.usos ?? 0) - (x.usos ?? 0) || x.nome.localeCompare(y.nome, 'pt-BR');
  const listaCategorias = [...categorias.values()].sort(
    (x, y) => y.usos - x.usos || x.nome.localeCompare(y.nome, 'pt-BR')
  );
  for (const cat of listaCategorias) {
    cat.subcategorias.sort((x, y) => y.usos - x.usos || x.nome.localeCompare(y.nome, 'pt-BR'));
  }

  return {
    codigoGrupo,
    categorias: listaCategorias,
    fabricantes: fabricantes.sort(porUso),
    status: status.sort((x, y) => x.codigo.localeCompare(y.codigo)),
    ncms: ncms.sort((x, y) => (y.usos ?? 0) - (x.usos ?? 0) || x.codigo.localeCompare(y.codigo)),
    cests,
    origens: origens.sort((x, y) => x.codigo.localeCompare(y.codigo)),
    icms: icms.sort((x, y) => x.codigo.localeCompare(y.codigo)),
    indicadoresCfop: indicadoresCfop.sort((x, y) => Number(x.codigo) - Number(y.codigo)),
    contas: contas.sort(porUso),
    empresas,
    usosColecao,
    usosTipo,
  };
}

/**
 * Valor mais usado de cada campo, por grupo e na empresa toda, nos produtos
 * cadastrados nos últimos {@link MESES_PADRAO} meses.
 *
 * Categoria+subcategoria e NCM+CEST são medidos como PAR: escolher a categoria
 * mais usada e, separado, a subcategoria mais usada poderia montar um par que
 * nem existe (a FK é composta).
 */
async function fetchPadroes(
  company: ProdutoNovoCompany
): Promise<{ geral: PadraoCampos; porGrupo: Record<string, PadraoCampos> }> {
  const emp = filtroEmpresaSql(company);

  const rows = await withRequest(async (request) => {
    const r = await request.query<{ GRUPO: string; CAMPO: string; VALOR: string; N: number; TOTAL: number }>(`
      SET NOCOUNT ON;
      WITH b AS (
        SELECT LTRIM(RTRIM(p.GRUPO_PRODUTO)) AS GRUPO,
          CAST(LTRIM(RTRIM(p.TIPO_PRODUTO)) AS VARCHAR(60)) AS tipo,
          CAST(LTRIM(RTRIM(p.COLECAO)) AS VARCHAR(60)) AS colecao,
          CAST(LTRIM(RTRIM(p.GRIFFE)) AS VARCHAR(60)) AS griffe,
          CAST(LTRIM(RTRIM(p.LINHA)) AS VARCHAR(60)) AS linha,
          CAST(LTRIM(RTRIM(p.FABRICANTE)) AS VARCHAR(60)) AS fabricante,
          CAST(LTRIM(RTRIM(p.GRADE)) AS VARCHAR(60)) AS grade,
          CAST(LTRIM(RTRIM(p.UNIDADE)) AS VARCHAR(60)) AS unidade,
          CAST(ISNULL(LTRIM(RTRIM(p.COD_CATEGORIA)), '') + '|' + ISNULL(LTRIM(RTRIM(p.COD_SUBCATEGORIA)), '') AS VARCHAR(60)) AS categoriaPar,
          CAST(ISNULL(LTRIM(RTRIM(p.STATUS_PRODUTO)), '') AS VARCHAR(60)) AS status,
          CAST(p.EMPRESA AS VARCHAR(60)) AS empresa,
          CAST(LTRIM(RTRIM(p.CLASSIF_FISCAL)) + '|' + ISNULL(CAST(p.ID_CEST_NCM AS VARCHAR(12)), '') AS VARCHAR(60)) AS fiscalPar,
          CAST(LTRIM(RTRIM(p.TRIBUT_ORIGEM)) AS VARCHAR(60)) AS tributOrigem,
          CAST(LTRIM(RTRIM(p.TRIBUT_ICMS)) AS VARCHAR(60)) AS tributIcms,
          CAST(ISNULL(CAST(p.INDICADOR_CFOP AS VARCHAR(5)), '') AS VARCHAR(60)) AS indicadorCfop,
          CAST(ISNULL(LTRIM(RTRIM(p.TIPO_ITEM_SPED)), '') AS VARCHAR(60)) AS tipoItemSped,
          CAST(ISNULL(LTRIM(RTRIM(p.CONTA_CONTABIL)), '') AS VARCHAR(60)) AS contaContabil,
          CAST(ISNULL(LTRIM(RTRIM(p.PERIODO_PCP)), '') AS VARCHAR(60)) AS periodoPcp,
          CAST(CAST(p.ENVIA_LOJA_VAREJO AS INT) AS VARCHAR(60)) AS enviaLojaVarejo,
          CAST(CAST(p.ENVIA_LOJA_ATACADO AS INT) AS VARCHAR(60)) AS enviaLojaAtacado
        FROM PRODUTOS p WITH (NOLOCK)
        WHERE ${emp} AND p.DATA_CADASTRAMENTO >= DATEADD(MONTH, -${MESES_PADRAO}, GETDATE())
      ), u AS (
        SELECT b.GRUPO, v.CAMPO, v.VALOR
        FROM b CROSS APPLY (VALUES
          ('tipo', b.tipo), ('colecao', b.colecao), ('griffe', b.griffe), ('linha', b.linha),
          ('fabricante', b.fabricante), ('grade', b.grade), ('unidade', b.unidade),
          ('categoriaPar', b.categoriaPar), ('status', b.status), ('empresa', b.empresa),
          ('fiscalPar', b.fiscalPar), ('tributOrigem', b.tributOrigem), ('tributIcms', b.tributIcms),
          ('indicadorCfop', b.indicadorCfop), ('tipoItemSped', b.tipoItemSped),
          ('contaContabil', b.contaContabil), ('periodoPcp', b.periodoPcp),
          ('enviaLojaVarejo', b.enviaLojaVarejo), ('enviaLojaAtacado', b.enviaLojaAtacado)
        ) v(CAMPO, VALOR)
      ), g AS (
        SELECT CASE WHEN GROUPING(u.GRUPO) = 1 THEN '*' ELSE u.GRUPO END AS GRUPO,
               u.CAMPO, ISNULL(u.VALOR, '') AS VALOR, COUNT(*) AS N
        FROM u
        GROUP BY GROUPING SETS ((u.GRUPO, u.CAMPO, u.VALOR), (u.CAMPO, u.VALOR))
      ), r AS (
        SELECT g.*, ROW_NUMBER() OVER (PARTITION BY g.GRUPO, g.CAMPO ORDER BY g.N DESC, g.VALOR) AS RN,
               SUM(g.N) OVER (PARTITION BY g.GRUPO, g.CAMPO) AS TOTAL
        FROM g
      )
      SELECT GRUPO, CAMPO, VALOR, N, TOTAL FROM r WHERE RN = 1
    `);
    return r.recordset;
  });

  const geral: PadraoCampos = {};
  const porGrupo: Record<string, PadraoCampos> = {};

  for (const row of rows) {
    const alvo = row.GRUPO === '*' ? geral : (porGrupo[limpar(row.GRUPO)] ??= {});
    const usos = Number(row.N) || 0;
    const total = Number(row.TOTAL) || 0;
    const valor = limpar(row.VALOR);
    if (row.CAMPO === 'categoriaPar') {
      const [cat, sub] = valor.split('|');
      alvo.categoria = { valor: limpar(cat), usos, total };
      alvo.subcategoria = { valor: limpar(sub), usos, total };
    } else if (row.CAMPO === 'fiscalPar') {
      const [ncm, cest] = valor.split('|');
      alvo.classifFiscal = { valor: limpar(ncm), usos, total };
      alvo.idCestNcm = { valor: limpar(cest), usos, total };
    } else {
      alvo[row.CAMPO as CampoPadrao] = { valor, usos, total };
    }
  }

  return { geral, porGrupo };
}

/** Tabela padrão (venda) e de custo, com as filhas que o trigger vai criar. */
async function fetchTabelasPreco(): Promise<{ venda: TabelaPrecoResumo | null; custo: TabelaPrecoResumo | null }> {
  const rows = await withRequest(async (request) => {
    const r = await request.query<{
      PAPEL: string;
      BASE: string;
      BASE_NOME: string;
      FILHA: string | null;
      FILHA_NOME: string | null;
      PCT: number | null;
      INATIVA: boolean | number | null;
    }>(`
      SET NOCOUNT ON;
      DECLARE @venda CHAR(2) = (SELECT LEFT(LTRIM(RTRIM(VALOR_ATUAL)), 2) FROM PARAMETROS WITH (NOLOCK) WHERE PARAMETRO = 'TABELA_PRECO_PADRAO');
      DECLARE @custo CHAR(2) = (SELECT LEFT(LTRIM(RTRIM(VALOR_ATUAL)), 2) FROM PARAMETROS WITH (NOLOCK) WHERE PARAMETRO = 'TABELA_PRECO_CUSTO');
      SELECT x.PAPEL, x.BASE, LTRIM(RTRIM(ISNULL(tb.TABELA, ''))) AS BASE_NOME,
             LTRIM(RTRIM(f.CODIGO_TAB_PRECO)) AS FILHA, LTRIM(RTRIM(ISNULL(tf.TABELA, ''))) AS FILHA_NOME,
             f.PORCENTAGEM_TABELA_BASE AS PCT, ISNULL(tf.INATIVO, 0) AS INATIVA
      FROM (VALUES ('venda', @venda), ('custo', @custo)) x(PAPEL, BASE)
      LEFT JOIN TABELAS_PRECO tb WITH (NOLOCK) ON tb.CODIGO_TAB_PRECO = x.BASE
      OUTER APPLY FX_RETORNA_TABELAS_FILHAS(x.BASE) f
      LEFT JOIN TABELAS_PRECO tf WITH (NOLOCK) ON tf.CODIGO_TAB_PRECO = f.CODIGO_TAB_PRECO
      WHERE x.BASE IS NOT NULL
      ORDER BY x.PAPEL, f.CODIGO_TAB_PRECO
    `);
    return r.recordset;
  });

  const montar = (papel: string): TabelaPrecoResumo | null => {
    const doPapel = rows.filter((r) => r.PAPEL === papel);
    if (doPapel.length === 0) return null;
    return {
      codigo: limpar(doPapel[0].BASE),
      nome: limpar(doPapel[0].BASE_NOME),
      filhas: doPapel
        .filter((r) => limpar(r.FILHA))
        .map((r) => ({
          codigo: limpar(r.FILHA),
          nome: limpar(r.FILHA_NOME),
          pct: Number(r.PCT ?? 0) || 0,
          inativa: Boolean(r.INATIVA),
        })),
    };
  };

  return { venda: montar('venda'), custo: montar('custo') };
}

/* ═══════════════════════════ código do produto ═══════════════════════════ */

/**
 * Próximo código do subgrupo, a regra do ERP: `CODIGO_SEQUENCIAL` + 1, com 4
 * dígitos. Duas proteções que o ERP não tem:
 *  • subgrupo antigo com lixo no sequencial ('B2', '03' herdado do código do
 *    subgrupo — o ERP gerou '13.B2.00B3'): parte do maior número já usado;
 *  • código que já existe (produto que veio de outro subgrupo): pula.
 *
 * Espera `@grupo`/`@subgrupo` declarados; deixa `@produtoCh` e `@novoSeq`.
 * Com `travar`, segura as linhas até o COMMIT (gravação); sem, é só leitura.
 */
function sqlProximoCodigo(travar: boolean): string {
  const hint = travar ? 'WITH (UPDLOCK, HOLDLOCK)' : 'WITH (NOLOCK)';
  return `
  DECLARE @cg VARCHAR(3), @cs VARCHAR(3), @seqAtual VARCHAR(4), @achouSub BIT = 0;
  SELECT @achouSub = 1,
         @cg = LTRIM(RTRIM(ISNULL(g.CODIGO_GRUPO, ''))),
         @cs = LTRIM(RTRIM(ISNULL(sg.CODIGO_SUBGRUPO, ''))),
         @seqAtual = LTRIM(RTRIM(ISNULL(sg.CODIGO_SEQUENCIAL, '')))
  FROM PRODUTOS_SUBGRUPO sg ${hint}
  JOIN PRODUTOS_GRUPO g WITH (NOLOCK) ON g.GRUPO_PRODUTO = sg.GRUPO_PRODUTO
  WHERE sg.GRUPO_PRODUTO = @grupo AND sg.SUBGRUPO_PRODUTO = @subgrupo;

  IF @achouSub = 0
    BEGIN ;THROW 52001, 'Esse subgrupo não existe dentro do grupo escolhido.', 1; END
  IF @cg = '' OR @cs = ''
    BEGIN ;THROW 52002, 'O grupo ou o subgrupo está sem código curto no Linx — sem ele não há como montar o código do produto.', 1; END

  DECLARE @prefixoCod VARCHAR(12) = @cg + '.' + @cs + '.';
  DECLARE @n INT = CASE WHEN @seqAtual <> '' AND @seqAtual NOT LIKE '%[^0-9]%' THEN CONVERT(INT, @seqAtual) END;
  IF @n IS NULL
    SELECT @n = ISNULL(MAX(TRY_CONVERT(INT, SUBSTRING(LTRIM(RTRIM(p.PRODUTO)), LEN(@prefixoCod) + 1, 12))), 0)
    FROM PRODUTOS p WITH (NOLOCK)
    WHERE p.PRODUTO LIKE @prefixoCod + '%';

  DECLARE @produtoCh CHAR(12) = NULL, @codTxt VARCHAR(20), @tentCod INT = 0, @novoSeq VARCHAR(4);
  WHILE @produtoCh IS NULL AND @tentCod < 2000
  BEGIN
    SET @tentCod += 1;
    SET @n += 1;
    IF @n > 9999
      BEGIN ;THROW 52003, 'O sequencial deste subgrupo passou de 9999 — crie outro subgrupo.', 1; END
    SET @novoSeq = RIGHT('0000' + CAST(@n AS VARCHAR(10)), 4);
    SET @codTxt = @prefixoCod + @novoSeq;
    IF LEN(@codTxt) > 12
      BEGIN ;THROW 52004, 'O código do produto passaria de 12 caracteres (limite do Linx).', 1; END
    IF NOT EXISTS (SELECT 1 FROM PRODUTOS ${hint} WHERE PRODUTO = @codTxt) SET @produtoCh = @codTxt;
  END
  IF @produtoCh IS NULL
    BEGIN ;THROW 52005, 'Não foi possível achar um código livre neste subgrupo.', 1; END
`;
}

/* ═══════════════════════════ prévia ═══════════════════════════ */

export interface ProdutoRecente {
  produto: string;
  descProduto: string;
  data: string | null;
  venda: number | null;
  custo: number | null;
  cores: string;
}

export interface PreviaProdutoNovo {
  codigo: string | null;
  erroCodigo: string | null;
  /** Últimos cadastrados no subgrupo — referência de nome e de preço. */
  recentes: ProdutoRecente[];
  /** Produtos que já têm exatamente este nome (evita cadastro em dobro). */
  nomesIguais: Array<{ produto: string; descProduto: string; grupo: string; subgrupo: string; data: string | null }>;
  tamanhos: Array<{ tamanho: number; grade: string }>;
  prefixoEan: string;
  proximoInterno: string;
  proximoEan: string;
}

function toIsoData(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  const t = limpar(value);
  return t || null;
}

export async function fetchPreviaProdutoNovo(params: {
  company: ProdutoNovoCompany;
  grupo: string;
  subgrupo: string;
  grade: string;
  descProduto: string;
  empresa: number | null;
}): Promise<PreviaProdutoNovo> {
  const grupo = limpar(params.grupo);
  const subgrupo = limpar(params.subgrupo);
  const desc = normalizarNome(params.descProduto);

  const [codigo, recentes, nomesIguais, tamanhos, seq] = await Promise.all([
    grupo && subgrupo
      ? withRequest(async (request) => {
          request.input('pvGrupo', sql.VarChar, grupo);
          request.input('pvSubgrupo', sql.VarChar, subgrupo);
          try {
            const r = await request.query<{ CODIGO: string }>(`
              SET NOCOUNT ON;
              DECLARE @grupo VARCHAR(25) = @pvGrupo, @subgrupo VARCHAR(25) = @pvSubgrupo;
              ${sqlProximoCodigo(false)}
              SELECT LTRIM(RTRIM(@produtoCh)) AS CODIGO;
            `);
            return { codigo: limpar(r.recordset[0]?.CODIGO) || null, erro: null as string | null };
          } catch (error) {
            return { codigo: null, erro: error instanceof Error ? error.message : String(error) };
          }
        })
      : Promise.resolve({ codigo: null, erro: null as string | null }),
    grupo && subgrupo ? fetchRecentesDoSubgrupo(grupo, subgrupo) : Promise.resolve([]),
    desc ? fetchNomesIguais(desc) : Promise.resolve([]),
    fetchTamanhosDaGrade(params.grade),
    fetchPreviaSequenciais(params.empresa ?? EMPRESA_CODES[params.company]?.[0] ?? null),
  ]);

  return {
    codigo: codigo.codigo,
    erroCodigo: codigo.erro,
    recentes,
    nomesIguais,
    tamanhos,
    prefixoEan: seq.prefixo,
    proximoInterno: seq.proximoInterno,
    proximoEan: seq.proximoEan,
  };
}

async function fetchRecentesDoSubgrupo(grupo: string, subgrupo: string): Promise<ProdutoRecente[]> {
  return withRequest(async (request) => {
    request.input('rcGrupo', sql.VarChar, grupo);
    request.input('rcSubgrupo', sql.VarChar, subgrupo);
    const r = await request.query<{
      PRODUTO: string;
      DESC_PRODUTO: string;
      DATA: Date | null;
      VENDA: number | null;
      CUSTO: number | null;
      CORES: string | null;
    }>(`
      SET NOCOUNT ON;
      DECLARE @grupo VARCHAR(25) = @rcGrupo, @subgrupo VARCHAR(25) = @rcSubgrupo;
      DECLARE @tabVenda CHAR(2) = (SELECT LEFT(LTRIM(RTRIM(VALOR_ATUAL)), 2) FROM PARAMETROS WITH (NOLOCK) WHERE PARAMETRO = 'TABELA_PRECO_PADRAO');
      DECLARE @tabCusto CHAR(2) = (SELECT LEFT(LTRIM(RTRIM(VALOR_ATUAL)), 2) FROM PARAMETROS WITH (NOLOCK) WHERE PARAMETRO = 'TABELA_PRECO_CUSTO');
      SELECT TOP 8 LTRIM(RTRIM(p.PRODUTO)) AS PRODUTO, LTRIM(RTRIM(p.DESC_PRODUTO)) AS DESC_PRODUTO,
             p.DATA_CADASTRAMENTO AS DATA, pv.PRECO1 AS VENDA, pc.PRECO1 AS CUSTO,
             STUFF((SELECT ', ' + LTRIM(RTRIM(c.DESC_COR_PRODUTO)) FROM PRODUTO_CORES c WITH (NOLOCK)
                    WHERE c.PRODUTO = p.PRODUTO ORDER BY c.COR_PRODUTO
                    FOR XML PATH(''), TYPE).value('.', 'VARCHAR(MAX)'), 1, 2, '') AS CORES
      FROM PRODUTOS p WITH (NOLOCK)
      LEFT JOIN PRODUTOS_PRECOS pv WITH (NOLOCK) ON pv.PRODUTO = p.PRODUTO AND pv.CODIGO_TAB_PRECO = @tabVenda
      LEFT JOIN PRODUTOS_PRECOS pc WITH (NOLOCK) ON pc.PRODUTO = p.PRODUTO AND pc.CODIGO_TAB_PRECO = @tabCusto
      WHERE p.GRUPO_PRODUTO = @grupo AND p.SUBGRUPO_PRODUTO = @subgrupo
      ORDER BY p.ID DESC
    `);
    return r.recordset.map((row) => ({
      produto: limpar(row.PRODUTO),
      descProduto: limpar(row.DESC_PRODUTO),
      data: toIsoData(row.DATA),
      venda: toNumber(row.VENDA),
      custo: toNumber(row.CUSTO),
      cores: limpar(row.CORES),
    }));
  });
}

async function fetchNomesIguais(desc: string): Promise<PreviaProdutoNovo['nomesIguais']> {
  return withRequest(async (request) => {
    request.input('niDesc', sql.VarChar, desc);
    const r = await request.query<{ PRODUTO: string; DESC_PRODUTO: string; GRUPO: string; SUBGRUPO: string; DATA: Date | null }>(`
      SET NOCOUNT ON;
      DECLARE @desc VARCHAR(40) = @niDesc;
      SELECT TOP 5 LTRIM(RTRIM(PRODUTO)) AS PRODUTO, LTRIM(RTRIM(DESC_PRODUTO)) AS DESC_PRODUTO,
             LTRIM(RTRIM(GRUPO_PRODUTO)) AS GRUPO, LTRIM(RTRIM(SUBGRUPO_PRODUTO)) AS SUBGRUPO,
             DATA_CADASTRAMENTO AS DATA
      FROM PRODUTOS WITH (NOLOCK)
      WHERE DESC_PRODUTO = @desc
      ORDER BY ID DESC
    `);
    return r.recordset.map((row) => ({
      produto: limpar(row.PRODUTO),
      descProduto: limpar(row.DESC_PRODUTO),
      grupo: limpar(row.GRUPO),
      subgrupo: limpar(row.SUBGRUPO),
      data: toIsoData(row.DATA),
    }));
  });
}

/**
 * Tamanhos da grade, pelos TAMANHO_n preenchidos (NUMERO_TAMANHOS é lixo — vem
 * 16 em toda grade). Grade sem tamanho nenhum = tamanho único 'U', como o ERP.
 */
async function fetchTamanhosDaGrade(gradeBruta: string): Promise<Array<{ tamanho: number; grade: string }>> {
  const grade = limpar(gradeBruta);
  if (!grade) return [{ tamanho: 1, grade: 'U' }];
  const cols = Array.from(
    { length: MAX_TAMANHOS },
    (_, i) => `LTRIM(RTRIM(ISNULL(CAST(pt.TAMANHO_${i + 1} AS VARCHAR(20)), ''))) AS T${i + 1}`
  ).join(', ');
  const row = await withRequest(async (request) => {
    request.input('tgGrade', sql.VarChar, grade);
    const r = await request.query<Record<string, string | null>>(`
      SELECT TOP 1 ${cols} FROM PRODUTOS_TAMANHOS pt WITH (NOLOCK)
      WHERE LTRIM(RTRIM(CAST(pt.GRADE AS VARCHAR(60)))) = @tgGrade
    `);
    return r.recordset[0] ?? null;
  });
  const lista: Array<{ tamanho: number; grade: string }> = [];
  if (row) {
    for (let i = 1; i <= MAX_TAMANHOS; i += 1) {
      const label = limpar(row[`T${i}`]);
      if (label) lista.push({ tamanho: i, grade: label.slice(0, 8) });
    }
  }
  return lista.length > 0 ? lista : [{ tamanho: 1, grade: 'U' }];
}

/* ═══════════════════════════ copiar de um produto ═══════════════════════════ */

export interface ModeloProduto {
  produto: string;
  descProduto: string;
  campos: CamposProdutoNovo;
  cores: Array<{ cor: string; descCor: string }>;
  venda: number | null;
  custo: number | null;
}

/** Ficha de um produto existente, para servir de modelo ao novo ("copiar de"). */
export async function fetchModeloProduto(produtoBruto: string): Promise<ModeloProduto> {
  const produto = limpar(produtoBruto).toUpperCase();
  if (!produto) throw new Error('Informe o código do produto modelo.');

  const dados = await withRequest(async (request) => {
    request.input('mdProduto', sql.VarChar, produto);
    const r = await request.query<Record<string, unknown>>(`
      SET NOCOUNT ON;
      DECLARE @produto CHAR(12) = @mdProduto;
      DECLARE @tabVenda CHAR(2) = (SELECT LEFT(LTRIM(RTRIM(VALOR_ATUAL)), 2) FROM PARAMETROS WITH (NOLOCK) WHERE PARAMETRO = 'TABELA_PRECO_PADRAO');
      DECLARE @tabCusto CHAR(2) = (SELECT LEFT(LTRIM(RTRIM(VALOR_ATUAL)), 2) FROM PARAMETROS WITH (NOLOCK) WHERE PARAMETRO = 'TABELA_PRECO_CUSTO');
      SELECT 'P' AS K, p.PRODUTO, p.DESC_PRODUTO, p.DESC_PROD_NF, p.GRUPO_PRODUTO, p.SUBGRUPO_PRODUTO,
             p.TIPO_PRODUTO, p.COLECAO, p.GRIFFE, p.LINHA, p.FABRICANTE, p.GRADE, p.UNIDADE,
             p.COD_CATEGORIA, p.COD_SUBCATEGORIA, p.STATUS_PRODUTO, p.REFER_FABRICANTE, p.EMPRESA,
             p.CLASSIF_FISCAL, p.ID_CEST_NCM, p.TRIBUT_ORIGEM, p.TRIBUT_ICMS, p.INDICADOR_CFOP,
             p.TIPO_ITEM_SPED, p.CONTA_CONTABIL, p.PERIODO_PCP,
             CAST(p.ENVIA_LOJA_VAREJO AS INT) AS ENVIA_LOJA_VAREJO,
             CAST(p.ENVIA_LOJA_ATACADO AS INT) AS ENVIA_LOJA_ATACADO,
             pv.PRECO1 AS VENDA, pc.PRECO1 AS CUSTO, NULL AS COR, NULL AS DESC_COR
      FROM PRODUTOS p WITH (NOLOCK)
      LEFT JOIN PRODUTOS_PRECOS pv WITH (NOLOCK) ON pv.PRODUTO = p.PRODUTO AND pv.CODIGO_TAB_PRECO = @tabVenda
      LEFT JOIN PRODUTOS_PRECOS pc WITH (NOLOCK) ON pc.PRODUTO = p.PRODUTO AND pc.CODIGO_TAB_PRECO = @tabCusto
      WHERE p.PRODUTO = @produto
    `);
    return r.recordset[0] ?? null;
  });
  if (!dados) throw new Error(`Produto "${produto}" não existe no cadastro.`);

  const cores = await withRequest(async (request) => {
    request.input('mcProduto', sql.VarChar, produto);
    const r = await request.query<{ COR: string; DESC_COR: string }>(`
      SET NOCOUNT ON;
      DECLARE @produto CHAR(12) = @mcProduto;
      SELECT LTRIM(RTRIM(COR_PRODUTO)) AS COR, LTRIM(RTRIM(ISNULL(DESC_COR_PRODUTO, ''))) AS DESC_COR
      FROM PRODUTO_CORES WITH (NOLOCK) WHERE PRODUTO = @produto ORDER BY COR_PRODUTO
    `);
    return r.recordset.map((row) => ({ cor: limpar(row.COR), descCor: limpar(row.DESC_COR) }));
  });

  const txt = (k: string) => limpar(dados[k]);
  return {
    produto: txt('PRODUTO'),
    descProduto: txt('DESC_PRODUTO'),
    campos: {
      grupo: txt('GRUPO_PRODUTO'),
      subgrupo: txt('SUBGRUPO_PRODUTO'),
      descProduto: txt('DESC_PRODUTO'),
      descProdNf: txt('DESC_PROD_NF'),
      tipo: txt('TIPO_PRODUTO'),
      colecao: txt('COLECAO'),
      griffe: txt('GRIFFE'),
      linha: txt('LINHA'),
      fabricante: txt('FABRICANTE'),
      grade: txt('GRADE'),
      unidade: txt('UNIDADE'),
      categoria: txt('COD_CATEGORIA'),
      subcategoria: txt('COD_SUBCATEGORIA'),
      status: txt('STATUS_PRODUTO'),
      referFabricante: txt('REFER_FABRICANTE'),
      empresa: toNumber(dados.EMPRESA),
      classifFiscal: txt('CLASSIF_FISCAL'),
      idCestNcm: toNumber(dados.ID_CEST_NCM),
      tributOrigem: txt('TRIBUT_ORIGEM'),
      tributIcms: txt('TRIBUT_ICMS'),
      indicadorCfop: toNumber(dados.INDICADOR_CFOP),
      tipoItemSped: txt('TIPO_ITEM_SPED'),
      contaContabil: txt('CONTA_CONTABIL'),
      periodoPcp: txt('PERIODO_PCP'),
      enviaLojaVarejo: Number(dados.ENVIA_LOJA_VAREJO) === 1,
      enviaLojaAtacado: Number(dados.ENVIA_LOJA_ATACADO) === 1,
    },
    cores,
    venda: toNumber(dados.VENDA),
    custo: toNumber(dados.CUSTO),
  };
}

/* ═══════════════════════════ gravação ═══════════════════════════ */

export interface CorProdutoNovo {
  cor: string;
  descCor: string;
}

export interface CodigoCriadoProdutoNovo {
  cor: string;
  descCor: string;
  tamanho: number;
  grade: string;
  interno: string;
  ean: string;
}

export interface ResultadoProdutoNovo {
  ensaio: boolean;
  lote: string | null;
  produto: string;
  descProduto: string;
  codigos: CodigoCriadoProdutoNovo[];
  /** Todas as tabelas de preço que o produto ficou tendo (as filhas vêm do trigger). */
  precos: Array<{ tabela: string; preco: number }>;
  custoReposicao: number | null;
  precoReposicao: number | null;
  avisos: string[];
}

interface SaidaRow {
  TIPO: string;
  COR: string | null;
  DESCR: string | null;
  TAMANHO: number | null;
  GRADE: string | null;
  TIPO_COD_BAR: number | null;
  CODIGO: string | null;
  TABELA: string | null;
  PRECO: number | null;
  PRECO2: number | null;
}

/** Chave de comparação de cor: '06' e '6' são a mesma cor no resto do sistema. */
function chaveCor(cor: string): string {
  const t = limpar(cor).toUpperCase();
  return /^\d+$/.test(t) ? String(Number(t)) : t;
}

function validarEntrada(params: {
  campos: CamposProdutoNovo;
  cores: CorProdutoNovo[];
  venda: unknown;
  custo: unknown;
}): {
  campos: CamposProdutoNovo;
  cores: CorProdutoNovo[];
  venda: string;
  custo: string;
} {
  const c = params.campos;
  const campos: CamposProdutoNovo = {
    ...c,
    grupo: limpar(c.grupo),
    subgrupo: limpar(c.subgrupo),
    descProduto: normalizarNome(c.descProduto),
    descProdNf: normalizarNome(c.descProdNf) || normalizarNome(c.descProduto),
    tipo: limpar(c.tipo),
    colecao: limpar(c.colecao).toUpperCase(),
    griffe: limpar(c.griffe),
    linha: limpar(c.linha),
    fabricante: limpar(c.fabricante),
    grade: limpar(c.grade),
    unidade: limpar(c.unidade).toUpperCase(),
    categoria: limpar(c.categoria),
    subcategoria: limpar(c.subcategoria),
    status: limpar(c.status),
    referFabricante: normalizarNome(c.referFabricante),
    empresa: toNumber(c.empresa),
    classifFiscal: limpar(c.classifFiscal).replace(/\./g, ''),
    idCestNcm: toNumber(c.idCestNcm),
    tributOrigem: limpar(c.tributOrigem),
    tributIcms: limpar(c.tributIcms),
    indicadorCfop: toNumber(c.indicadorCfop),
    tipoItemSped: limpar(c.tipoItemSped),
    contaContabil: limpar(c.contaContabil),
    periodoPcp: limpar(c.periodoPcp),
    enviaLojaVarejo: Boolean(c.enviaLojaVarejo),
    enviaLojaAtacado: Boolean(c.enviaLojaAtacado),
  };

  const obrigatorios: Array<[keyof CamposProdutoNovo, string]> = [
    ['grupo', 'grupo'],
    ['subgrupo', 'subgrupo'],
    ['descProduto', 'nome do produto'],
    ['tipo', 'tipo'],
    ['colecao', 'coleção'],
    ['griffe', 'griffe'],
    ['linha', 'linha'],
    ['fabricante', 'fabricante'],
    ['grade', 'grade (tamanhos)'],
    ['unidade', 'unidade'],
    ['status', 'status'],
    ['classifFiscal', 'classificação fiscal (NCM)'],
    ['tributOrigem', 'origem'],
    ['tributIcms', 'tributação ICMS'],
    ['tipoItemSped', 'item SPED'],
    ['contaContabil', 'conta contábil'],
  ];
  for (const [campo, nome] of obrigatorios) {
    if (!limpar(campos[campo])) throw new Error(`Preencha o campo ${nome}.`);
  }
  if (campos.empresa === null) throw new Error('Escolha a empresa do produto.');

  const limites: Array<[keyof CamposProdutoNovo, string, number]> = [
    ['descProduto', 'O nome do produto', 40],
    ['descProdNf', 'A descrição fiscal', 40],
    ['referFabricante', 'A referência do fabricante', 25],
  ];
  for (const [campo, nome, max] of limites) {
    const v = limpar(campos[campo]);
    if (v.length > max) throw new Error(`${nome} tem ${v.length} caracteres; o limite do Linx é ${max}.`);
  }

  if (Boolean(campos.categoria) !== Boolean(campos.subcategoria)) {
    throw new Error('Categoria e subcategoria andam juntas: escolha as duas ou deixe as duas vazias.');
  }

  const venda = parseDinheiro(params.venda);
  const custo = parseDinheiro(params.custo);
  if (!venda || Number(venda) <= 0) throw new Error('Informe o preço de venda.');
  if (!custo || Number(custo) <= 0) throw new Error('Informe o custo.');

  const vistos = new Set<string>();
  const cores: CorProdutoNovo[] = [];
  for (const item of params.cores ?? []) {
    const cor = limpar(item?.cor).toUpperCase();
    const descCor = normalizarNome(item?.descCor);
    if (!cor) continue;
    if (cor.length > 10) throw new Error(`O código da cor "${cor}" passa de 10 caracteres.`);
    if (!descCor) throw new Error(`Informe a descrição da cor ${cor}.`);
    if (descCor.length > 40) throw new Error(`A descrição da cor ${cor} passa de 40 caracteres.`);
    const k = chaveCor(cor);
    if (vistos.has(k)) throw new Error(`A cor ${cor} está repetida na lista.`);
    vistos.add(k);
    cores.push({ cor, descCor });
  }
  if (cores.length === 0) throw new Error('Escolha pelo menos uma cor.');
  if (cores.length > MAX_CORES) throw new Error(`No máximo ${MAX_CORES} cores por cadastro.`);

  return { campos, cores, venda, custo };
}

/**
 * Batch único, parametrizado — roda igual na conexão direta e via proxy (onde
 * cada requisição é isolada e não existe transação entre statements).
 *
 * Todas as strings são copiadas para variáveis TIPADAS logo no começo: o proxy
 * manda parâmetro string como NVARCHAR, e comparar coluna CHAR/VARCHAR com
 * NVARCHAR nesta collation mata o index seek — com UPDLOCK, isso vira lock na
 * tabela inteira (ver param-nvarchar-proxy-mata-index-seek).
 */
function montarBatch(qtdCores: number): string {
  const valoresCores = Array.from(
    { length: qtdCores },
    (_, i) => `(${i + 1}, @npC${i}, @npD${i})`
  ).join(', ');
  const valoresGrade = Array.from({ length: MAX_TAMANHOS }, (_, i) => `(${i + 1}, pt.TAMANHO_${i + 1})`).join(', ');

  return `
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY

  DECLARE @grupo VARCHAR(25) = @npGrupo, @subgrupo VARCHAR(25) = @npSubgrupo;
  DECLARE @desc VARCHAR(40) = @npDesc, @descNf VARCHAR(40) = @npDescNf;
  DECLARE @tipo VARCHAR(25) = @npTipo, @colecao CHAR(6) = @npColecao, @griffe VARCHAR(25) = @npGriffe;
  DECLARE @linha VARCHAR(25) = @npLinha, @fabricante VARCHAR(25) = @npFabricante;
  DECLARE @grade VARCHAR(25) = @npGrade, @unidade CHAR(5) = @npUnidade;
  DECLARE @categoria CHAR(6) = NULLIF(@npCategoria, ''), @subcategoria CHAR(6) = NULLIF(@npSubcategoria, '');
  DECLARE @status CHAR(2) = @npStatus, @refer VARCHAR(25) = @npRefer, @empresaProd INT = @npEmpresa;
  DECLARE @ncm CHAR(10) = @npNcm, @cest INT = @npCest, @origem CHAR(3) = @npOrigem, @icms CHAR(3) = @npIcms;
  DECLARE @cfop TINYINT = @npCfop, @sped CHAR(5) = @npSped, @conta VARCHAR(20) = @npConta;
  DECLARE @periodo VARCHAR(25) = NULLIF(@npPeriodo, '');
  DECLARE @enviaVarejo BIT = @npEnviaVarejo, @enviaAtacado BIT = @npEnviaAtacado;
  DECLARE @venda NUMERIC(14,2) = CAST(@npVenda AS NUMERIC(14,2)), @custo NUMERIC(14,2) = CAST(@npCusto AS NUMERIC(14,2));
  DECLARE @permitirRepetido BIT = @npPermitirRepetido, @ensaio BIT = @npEnsaio;
  -- Data do BANCO (horário de Brasília), não do servidor da aplicação.
  DECLARE @hoje DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);

  /* ── validações com nome ─────────────────────────────────────────────────
     Os triggers do Linx barrariam tudo isto, mas com "Impossível Incluir
     #PRODUTOS #porque #X #não existe" — ilegível para quem está cadastrando. */
  IF NOT EXISTS (SELECT 1 FROM PRODUTOS_TIPOS WHERE TIPO_PRODUTO = @tipo)
    BEGIN ;THROW 52010, 'O tipo escolhido não existe no cadastro de tipos do Linx.', 1; END
  IF NOT EXISTS (SELECT 1 FROM COLECOES WHERE COLECAO = @colecao)
    BEGIN ;THROW 52011, 'A coleção escolhida não existe no Linx.', 1; END
  IF NOT EXISTS (SELECT 1 FROM PRODUTOS_GRIFFES WHERE GRIFFE = @griffe)
    BEGIN ;THROW 52012, 'A griffe escolhida não existe no Linx.', 1; END
  IF NOT EXISTS (SELECT 1 FROM PRODUTOS_LINHAS WHERE LINHA = @linha)
    BEGIN ;THROW 52013, 'A linha escolhida não existe no Linx.', 1; END
  IF NOT EXISTS (SELECT 1 FROM FORNECEDORES WHERE FORNECEDOR = @fabricante)
    BEGIN ;THROW 52014, 'O fabricante escolhido não está no cadastro de fornecedores do Linx.', 1; END
  IF NOT EXISTS (SELECT 1 FROM PRODUTOS_TAMANHOS WHERE GRADE = @grade)
    BEGIN ;THROW 52015, 'A grade de tamanhos escolhida não existe no Linx.', 1; END
  IF NOT EXISTS (SELECT 1 FROM UNIDADES WHERE UNIDADE = @unidade)
    BEGIN ;THROW 52016, 'A unidade escolhida não existe no Linx.', 1; END
  IF NOT EXISTS (SELECT 1 FROM CLASSIF_FISCAL WHERE CLASSIF_FISCAL = @ncm)
    BEGIN ;THROW 52017, 'A classificação fiscal (NCM) não está cadastrada no Linx.', 1; END
  IF NOT EXISTS (SELECT 1 FROM TRIBUT_ORIGEM WHERE TRIBUT_ORIGEM = @origem)
    BEGIN ;THROW 52018, 'A origem da mercadoria não existe no Linx.', 1; END
  IF NOT EXISTS (SELECT 1 FROM TRIBUT_ICMS WHERE TRIBUT_ICMS = @icms)
    BEGIN ;THROW 52019, 'A tributação de ICMS não existe no Linx.', 1; END
  IF NOT EXISTS (SELECT 1 FROM PRODUTOS_STATUS WHERE STATUS_PRODUTO = @status)
    BEGIN ;THROW 52020, 'O status escolhido não existe no Linx.', 1; END
  IF NOT EXISTS (SELECT 1 FROM EMPRESA WHERE EMPRESA = @empresaProd)
    BEGIN ;THROW 52021, 'A empresa escolhida não existe no Linx.', 1; END
  IF NOT EXISTS (SELECT 1 FROM CTB_CONTA_PLANO WHERE CONTA_CONTABIL = @conta)
    BEGIN ;THROW 52022, 'A conta contábil não existe no plano de contas do Linx.', 1; END
  IF @cfop IS NOT NULL AND NOT EXISTS (SELECT 1 FROM CTB_LX_INDICADOR_CFOP WHERE INDICADOR_CFOP = @cfop)
    BEGIN ;THROW 52023, 'A característica contábil (indicador de CFOP) não existe no Linx.', 1; END
  IF @periodo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM PRODUTOS_PERIODOS_PCP WHERE PERIODO_PCP = @periodo)
    BEGIN ;THROW 52024, 'O período de entregas não existe no Linx.', 1; END
  IF @categoria IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM PRODUTOS_SUBCATEGORIA WHERE COD_CATEGORIA = @categoria AND COD_SUBCATEGORIA = @subcategoria)
    BEGIN ;THROW 52025, 'Essa subcategoria não pertence à categoria escolhida.', 1; END
  -- O CEST tem que ser um dos do NCM: CEST de outro NCM sai errado na nota.
  IF @cest IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM CEST_NCM cn JOIN TABELA_LX_NCM n ON n.ID = cn.ID_NCM
       WHERE cn.ID = @cest AND LTRIM(RTRIM(n.CODIGO_NCM)) = LTRIM(RTRIM(@ncm)))
    BEGIN ;THROW 52026, 'O CEST escolhido não pertence a esse NCM.', 1; END

  -- Mesmo nome = provável cadastro em dobro (inclusive duplo clique). A tela
  -- avisa antes; para seguir mesmo assim, o usuário confirma.
  IF @permitirRepetido = 0 AND EXISTS (SELECT 1 FROM PRODUTOS WITH (UPDLOCK, HOLDLOCK) WHERE DESC_PRODUTO = @desc)
    BEGIN ;THROW 52027, 'Já existe produto com esse nome no Linx. Confira na prévia e confirme se quer cadastrar outro com o mesmo nome.', 1; END

  /* ── 1) código ──────────────────────────────────────────────────────── */
  ${sqlProximoCodigo(true)}

  /* ── 2) a ficha (Dados 1, Dados 2, Complementos) ───────────────────────
     Campos técnicos = o que o ERP grava num produto novo (N4.8M.0018).
     Custo e preço de reposição nascem zerados: quem preenche é o trigger de
     PRODUTOS_PRECOS, no passo 4, a partir das tabelas de custo e padrão. */
  DECLARE @tipoStatus INT = (SELECT TOP 1 TIPO_STATUS_PRODUTO FROM PRODUTOS_STATUS WHERE STATUS_PRODUTO = @status);

  INSERT INTO PRODUTOS (
    PRODUTO, CODIGO_PRECO, PERIODO_PCP, FATOR_OPERACOES, CLASSIF_FISCAL, TIPO_PRODUTO, DESC_PRODUTO,
    GRUPO_PRODUTO, SUBGRUPO_PRODUTO, COLECAO, GRADE, DESC_PROD_NF, LINHA, GRIFFE, CARTELA, UNIDADE,
    PESO, REVENDA, REFER_FABRICANTE, SORTIMENTO_COR, FABRICANTE, SORTIMENTO_TAMANHO,
    VARIA_PRECO_COR, VARIA_PRECO_TAM, PONTEIRO_PRECO_TAM, VARIA_CUSTO_COR, PERTENCE_A_CONJUNTO,
    TRIBUT_ICMS, TRIBUT_ORIGEM, VARIA_CUSTO_TAM,
    CUSTO_REPOSICAO1, CUSTO_REPOSICAO2, CUSTO_REPOSICAO3, CUSTO_REPOSICAO4, DATA_REPOSICAO,
    ESTILISTA, MODELISTA, TAMANHO_BASE, GIRO_ENTREGA, INATIVO,
    ENVIA_LOJA_VAREJO, ENVIA_LOJA_ATACADO, ENVIA_REPRESENTANTE, ENVIA_VAREJO_INTERNET, ENVIA_ATACADO_INTERNET,
    FABRICANTE_ICMS_ABATER, FABRICANTE_PRAZO_PGTO, TAXA_JUROS_DEFLACIONAR, TAXAS_IMPOSTOS_APLICAR,
    PRECO_REPOSICAO_1, PRECO_REPOSICAO_2, PRECO_REPOSICAO_3, PRECO_REPOSICAO_4,
    PRECO_A_VISTA_REPOSICAO_1, PRECO_A_VISTA_REPOSICAO_2, PRECO_A_VISTA_REPOSICAO_3, PRECO_A_VISTA_REPOSICAO_4,
    FABRICANTE_FRETE, DATA_CADASTRAMENTO, STATUS_PRODUTO, TIPO_STATUS_PRODUTO, EMPRESA,
    CONTA_CONTABIL, CONTA_CONTABIL_COMPRA, CONTA_CONTABIL_VENDA, CONTA_CONTABIL_DEV_COMPRA, CONTA_CONTABIL_DEV_VENDA,
    ESPESSURA, ALTURA, LARGURA, COMPRIMENTO, EMPILHAMENTO_MAXIMO, VERSAO_FICHA, INDICADOR_CFOP, MONTAGEM_KIT,
    MRP_AGRUPAR_NECESSIDADE_DIAS, MRP_AGRUPAR_NECESSIDADE_TIPO, MRP_DIAS_SEGURANCA, MRP_EMISSAO_LIBERACAO_DIAS,
    -- MRP_FP e MRP_RR são colunas CALCULADAS (soma dos MRP_*_DIAS): não entram no INSERT.
    MRP_ENTREGA_GIRO_DIAS, MRP_PARTICIPANTE, MRP_MAIOR_GIRO_MP_DIAS,
    OP_POR_COR, OP_QTDE_MAXIMA, OP_QTDE_MINIMA, QUALIDADE, SEMI_ACABADO,
    FATOR_P, FATOR_Q, FATOR_F, CONTINUIDADE, COD_CATEGORIA, COD_SUBCATEGORIA, TIPO_ITEM_SPED,
    PERC_COMISSAO, ACEITA_ENCOMENDA, DIAS_GARANTIA_LOJA, DIAS_GARANTIA_FABRICANTE, POSSUI_MONTAGEM,
    POSSUI_GTIN, PERMITE_ENTREGA_FUTURA, LX_STATUS_REGISTRO, ARREDONDA, TIPO_PP, ID_CEST_NCM,
    DIAS_ACERTO_CONSIGNACAO, NAO_ENVIA_ETL, PRE_VENDA, FRETE_GRATIS, ESTOQUE_MINIMO, REPOSICAO_B2C,
    SUJEITO_SUBSTITUICAO_TRIBUTARIA, USA_RFID,
    -- PRODUTOS usa defaults VINCULADOS (sp_bindefault) do Linx: omitida, MODELAGEM
    -- vira ' ' e estoura a FK de PRODUTOS_MODELO. O ERP grava NULL explícito nestas.
    MODELAGEM, DROP_DE_TAMANHOS, SEXO_TIPO, PARTE_TIPO
  )
  VALUES (
    @produtoCh, '', @periodo, 1, @ncm, @tipo, @desc,
    @grupo, @subgrupo, @colecao, @grade, @descNf, @linha, @griffe, '', @unidade,
    0, 1, ISNULL(NULLIF(@refer, ''), ' '), 0, @fabricante, 0,
    0, 0, REPLICATE('1', 48), 0, 0,
    @icms, @origem, 0,
    0, 0, 0, 0, @hoje,
    ' ', ' ', 1, 0, 0,
    @enviaVarejo, @enviaAtacado, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, @hoje, @status, @tipoStatus, @empresaProd,
    @conta, @conta, @conta, @conta, @conta,
    0, 0, 0, 0, 0, '00001', @cfop, 0,
    0, 0, 0, 0,
    0, 0, 0,
    0, 0, 0, 1, 0,
    5, 5, 5, 1, @categoria, @subcategoria, @sped,
    0, 0, 0, 0, 0,
    1, 0, 0, 1, 2, @cest,
    0, 0, 0, 0, 0, 1,
    0, 0,
    NULL, NULL, NULL, NULL
  );

  -- O ERP grava o número usado de volta no subgrupo; é dele que o próximo sai.
  UPDATE PRODUTOS_SUBGRUPO SET CODIGO_SEQUENCIAL = @novoSeq
  WHERE GRUPO_PRODUTO = @grupo AND SUBGRUPO_PRODUTO = @subgrupo;

  /* ── 3) tamanhos da grade ─────────────────────────────────────────────── */
  DECLARE @tam TABLE (ORDEM INT IDENTITY(1,1), TAMANHO INT, GRADE VARCHAR(8));
  INSERT @tam (TAMANHO, GRADE)
  SELECT v.n, LEFT(LTRIM(RTRIM(CAST(v.t AS VARCHAR(20)))), 8)
  FROM PRODUTOS_TAMANHOS pt
  CROSS APPLY (VALUES ${valoresGrade}) v(n, t)
  WHERE pt.GRADE = @grade
    AND LTRIM(RTRIM(ISNULL(CAST(v.t AS VARCHAR(20)), ''))) <> ''
  ORDER BY v.n;
  IF NOT EXISTS (SELECT 1 FROM @tam) INSERT @tam (TAMANHO, GRADE) VALUES (1, 'U');

  /* ── 4) cores + um par de códigos (interno + EAN-13) por tamanho ─────── */
  DECLARE @cores TABLE (ORDEM INT, COR VARCHAR(10), DESCR VARCHAR(40));
  INSERT @cores (ORDEM, COR, DESCR) VALUES ${valoresCores};

  IF EXISTS (SELECT 1 FROM @cores c WHERE NOT EXISTS (SELECT 1 FROM CORES_BASICAS cb WHERE cb.COR = c.COR))
    BEGIN ;THROW 52030, 'Uma das cores escolhidas não existe no cadastro de cores do Linx (CORES_BASICAS).', 1; END

  DECLARE @prefixo VARCHAR(10);
  SELECT @prefixo = LTRIM(RTRIM(VALOR_ATUAL)) FROM PARAMETROS WHERE PARAMETRO = 'EAN_13';
  IF @prefixo IS NULL OR LEN(@prefixo) = 0
    BEGIN ;THROW 51006, 'PARAMETROS.EAN_13 (prefixo do código de barras) está vazio no Linx.', 1; END
  DECLARE @empresa INT = @empresaProd;

  DECLARE @corIdx INT = 0, @corTotal INT = (SELECT COUNT(*) FROM @cores);
  DECLARE @corCh CHAR(10), @corDesc VARCHAR(40);
  DECLARE @idx INT, @total INT = (SELECT COUNT(*) FROM @tam);
  ${SQL_DECLARAR_PAR_DE_CODIGOS}

  WHILE @corIdx < @corTotal
  BEGIN
    SET @corIdx += 1;
    SELECT @corCh = COR, @corDesc = DESCR FROM @cores WHERE ORDEM = @corIdx;

    -- STATUS_VENDA_ATUAL '1' + 1990-01-01/2099-12-31 é o padrão da tabela
    -- (30.893 das 30.895 linhas). Custo/preço entram pelo trigger de preço.
    INSERT INTO PRODUTO_CORES (
      PRODUTO, COR_PRODUTO, COR, DESC_COR_PRODUTO, STATUS_VENDA_ATUAL,
      INICIO_VENDAS, FIM_VENDAS, COR_SORTIDA, TINTURARIA_LAVAGEM, LX_STATUS_REGISTRO, SORTIMENTO_COR,
      CUSTO_REPOSICAO1, PRECO_REPOSICAO_1, PRECO_A_VISTA_REPOSICAO_1, CLASSIF_FISCAL, TRIBUT_ORIGEM
    )
    VALUES (@produtoCh, @corCh, @corCh, @corDesc, '1',
            '1990-01-01', '2099-12-31', 0, 0, 0, 0,
            0, 0, 0, @ncm, @origem);

    SET @idx = 0;
    WHILE @idx < @total
    BEGIN
      SET @idx += 1;
      SELECT @t = TAMANHO, @g = GRADE FROM @tam WHERE ORDEM = @idx;
      ${SQL_GRAVAR_PAR_DE_CODIGOS}
    END
  END

  /* ── 5) preços: venda na tabela padrão, custo na tabela de custo ───────
     Uma tabela por statement. O trigger LXI_PRODUTOS_PRECOS cria as filhas
     pelo % da base e grava custo/preço de reposição no produto e nas cores. */
  DECLARE @tabVenda CHAR(2) = (SELECT LEFT(LTRIM(RTRIM(VALOR_ATUAL)), 2) FROM PARAMETROS WHERE PARAMETRO = 'TABELA_PRECO_PADRAO');
  DECLARE @tabCusto CHAR(2) = (SELECT LEFT(LTRIM(RTRIM(VALOR_ATUAL)), 2) FROM PARAMETROS WHERE PARAMETRO = 'TABELA_PRECO_CUSTO');
  IF @tabVenda IS NULL OR @tabCusto IS NULL OR @tabVenda = @tabCusto
    BEGIN ;THROW 52040, 'PARAMETROS.TABELA_PRECO_PADRAO / TABELA_PRECO_CUSTO estão vazios ou iguais no Linx.', 1; END

  INSERT INTO PRODUTOS_PRECOS (
    CODIGO_TAB_PRECO, PRODUTO, PRECO1, PRECO2, PRECO3, PRECO4,
    PRECO_LIQUIDO1, PRECO_LIQUIDO2, PRECO_LIQUIDO3, PRECO_LIQUIDO4,
    LIMITE_DESCONTO, PROMOCAO_DESCONTO, ULT_ATUALIZACAO, MARK_UP_PREVISTO, PROMOCAO_ATACADO, LX_STATUS_REGISTRO
  )
  VALUES (@tabVenda, @produtoCh, @venda, 0, 0, 0, @venda, 0, 0, 0, 0, 0, @hoje, 0, 0, 0);

  -- Se a tabela de custo um dia virar filha da padrão, o trigger já a terá
  -- criado pelo %: aí o custo digitado CORRIGE a linha, como faria a tela.
  IF EXISTS (SELECT 1 FROM PRODUTOS_PRECOS WHERE PRODUTO = @produtoCh AND CODIGO_TAB_PRECO = @tabCusto)
    UPDATE PRODUTOS_PRECOS SET PRECO1 = @custo, PRECO_LIQUIDO1 = @custo, ULT_ATUALIZACAO = @hoje
    WHERE PRODUTO = @produtoCh AND CODIGO_TAB_PRECO = @tabCusto;
  ELSE
    INSERT INTO PRODUTOS_PRECOS (
      CODIGO_TAB_PRECO, PRODUTO, PRECO1, PRECO2, PRECO3, PRECO4,
      PRECO_LIQUIDO1, PRECO_LIQUIDO2, PRECO_LIQUIDO3, PRECO_LIQUIDO4,
      LIMITE_DESCONTO, PROMOCAO_DESCONTO, ULT_ATUALIZACAO, MARK_UP_PREVISTO, PROMOCAO_ATACADO, LX_STATUS_REGISTRO
    )
    VALUES (@tabCusto, @produtoCh, @custo, 0, 0, 0, @custo, 0, 0, 0, 0, 0, @hoje, 0, 0, 0);

  /* ── saída ──────────────────────────────────────────────────────────────
     Variável de tabela não é desfeita pelo ROLLBACK: é assim que o ENSAIO
     consegue devolver o que teria sido criado. */
  DECLARE @saida TABLE (
    TIPO VARCHAR(10), COR VARCHAR(10), DESCR VARCHAR(40), TAMANHO INT, GRADE VARCHAR(8),
    TIPO_COD_BAR INT, CODIGO VARCHAR(25), TABELA VARCHAR(2), PRECO NUMERIC(14,2), PRECO2 NUMERIC(14,2)
  );
  INSERT @saida
  SELECT 'PRODUTO', NULL, LTRIM(RTRIM(p.DESC_PRODUTO)), NULL, NULL, NULL, LTRIM(RTRIM(p.PRODUTO)), NULL,
         p.CUSTO_REPOSICAO1, p.PRECO_REPOSICAO_1
  FROM PRODUTOS p WHERE p.PRODUTO = @produtoCh;
  INSERT @saida
  SELECT 'BARRA', LTRIM(RTRIM(pb.COR_PRODUTO)), LTRIM(RTRIM(pc.DESC_COR_PRODUTO)), pb.TAMANHO, LTRIM(RTRIM(pb.GRADE)),
         pb.TIPO_COD_BAR, LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(25)))), NULL, NULL, NULL
  FROM PRODUTOS_BARRA pb
  JOIN PRODUTO_CORES pc ON pc.PRODUTO = pb.PRODUTO AND pc.COR_PRODUTO = pb.COR_PRODUTO
  WHERE pb.PRODUTO = @produtoCh;
  INSERT @saida
  SELECT 'PRECO', NULL, NULL, NULL, NULL, NULL, NULL, LTRIM(RTRIM(pp.CODIGO_TAB_PRECO)), pp.PRECO1, pp.PRECO_LIQUIDO1
  FROM PRODUTOS_PRECOS pp WHERE pp.PRODUTO = @produtoCh;

  IF @ensaio = 1 ROLLBACK; ELSE COMMIT;

  SELECT TIPO, COR, DESCR, TAMANHO, GRADE, TIPO_COD_BAR, CODIGO, TABELA, PRECO, PRECO2
  FROM @saida
  ORDER BY CASE TIPO WHEN 'PRODUTO' THEN 0 WHEN 'BARRA' THEN 1 ELSE 2 END, COR, TAMANHO, TIPO_COD_BAR, TABELA;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  ;THROW;
END CATCH`;
}

function interpretarSaida(rows: SaidaRow[]): Omit<ResultadoProdutoNovo, 'ensaio' | 'lote' | 'avisos'> {
  const cab = rows.find((r) => r.TIPO === 'PRODUTO');
  const porChave = new Map<string, CodigoCriadoProdutoNovo>();
  for (const row of rows.filter((r) => r.TIPO === 'BARRA')) {
    const cor = limpar(row.COR);
    const tamanho = Number(row.TAMANHO) || 1;
    const k = `${cor}|${tamanho}`;
    const atual = porChave.get(k) ?? {
      cor,
      descCor: limpar(row.DESCR),
      tamanho,
      grade: limpar(row.GRADE),
      interno: '',
      ean: '',
    };
    const codigo = limpar(row.CODIGO);
    if (Number(row.TIPO_COD_BAR) === 1 || /^\d{13}$/.test(codigo)) atual.ean = codigo;
    else atual.interno = codigo;
    porChave.set(k, atual);
  }
  return {
    produto: limpar(cab?.CODIGO),
    descProduto: limpar(cab?.DESCR),
    codigos: [...porChave.values()],
    precos: rows
      .filter((r) => r.TIPO === 'PRECO')
      .map((r) => ({ tabela: limpar(r.TABELA), preco: Number(r.PRECO ?? 0) || 0 })),
    custoReposicao: toNumber(cab?.PRECO),
    precoReposicao: toNumber(cab?.PRECO2),
  };
}

/**
 * Cria o produto no Linx: ficha + cores + códigos de barra + preços, num batch
 * atômico. Fluxo da casa: valida → grava → RELÊ do banco → só então registra no
 * histórico de cadastro. Com `ensaio`, roda tudo e desfaz (nada fica gravado,
 * nem os sequenciais — o UPDATE em SEQUENCIAIS está na mesma transação).
 */
export async function criarProdutoNovo(params: {
  company: ProdutoNovoCompany;
  usuario: string;
  campos: CamposProdutoNovo;
  cores: CorProdutoNovo[];
  venda: unknown;
  custo: unknown;
  permitirNomeRepetido?: boolean;
  ensaio?: boolean;
  obs?: string | null;
}): Promise<ResultadoProdutoNovo> {
  const { campos, cores, venda, custo } = validarEntrada(params);
  const ensaio = Boolean(params.ensaio);

  const rows = await withRequest(async (request) => {
    request.input('npGrupo', sql.VarChar, campos.grupo);
    request.input('npSubgrupo', sql.VarChar, campos.subgrupo);
    request.input('npDesc', sql.VarChar, campos.descProduto);
    request.input('npDescNf', sql.VarChar, campos.descProdNf);
    request.input('npTipo', sql.VarChar, campos.tipo);
    request.input('npColecao', sql.VarChar, campos.colecao);
    request.input('npGriffe', sql.VarChar, campos.griffe);
    request.input('npLinha', sql.VarChar, campos.linha);
    request.input('npFabricante', sql.VarChar, campos.fabricante);
    request.input('npGrade', sql.VarChar, campos.grade);
    request.input('npUnidade', sql.VarChar, campos.unidade);
    request.input('npCategoria', sql.VarChar, campos.categoria);
    request.input('npSubcategoria', sql.VarChar, campos.subcategoria);
    request.input('npStatus', sql.VarChar, campos.status);
    request.input('npRefer', sql.VarChar, campos.referFabricante);
    request.input('npEmpresa', sql.Int, campos.empresa);
    request.input('npNcm', sql.VarChar, campos.classifFiscal);
    request.input('npCest', sql.Int, campos.idCestNcm);
    request.input('npOrigem', sql.VarChar, campos.tributOrigem);
    request.input('npIcms', sql.VarChar, campos.tributIcms);
    request.input('npCfop', sql.Int, campos.indicadorCfop);
    request.input('npSped', sql.VarChar, campos.tipoItemSped);
    request.input('npConta', sql.VarChar, campos.contaContabil);
    request.input('npPeriodo', sql.VarChar, campos.periodoPcp);
    request.input('npEnviaVarejo', sql.Int, campos.enviaLojaVarejo ? 1 : 0);
    request.input('npEnviaAtacado', sql.Int, campos.enviaLojaAtacado ? 1 : 0);
    request.input('npVenda', sql.VarChar, venda);
    request.input('npCusto', sql.VarChar, custo);
    request.input('npPermitirRepetido', sql.Int, params.permitirNomeRepetido ? 1 : 0);
    request.input('npEnsaio', sql.Int, ensaio ? 1 : 0);
    cores.forEach((c, i) => {
      request.input(`npC${i}`, sql.VarChar, c.cor);
      request.input(`npD${i}`, sql.VarChar, c.descCor);
    });
    try {
      const r = await request.query<SaidaRow>(montarBatch(cores.length));
      return r.recordset;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // 51xxx/52xxx são os THROW deste batch (e do fragmento de códigos): já
      // vêm escritos para quem está cadastrando.
      const numero = Number((error as { number?: unknown })?.number);
      if (numero >= 51000 && numero < 53000) throw new Error(msg);
      if (/PRIMARY KEY|duplicate key|UNIQUE KEY/i.test(msg)) {
        throw new Error(
          'Conflito ao gravar no Linx (o código do produto ou um código de barra acabou de ser usado por outra pessoa). Nada foi criado — tente de novo.'
        );
      }
      throw new Error(`Falha ao cadastrar o produto no Linx: ${msg}`);
    }
  });

  const saida = interpretarSaida(rows ?? []);
  if (!saida.produto) {
    throw new Error('O banco não devolveu o produto criado. Confira no Linx antes de tentar de novo.');
  }

  const avisos: string[] = [];
  if (ensaio) {
    avisos.push('Ensaio: o batch rodou inteiro no Linx e foi desfeito — nada foi gravado.');
    return { ensaio, lote: null, avisos, ...saida };
  }

  // Releitura fora da transação: só acreditamos no que o banco devolve depois do COMMIT.
  const confirmadas = await withRequest(async (request) => {
    request.input('cfProduto', sql.VarChar, saida.produto);
    const r = await request.query<{ BARRAS: number; CORES: number; PRECOS: number }>(`
      SET NOCOUNT ON;
      DECLARE @produto CHAR(12) = @cfProduto;
      SELECT (SELECT COUNT(*) FROM PRODUTOS_BARRA WITH (NOLOCK) WHERE PRODUTO = @produto) AS BARRAS,
             (SELECT COUNT(*) FROM PRODUTO_CORES WITH (NOLOCK) WHERE PRODUTO = @produto) AS CORES,
             (SELECT COUNT(*) FROM PRODUTOS_PRECOS WITH (NOLOCK) WHERE PRODUTO = @produto) AS PRECOS
      FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @produto
    `);
    return r.recordset[0] ?? null;
  });
  if (!confirmadas) {
    throw new Error(
      `O banco não confirmou o produto ${saida.produto}. Nada foi registrado no histórico — confira no Linx antes de tentar de novo.`
    );
  }

  const semPar = saida.codigos.filter((c) => !c.interno || !c.ean);
  if (semPar.length > 0) {
    avisos.push(`Atenção: ${semPar.length} cor/tamanho ficaram sem o par completo de códigos (interno + EAN). Confira no Linx.`);
  }
  if (saida.custoReposicao !== Number(custo)) {
    avisos.push('O custo de reposição do produto não ficou igual ao custo digitado — confira a aba Controle de Custo no Linx.');
  }
  avisos.push(
    'Cadastro não tem desfazer automático. Se foi engano, ajuste em Alterar Cadastro ou exclua no Linx antes de o produto receber estoque ou venda.'
  );

  const linhas: LinhaHistoricoCadastro[] = [
    {
      escopo: 'PRODUTO',
      acao: 'CRIAR',
      dimensao: null,
      alvo: saida.produto,
      chave: saida.produto,
      pai: `${campos.grupo} / ${campos.subgrupo}`.slice(0, 60),
      campo: 'Produto novo',
      anterior: null,
      novo:
        `${saida.descProduto} — ${cores.length} cor(es), ${confirmadas.BARRAS} código(s) de barra, ` +
        `${confirmadas.PRECOS} tabela(s) de preço · venda R$ ${venda} · custo R$ ${custo}`,
      produtos: 1,
    },
    ...cores.map((c) => {
      const doCor = saida.codigos.filter((x) => x.cor === c.cor);
      return {
        escopo: 'PRODUTO' as const,
        acao: 'CRIAR' as const,
        dimensao: null,
        alvo: saida.produto,
        chave: `${saida.produto}|${c.cor}`,
        pai: null,
        campo: 'Cor do produto',
        anterior: null,
        novo: `${c.cor} ${c.descCor} — ${doCor.map((x) => `${x.grade || x.tamanho}: ${x.interno}/${x.ean}`).join(' · ')}`,
        produtos: 1,
      };
    }),
  ];

  const lote = await registrarHistoricoCadastro({
    company: params.company,
    usuario: params.usuario,
    obs: params.obs ?? 'Produto cadastrado pela tela Cadastrar Produto',
    linhas,
  });

  return { ensaio, lote, avisos, ...saida };
}

