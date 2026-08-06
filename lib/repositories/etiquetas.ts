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

function filtroEmpresa(company: EtiquetaCompany, alias = 'p'): string {
  const codes = EMPRESA_CODES[company] ?? [];
  if (codes.length === 0) return '';
  return `AND ${alias}.EMPRESA IN (${codes.join(', ')})`;
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
}

/**
 * Sugestões enquanto o usuário digita (nome, código ou código de barra).
 *
 * Espelha a ordenação do autocomplete do Produto Detalhado — barra exata,
 * código exato, nome exato, começa com, contém — mas com guarda de permissão e
 * escopo por PRODUTOS.EMPRESA, que a rota genérica `/api/products/search` não tem.
 */
export async function buscarSugestoesProduto(
  company: EtiquetaCompany,
  termo: string,
  opts: { limite?: number; incluirInativos?: boolean } = {}
): Promise<SugestaoProduto[]> {
  const t = (termo ?? '').trim();
  if (t.length < 2) return [];

  const limite = Math.min(50, Math.max(1, opts.limite ?? 20));
  const tEsc = esc(t);
  const tUpper = esc(t.toUpperCase());
  const empresa = filtroEmpresa(company);
  const inativos = opts.incluirInativos ? '' : 'AND ISNULL(p.INATIVO, 0) = 0';

  const rows = await query<{
    PRODUTO: string;
    DESC_PRODUTO: string;
    SUBGRUPO: string;
    INATIVO: number | null;
    TOTAL_CORES: number;
    COR: string | null;
    DESC_COR: string | null;
    CODIGO: string | null;
  }>(`
    SELECT TOP ${limite}
      LTRIM(RTRIM(p.PRODUTO)) AS PRODUTO,
      LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, ''))) AS DESC_PRODUTO,
      LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, ''))) AS SUBGRUPO,
      ISNULL(p.INATIVO, 0) AS INATIVO,
      ISNULL(cores.TOTAL, 0) AS TOTAL_CORES,
      barra.COR_PRODUTO AS COR,
      cor.DESC_COR AS DESC_COR,
      barra.CODIGO_BARRA AS CODIGO
    FROM PRODUTOS p WITH (NOLOCK)
    OUTER APPLY (
      SELECT TOP 1
        LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) AS CODIGO_BARRA,
        LTRIM(RTRIM(ISNULL(CAST(pb.COR_PRODUTO AS VARCHAR(20)), ''))) AS COR_PRODUTO
      FROM PRODUTOS_BARRA pb WITH (NOLOCK)
      WHERE pb.PRODUTO = p.PRODUTO
        AND pb.CODIGO_BARRA IS NOT NULL
        AND LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) LIKE '%${tEsc}%'
      ORDER BY
        CASE WHEN LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) = '${tEsc}' THEN 0 ELSE 1 END,
        LEN(LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))),
        pb.CODIGO_BARRA
    ) barra
    OUTER APPLY (
      SELECT COUNT(DISTINCT LTRIM(RTRIM(ISNULL(CAST(pc.COR_PRODUTO AS VARCHAR(20)), '')))) AS TOTAL
      FROM PRODUTO_CORES pc WITH (NOLOCK)
      WHERE pc.PRODUTO = p.PRODUTO
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
    WHERE (
        UPPER(p.DESC_PRODUTO) LIKE '%${tUpper}%'
        OR LTRIM(RTRIM(p.PRODUTO)) LIKE '%${tEsc}%'
        OR barra.CODIGO_BARRA IS NOT NULL
      )
      ${empresa}
      ${inativos}
    ORDER BY
      CASE
        WHEN barra.CODIGO_BARRA = '${tEsc}' THEN 0
        WHEN LTRIM(RTRIM(p.PRODUTO)) = '${tEsc}' THEN 1
        WHEN UPPER(LTRIM(RTRIM(p.DESC_PRODUTO))) = '${tUpper}' THEN 2
        WHEN UPPER(p.DESC_PRODUTO) LIKE '${tUpper}%' THEN 3
        WHEN UPPER(p.DESC_PRODUTO) LIKE '% ${tUpper}%' THEN 4
        WHEN LTRIM(RTRIM(p.PRODUTO)) LIKE '${tEsc}%' THEN 5
        WHEN UPPER(p.DESC_PRODUTO) LIKE '%${tUpper}%' THEN 6
        WHEN barra.CODIGO_BARRA IS NOT NULL THEN 7
        ELSE 8
      END,
      LEN(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))),
      p.DESC_PRODUTO
  `);

  return rows.map((r) => ({
    produto: (r.PRODUTO ?? '').trim(),
    descProduto: (r.DESC_PRODUTO ?? '').trim(),
    subgrupo: (r.SUBGRUPO ?? '').trim(),
    inativo: Number(r.INATIVO ?? 0) !== 0,
    totalCores: Number(r.TOTAL_CORES) || 0,
    corEncontrada: (r.COR ?? '').trim() || null,
    descCorEncontrada: (r.DESC_COR ?? '').trim() || null,
    codigoEncontrado: (r.CODIGO ?? '').trim() || null,
  }));
}

/**
 * Busca produtos pelo termo (código, descrição ou código de barra) e monta
 * produto → cores. `limite` corta a quantidade de produtos, não de cores.
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
  const tUpper = esc(t.toUpperCase());
  const soDigitos = t.replace(/\D/g, '');
  const empresa = opts.todoCadastro ? '' : filtroEmpresa(company);
  const inativos = opts.incluirInativos ? '' : 'AND ISNULL(p.INATIVO, 0) = 0';

  // 1) Produtos que casam com o termo (código exato/prefixo, descrição ou barra).
  const produtos = await query<ProdutoRow>(`
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
    WHERE (
        LTRIM(RTRIM(p.PRODUTO)) = '${tEsc}'
        OR LTRIM(RTRIM(p.PRODUTO)) LIKE '${tEsc}%'
        OR UPPER(p.DESC_PRODUTO) LIKE '%${tUpper}%'
        ${
          soDigitos.length >= 4
            ? `OR EXISTS (
                 SELECT 1 FROM PRODUTOS_BARRA pb WITH (NOLOCK)
                 WHERE pb.PRODUTO = p.PRODUTO
                   AND (
                     LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) = '${tEsc}'
                     OR TRY_CONVERT(BIGINT, LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))) = TRY_CONVERT(BIGINT, '${esc(soDigitos)}')
                   )
               )`
            : ''
        }
      )
      ${empresa}
      ${inativos}
    ORDER BY
      CASE WHEN LTRIM(RTRIM(p.PRODUTO)) = '${tEsc}' THEN 0 ELSE 1 END,
      p.PRODUTO
  `);

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
