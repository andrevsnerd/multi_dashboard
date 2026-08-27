import 'server-only';

/**
 * Impressão de Etiquetas — leitura do cadastro (nunca escreve nada).
 *
 * A tela procura produtos e traz TODAS as cores cadastradas de cada um, com o
 * código de barra preferencial (o MENOR/interno, não o EAN grande) — a mesma
 * regra canônica de `fetchMenorCodigoBarra` em products.ts. Também devolve o
 * EAN alternativo, porque a configuração da etiqueta permite trocar a
 * simbologia para EAN-13.
 */

import { query } from '@/lib/db/connection';

export type EtiquetaCompany = 'nerd' | 'scarfme';

/** PRODUTOS.EMPRESA por empresa do dashboard — mesmo mapa de precos.ts. */
const EMPRESA_CODES: Record<EtiquetaCompany, number[]> = {
  nerd: [8],
  scarfme: [1, 10, 13, 15, 16],
};

function esc(value: string): string {
  return (value ?? '').replace(/'/g, "''");
}

/**
 * Literal para LIKE: os curingas do usuário (%, _, [) viram texto puro, senão
 * um código com "_" casaria com qualquer coisa.
 */
function escLike(value: string): string {
  return esc(value)
    .replace(/\[/g, '[[]')
    .replace(/%/g, '[%]')
    .replace(/_/g, '[_]');
}

/**
 * Comparação sem acento e sem caixa — quem digita "ALCA BASIC" tem que achar
 * "ALÇA BASIC III". O banco é ..._CI_AS (sensível a acento).
 */
const COL = 'COLLATE Latin1_General_CI_AI';

/**
 * Descrição do cadastro com os espaços repetidos colapsados.
 *
 * O cadastro do Linx tem MUITOS nomes com espaço duplo no meio
 * ("CP COURO  MAGSAFE SG S25 ULTRA", 95 produtos ativos na NERD e 148 na
 * ScarfMe) — quem digita o nome como aparece na tela (um espaço só) nunca
 * achava o produto. Quatro passadas colapsam até 16 espaços seguidos.
 */
function descNormalizada(alias = 'p'): string {
  let expr = `LTRIM(RTRIM(ISNULL(${alias}.DESC_PRODUTO, '')))`;
  for (let i = 0; i < 4; i += 1) expr = `REPLACE(${expr}, '  ', ' ')`;
  return expr;
}

/** Termo quebrado em palavras (o mesmo colapso de espaços do lado do cadastro). */
function palavrasDoTermo(termo: string): string[] {
  return (termo ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * Condição de "o produto casa com o que foi digitado".
 *
 * Casa por código, por código de barra ou pelo nome — e o nome casa PALAVRA A
 * PALAVRA (todas presentes, em qualquer ordem), o que resolve de uma vez os
 * espaços duplos do cadastro e a busca fora de ordem ("magsafe couro s25").
 */
function condicaoTermo(termo: string, alias = 'p'): string {
  const t = (termo ?? '').trim();
  const tEsc = esc(t);
  const tLike = escLike(t);
  // Só trate o termo como código de barras quando ele for realmente numérico.
  // Remover pontuação de um código de produto como "D4.14.15" gerava "41415"
  // e podia fazê-lo casar com a barra "041415" de outro produto.
  const soDigitos = /^\d+$/.test(t) ? t : '';
  const desc = descNormalizada(alias);
  const palavras = palavrasDoTermo(t);

  const condicoes: string[] = [
    `LTRIM(RTRIM(${alias}.PRODUTO)) = '${tEsc}'`,
    `LTRIM(RTRIM(${alias}.PRODUTO)) ${COL} LIKE '${tLike}%'`,
  ];

  // Pedaço do código ("03.0012") — só quando o termo é uma palavra só, senão
  // uma frase inteira nunca casaria com um código e é varredura à toa.
  if (palavras.length === 1) {
    condicoes.push(`LTRIM(RTRIM(${alias}.PRODUTO)) ${COL} LIKE '%${tLike}%'`);
  }

  if (palavras.length > 0) {
    const todasAsPalavras = palavras
      .map((p) => `${desc} ${COL} LIKE '%${escLike(p)}%'`)
      .join(' AND ');
    condicoes.push(`(${todasAsPalavras})`);
  }

  // Código de barra: exato ou numericamente igual (leitor às vezes come o zero
  // à esquerda). 4 dígitos é o piso para não varrer a tabela à toa.
  if (soDigitos.length >= 4) {
    condicoes.push(`EXISTS (
      SELECT 1 FROM PRODUTOS_BARRA pb WITH (NOLOCK)
      WHERE pb.PRODUTO = ${alias}.PRODUTO
        AND (
          LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) = '${tEsc}'
          OR TRY_CONVERT(BIGINT, LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))) = TRY_CONVERT(BIGINT, '${esc(soDigitos)}')
        )
    )`);
  }

  return `(${condicoes.join(' OR ')})`;
}

/**
 * Escada de relevância — barra exata, código exato, nome exato, começa com,
 * contém, palavras soltas. Compara sempre com a descrição normalizada, senão o
 * espaço duplo joga o produto certo para o fim da fila.
 */
function ordemRelevancia(termo: string, alias = 'p', desempate = ''): string {
  const t = (termo ?? '').trim();
  const tEsc = esc(t);
  const tLike = escLike(t);
  const desc = descNormalizada(alias);
  const palavras = palavrasDoTermo(t);
  // Termo com os espaços colapsados, para casar com a descrição normalizada.
  const frase = escLike(palavras.join(' '));

  return `
    CASE
      WHEN LTRIM(RTRIM(${alias}.PRODUTO)) = '${tEsc}' THEN 0
      WHEN ${desc} ${COL} = '${esc(palavras.join(' '))}' THEN 1
      WHEN ${desc} ${COL} LIKE '${frase}%' THEN 2
      WHEN ${desc} ${COL} LIKE '% ${frase}%' THEN 3
      WHEN LTRIM(RTRIM(${alias}.PRODUTO)) ${COL} LIKE '${tLike}%' THEN 4
      WHEN ${desc} ${COL} LIKE '%${frase}%' THEN 5
      ELSE 6
    END,
    LEN(${desc}),
    ${desempate ? `${desempate},` : ''}
    ${desc}
  `;
}

export interface CorEtiqueta {
  /** COR_PRODUTO cru do ERP ('' quando o produto não tem cor). */
  cor: string;
  descCor: string;
  /** Código preferencial (interno curto). '' quando não há. */
  codigoBarra: string;
  /** EAN-13 do mesmo produto×cor, quando existe. */
  ean: string;
  /** Todos os códigos cadastrados (para o usuário escolher outro, se quiser). */
  codigos: string[];
  /** Soma dos saldos positivos na empresa — só informativo, ajuda a decidir a qtd. */
  estoque: number;
}

export interface ProdutoEtiqueta {
  produto: string;
  descProduto: string;
  grupo: string;
  subgrupo: string;
  linha: string;
  colecao: string;
  grade: string;
  tipo: string;
  inativo: boolean;
  cores: CorEtiqueta[];
}

interface ProdutoRow {
  PRODUTO: string;
  DESC_PRODUTO: string;
  GRUPO: string;
  SUBGRUPO: string;
  LINHA: string;
  COLECAO: string;
  GRADE: string;
  TIPO: string;
  INATIVO: number | null;
}

interface BarraRow {
  PRODUTO: string;
  COR: string;
  CODIGO_BARRA: string;
  TIPO_COD_BAR: string | null;
  INATIVO: number | null;
}

interface CorRow {
  PRODUTO: string;
  COR: string;
  DESC_COR: string;
}

interface EstoqueRow {
  PRODUTO: string;
  COR: string;
  ESTOQUE: number;
}

/**
 * 0 = produto está na EMPRESA da empresa do dashboard, 1 = está em outra.
 *
 * PRODUTOS.EMPRESA NÃO é o dono do produto — é resíduo fiscal do cadastro. Boa
 * parte do catálogo NERD mora em EMPRESA=1 (só de ELETRONICOS/CAPAS são ~1.100
 * ativos, entre eles "CP BASIC IP13"), e a ScarfMe tem itens em EMPRESA=8. Usar
 * isso como filtro sumia com o produto certo justamente em quem digita o nome
 * curto; então aqui ele só desempata a ordenação e vira a tag "outra empresa".
 */
function foraDoEscopo(company: EtiquetaCompany, alias = 'p'): string {
  const codes = EMPRESA_CODES[company] ?? [];
  if (codes.length === 0) return '0';
  return `CASE WHEN ${alias}.EMPRESA IN (${codes.join(', ')}) THEN 0 ELSE 1 END`;
}

/**
 * Ranking canônico do código "menor": TIPO_COD_BAR=3 → códigos curtos (<=8) →
 * TIPO_COD_BAR=1 → resto. Empata pelo próprio código.
 */
function pesoDoCodigo(row: BarraRow): number {
  const tipo = (row.TIPO_COD_BAR ?? '').toString().trim();
  const codigo = (row.CODIGO_BARRA ?? '').trim();
  if (tipo === '3') return 0;
  if (codigo.length <= 8) return 1;
  if (tipo === '1') return 2;
  return 3;
}

/** Linha do autocomplete — leve de propósito (não traz as cores todas). */
export interface SugestaoProduto {
  produto: string;
  descProduto: string;
  subgrupo: string;
  inativo: boolean;
  /** Quantas cores o produto tem cadastradas. */
  totalCores: number;
  /** Quando o termo casou com um código de barra, qual cor era. */
  corEncontrada: string | null;
  descCorEncontrada: string | null;
  codigoEncontrado: string | null;
  /** Cadastrado em outra PRODUTOS.EMPRESA — informativo, por linha. */
  foraDoCatalogo?: boolean;
}

interface SugestaoRow {
  PRODUTO: string;
  DESC_PRODUTO: string;
  SUBGRUPO: string;
  INATIVO: number | null;
  TOTAL_CORES: number;
  COR: string | null;
  DESC_COR: string | null;
  CODIGO: string | null;
  FORA_ESCOPO: number | null;
}

/**
 * Sugestões enquanto o usuário digita (nome, código ou código de barra).
 *
 * A busca é do CADASTRO puro: não olha estoque, não olha venda. O nome casa
 * palavra a palavra (ver `condicaoTermo`), sem acento e sem caixa, e a
 * PRODUTOS.EMPRESA só desempata a ordenação (ver `foraDoEscopo`) — nada some da
 * lista por causa dela.
 */
export async function buscarSugestoesProduto(
  company: EtiquetaCompany,
  termo: string,
  opts: { limite?: number; incluirInativos?: boolean } = {}
): Promise<SugestaoProduto[]> {
  const t = (termo ?? '').trim();
  if (t.length < 2) return [];

  const limite = Math.min(50, Math.max(1, opts.limite ?? 30));
  const tEsc = esc(t);
  const soDigitos = /^\d+$/.test(t) ? t : '';
  const inativos = opts.incluirInativos ? '' : 'AND ISNULL(p.INATIVO, 0) = 0';

  // Código de barras identifica uma variação inteira: nunca deve casar por
  // trecho. Ex.: 053199 não pode sugerir o EAN 7898586053199. Mantemos apenas
  // a equivalência numérica usada na busca principal para tolerar zero inicial
  // omitido pelo leitor.
  const condicaoBarra = [
    `LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) = '${tEsc}'`,
    ...(soDigitos.length >= 4
      ? [
          `TRY_CONVERT(BIGINT, LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))) = TRY_CONVERT(BIGINT, '${esc(soDigitos)}')`,
        ]
      : []),
  ].join(' OR ');

  const escopo = foraDoEscopo(company);

  const sql = `
    SELECT TOP ${limite}
      LTRIM(RTRIM(p.PRODUTO)) AS PRODUTO,
      LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, ''))) AS DESC_PRODUTO,
      LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, ''))) AS SUBGRUPO,
      ISNULL(p.INATIVO, 0) AS INATIVO,
      ISNULL(cores.TOTAL, 0) AS TOTAL_CORES,
      barra.COR_PRODUTO AS COR,
      cor.DESC_COR AS DESC_COR,
      barra.CODIGO_BARRA AS CODIGO,
      ${escopo} AS FORA_ESCOPO
    FROM PRODUTOS p WITH (NOLOCK)
    OUTER APPLY (
      SELECT TOP 1
        LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) AS CODIGO_BARRA,
        LTRIM(RTRIM(ISNULL(CAST(pb.COR_PRODUTO AS VARCHAR(20)), ''))) AS COR_PRODUTO
      FROM PRODUTOS_BARRA pb WITH (NOLOCK)
      WHERE pb.PRODUTO = p.PRODUTO
        AND pb.CODIGO_BARRA IS NOT NULL
        AND (${condicaoBarra})
      ORDER BY
        CASE WHEN LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) = '${tEsc}' THEN 0 ELSE 1 END,
        LEN(LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))),
        pb.CODIGO_BARRA
    ) barra
    -- Total de cores = cadastro de cores UNIÃO cores que têm código de barra,
    -- exatamente o que a tela mostra quando o produto abre.
    OUTER APPLY (
      SELECT COUNT(*) AS TOTAL FROM (
        SELECT DISTINCT LTRIM(RTRIM(ISNULL(CAST(pc.COR_PRODUTO AS VARCHAR(20)), ''))) AS COR
        FROM PRODUTO_CORES pc WITH (NOLOCK)
        WHERE pc.PRODUTO = p.PRODUTO
        UNION
        SELECT DISTINCT LTRIM(RTRIM(ISNULL(CAST(pb2.COR_PRODUTO AS VARCHAR(20)), ''))) AS COR
        FROM PRODUTOS_BARRA pb2 WITH (NOLOCK)
        WHERE pb2.PRODUTO = p.PRODUTO
      ) u
    ) cores
    OUTER APPLY (
      SELECT TOP 1 LTRIM(RTRIM(ISNULL(pc.DESC_COR_PRODUTO, ''))) AS DESC_COR
      FROM PRODUTO_CORES pc WITH (NOLOCK)
      WHERE pc.PRODUTO = p.PRODUTO
        AND (
          LTRIM(RTRIM(CAST(pc.COR_PRODUTO AS VARCHAR(20)))) = barra.COR_PRODUTO
          OR TRY_CONVERT(INT, pc.COR_PRODUTO) = TRY_CONVERT(INT, barra.COR_PRODUTO)
        )
    ) cor
    WHERE (${condicaoTermo(t)} OR barra.CODIGO_BARRA IS NOT NULL)
      ${inativos}
    ORDER BY
      CASE WHEN barra.CODIGO_BARRA = '${tEsc}' THEN 0 ELSE 1 END,
      ${ordemRelevancia(t, 'p', escopo)}
  `;

  const rows = await query<SugestaoRow>(sql);

  return rows.map((r) => ({
    produto: (r.PRODUTO ?? '').trim(),
    descProduto: (r.DESC_PRODUTO ?? '').trim(),
    subgrupo: (r.SUBGRUPO ?? '').trim(),
    inativo: Number(r.INATIVO ?? 0) !== 0,
    totalCores: Number(r.TOTAL_CORES) || 0,
    corEncontrada: (r.COR ?? '').trim() || null,
    descCorEncontrada: (r.DESC_COR ?? '').trim() || null,
    codigoEncontrado: (r.CODIGO ?? '').trim() || null,
    foraDoCatalogo: Number(r.FORA_ESCOPO ?? 0) !== 0,
  }));
}

/**
 * Busca produtos pelo termo (código, descrição ou código de barra) e monta
 * produto → cores. `limite` corta a quantidade de produtos, não de cores.
 *
 * `todoCadastro` não faz mais diferença: a busca já cobre o cadastro inteiro e
 * a EMPRESA só desempata a ordem (ver `foraDoEscopo`). Fica na assinatura só
 * porque a rota e o modal de custo ainda mandam a flag.
 */
export async function buscarProdutosParaEtiqueta(
  company: EtiquetaCompany,
  termo: string,
  opts: { limite?: number; incluirInativos?: boolean; todoCadastro?: boolean } = {}
): Promise<ProdutoEtiqueta[]> {
  const t = (termo ?? '').trim();
  if (t.length < 2) return [];

  const limite = Math.min(200, Math.max(1, opts.limite ?? 60));
  const tEsc = esc(t);
  const inativos = opts.incluirInativos ? '' : 'AND ISNULL(p.INATIVO, 0) = 0';
  const escopo = foraDoEscopo(company);

  // 1) Produtos que casam com o termo (código, nome palavra a palavra ou barra).
  const sql = `
    SELECT TOP ${limite}
      LTRIM(RTRIM(p.PRODUTO)) AS PRODUTO,
      LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, ''))) AS DESC_PRODUTO,
      LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, ''))) AS GRUPO,
      LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, ''))) AS SUBGRUPO,
      LTRIM(RTRIM(ISNULL(p.LINHA, ''))) AS LINHA,
      LTRIM(RTRIM(COALESCE(NULLIF(LTRIM(RTRIM(col.DESC_COLECAO)), ''), CONVERT(VARCHAR(50), p.COLECAO), ''))) AS COLECAO,
      LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR(50), p.GRADE), ''))) AS GRADE,
      LTRIM(RTRIM(ISNULL(p.TIPO_PRODUTO, ''))) AS TIPO,
      ISNULL(p.INATIVO, 0) AS INATIVO
    FROM PRODUTOS p WITH (NOLOCK)
    -- Descrição da coleção vem de COLECOES (fonte mestre); PRODUTOS guarda só o código.
    LEFT JOIN COLECOES col WITH (NOLOCK) ON col.COLECAO = p.COLECAO
    WHERE ${condicaoTermo(t)}
      ${inativos}
    ORDER BY
      CASE WHEN LTRIM(RTRIM(p.PRODUTO)) = '${tEsc}' THEN 0 ELSE 1 END,
      ${ordemRelevancia(t, 'p', escopo)}
  `;

  const produtos = await query<ProdutoRow>(sql);

  if (produtos.length === 0) return [];

  const ids = produtos.map((p) => p.PRODUTO.trim()).filter(Boolean);
  const inList = ids.map((p) => `'${esc(p)}'`).join(',');

  // 2) Códigos de barra (todos) e descrições de cor.
  const [barras, cores, estoques] = await Promise.all([
    query<BarraRow>(`
      SELECT LTRIM(RTRIM(pb.PRODUTO)) AS PRODUTO,
             LTRIM(RTRIM(ISNULL(CAST(pb.COR_PRODUTO AS VARCHAR(20)), ''))) AS COR,
             LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) AS CODIGO_BARRA,
             LTRIM(RTRIM(CAST(pb.TIPO_COD_BAR AS VARCHAR(10)))) AS TIPO_COD_BAR,
             ISNULL(pb.INATIVO, 0) AS INATIVO
      FROM PRODUTOS_BARRA pb WITH (NOLOCK)
      WHERE pb.PRODUTO IN (${inList})
        AND pb.CODIGO_BARRA IS NOT NULL
        AND LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) <> ''
    `),
    query<CorRow>(`
      SELECT LTRIM(RTRIM(PRODUTO)) AS PRODUTO,
             LTRIM(RTRIM(ISNULL(CAST(COR_PRODUTO AS VARCHAR(20)), ''))) AS COR,
             MAX(LTRIM(RTRIM(ISNULL(DESC_COR_PRODUTO, '')))) AS DESC_COR
      FROM PRODUTO_CORES WITH (NOLOCK)
      WHERE PRODUTO IN (${inList})
      GROUP BY LTRIM(RTRIM(PRODUTO)), LTRIM(RTRIM(ISNULL(CAST(COR_PRODUTO AS VARCHAR(20)), '')))
    `),
    query<EstoqueRow>(`
      SELECT LTRIM(RTRIM(ep.PRODUTO)) AS PRODUTO,
             LTRIM(RTRIM(ISNULL(CAST(ep.COR_PRODUTO AS VARCHAR(20)), ''))) AS COR,
             SUM(CASE WHEN ep.ESTOQUE > 0 THEN ep.ESTOQUE ELSE 0 END) AS ESTOQUE
      FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
      WHERE ep.PRODUTO IN (${inList})
      GROUP BY LTRIM(RTRIM(ep.PRODUTO)), LTRIM(RTRIM(ISNULL(CAST(ep.COR_PRODUTO AS VARCHAR(20)), '')))
    `),
  ]);

  // Índice de cor tolerante ao formato: '06' e '6' são a mesma cor no ERP.
  const chaveCor = (produto: string, cor: string) => {
    const c = (cor ?? '').trim();
    const num = Number(c);
    const normal = c !== '' && Number.isFinite(num) ? String(num) : c.toUpperCase();
    return `${produto.trim()}|${normal}`;
  };

  const descPorCor = new Map<string, string>();
  for (const c of cores) {
    const desc = (c.DESC_COR ?? '').trim();
    if (!desc) continue;
    descPorCor.set(chaveCor(c.PRODUTO, c.COR), desc);
  }

  const estoquePorCor = new Map<string, number>();
  for (const e of estoques) {
    const chave = chaveCor(e.PRODUTO, e.COR);
    estoquePorCor.set(chave, (estoquePorCor.get(chave) ?? 0) + (Number(e.ESTOQUE) || 0));
  }

  // 3) Agrupa os códigos por produto×cor e escolhe o preferencial.
  const porProdutoCor = new Map<string, BarraRow[]>();
  for (const b of barras) {
    const chave = chaveCor(b.PRODUTO, b.COR);
    const lista = porProdutoCor.get(chave);
    if (lista) lista.push(b);
    else porProdutoCor.set(chave, [b]);
  }

  const saida: ProdutoEtiqueta[] = [];
  for (const p of produtos) {
    const produto = p.PRODUTO.trim();

    // Cores do produto = união do cadastro de cores com o que tem código de barra.
    const chavesDoProduto = new Set<string>();
    const corCrua = new Map<string, string>(); // chave normalizada -> COR_PRODUTO cru
    for (const c of cores) {
      if (c.PRODUTO.trim() !== produto) continue;
      const chave = chaveCor(produto, c.COR);
      chavesDoProduto.add(chave);
      if (!corCrua.has(chave)) corCrua.set(chave, (c.COR ?? '').trim());
    }
    for (const b of barras) {
      if (b.PRODUTO.trim() !== produto) continue;
      const chave = chaveCor(produto, b.COR);
      chavesDoProduto.add(chave);
      if (!corCrua.has(chave)) corCrua.set(chave, (b.COR ?? '').trim());
    }

    const coresDoProduto: CorEtiqueta[] = [];
    for (const chave of chavesDoProduto) {
      const lista = (porProdutoCor.get(chave) ?? [])
        .slice()
        .sort((a, b) => {
          const pesoDif = pesoDoCodigo(a) - pesoDoCodigo(b);
          if (pesoDif !== 0) return pesoDif;
          return a.CODIGO_BARRA.localeCompare(b.CODIGO_BARRA);
        });
      const ativos = lista.filter((l) => Number(l.INATIVO ?? 0) === 0);
      const preferidos = ativos.length > 0 ? ativos : lista;
      const codigos = preferidos.map((l) => l.CODIGO_BARRA.trim());
      const ean = codigos.find((c) => /^\d{13}$/.test(c)) ?? '';

      coresDoProduto.push({
        cor: corCrua.get(chave) ?? '',
        descCor: descPorCor.get(chave) ?? '',
        codigoBarra: codigos[0] ?? '',
        ean,
        codigos,
        estoque: estoquePorCor.get(chave) ?? 0,
      });
    }

    coresDoProduto.sort((a, b) => {
      const na = Number(a.cor);
      const nb = Number(b.cor);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return (a.cor || '').localeCompare(b.cor || '');
    });

    saida.push({
      produto,
      descProduto: (p.DESC_PRODUTO ?? '').trim(),
      grupo: (p.GRUPO ?? '').trim(),
      subgrupo: (p.SUBGRUPO ?? '').trim(),
      linha: (p.LINHA ?? '').trim(),
      colecao: (p.COLECAO ?? '').trim(),
      grade: (p.GRADE ?? '').trim(),
      tipo: (p.TIPO ?? '').trim(),
      inativo: Number(p.INATIVO ?? 0) !== 0,
      cores: coresDoProduto,
    });
  }

  return saida;
}
