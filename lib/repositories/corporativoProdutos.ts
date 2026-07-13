import "server-only";

import sql from "mssql";

import { withRequest } from "@/lib/db/connection";
import type { RequestLike } from "@/lib/db/proxy";
import { fetchProductAvailableColors } from "@/lib/repositories/productDetail";

/**
 * Leitura de produtos do Linx para a LOJA CORPORATIVA (só metadados de vitrine —
 * descrição, categoria, EAN, cores). Preço NÃO vem daqui: é manual no catálogo
 * (corporativo_catalogo). Fonte: PRODUTOS + PRODUTOS_BARRA + CORES_BASICAS.
 *
 * EAN "menor": entre os códigos de barra da variação, escolhemos o mais curto
 * e, em empate no tamanho, o de menor valor — pedido do dono ("aquele menor").
 * Mesma convenção de fetchMenorCodigoBarra (lib/repositories/products.ts).
 */

export interface ProdutoMeta {
  produto: string;
  descProduto: string;
  grupo: string;
  /** SUBGRUPO_PRODUTO — fonte da categoria mostrada na loja (mais específico que grupo). */
  subgrupo: string;
  linha: string;
  colecao: string;
  ean: string;
}

export interface ProdutoTamanhoLoja {
  tamanho: string;
  /** EAN da variação exata (produto × cor × tamanho). */
  ean: string;
}

export interface ProdutoCorLoja {
  code: string;
  description: string;
  displayName: string;
  /** EAN "fallback" da cor (menor entre todos os tamanhos) — usado quando o
   * produto não tem grade de tamanho ou nenhum tamanho foi selecionado ainda. */
  ean: string;
  /** Tamanhos disponíveis dessa cor, cada um com seu próprio EAN. Vazio = produto sem grade de tamanho. */
  tamanhos: ProdutoTamanhoLoja[];
}

export interface ProdutoDetalheLoja extends ProdutoMeta {
  cores: ProdutoCorLoja[];
}

/** Metadados (desc, categoria, EAN menor) de vários produtos de uma vez. */
export async function fetchProdutosMeta(produtos: string[]): Promise<Map<string, ProdutoMeta>> {
  const codes = [...new Set(produtos.map((p) => String(p ?? "").trim()).filter(Boolean))];
  const map = new Map<string, ProdutoMeta>();
  if (codes.length === 0) return map;

  return withRequest(async (request: sql.Request | RequestLike) => {
    codes.forEach((c, i) => request.input(`p${i}`, sql.VarChar, c));
    const inList = codes.map((_, i) => `@p${i}`).join(", ");
    const query = `
      SELECT
        p.PRODUTO AS produto,
        ISNULL(p.DESC_PRODUTO, '') AS descProduto,
        ISNULL(p.GRUPO_PRODUTO, '') AS grupo,
        ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo,
        ISNULL(p.LINHA, '') AS linha,
        ISNULL(p.COLECAO, '') AS colecao,
        ISNULL(b.ean, '') AS ean
      FROM PRODUTOS p WITH (NOLOCK)
      OUTER APPLY (
        SELECT TOP 1 LTRIM(RTRIM(pb.CODIGO_BARRA)) AS ean
        FROM PRODUTOS_BARRA pb WITH (NOLOCK)
        WHERE pb.PRODUTO = p.PRODUTO
          AND LTRIM(RTRIM(ISNULL(pb.CODIGO_BARRA, ''))) <> ''
        ORDER BY LEN(LTRIM(RTRIM(pb.CODIGO_BARRA))) ASC, pb.CODIGO_BARRA ASC
      ) b
      WHERE p.PRODUTO IN (${inList})
    `;
    const result = await request.query<{
      produto: string;
      descProduto: string;
      grupo: string;
      subgrupo: string;
      linha: string;
      colecao: string;
      ean: string;
    }>(query);
    for (const row of result.recordset) {
      const produto = String(row.produto ?? "").trim();
      if (!produto) continue;
      map.set(produto, {
        produto,
        descProduto: (row.descProduto ?? "").trim(),
        grupo: (row.grupo ?? "").trim(),
        subgrupo: (row.subgrupo ?? "").trim(),
        linha: (row.linha ?? "").trim(),
        colecao: (row.colecao ?? "").trim(),
        ean: (row.ean ?? "").trim(),
      });
    }
    return map;
  });
}

/** Busca produtos por código, descrição ou EAN — usado no seletor do admin. */
export async function buscarProdutos(term: string, limit = 40): Promise<ProdutoMeta[]> {
  const t = String(term ?? "").trim();
  if (t.length < 2) return [];
  const lim = Math.min(Math.max(limit, 1), 100);

  return withRequest(async (request: sql.Request | RequestLike) => {
    request.input("limit", sql.Int, lim);
    request.input("term", sql.VarChar, `%${t.toUpperCase()}%`);
    request.input("termExato", sql.VarChar, t.toUpperCase());
    const query = `
      SELECT TOP (@limit)
        p.PRODUTO AS produto,
        ISNULL(p.DESC_PRODUTO, '') AS descProduto,
        ISNULL(p.GRUPO_PRODUTO, '') AS grupo,
        ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo,
        ISNULL(p.LINHA, '') AS linha,
        ISNULL(p.COLECAO, '') AS colecao,
        ISNULL(b.ean, '') AS ean
      FROM PRODUTOS p WITH (NOLOCK)
      OUTER APPLY (
        SELECT TOP 1 LTRIM(RTRIM(pb.CODIGO_BARRA)) AS ean
        FROM PRODUTOS_BARRA pb WITH (NOLOCK)
        WHERE pb.PRODUTO = p.PRODUTO
          AND LTRIM(RTRIM(ISNULL(pb.CODIGO_BARRA, ''))) <> ''
        ORDER BY LEN(LTRIM(RTRIM(pb.CODIGO_BARRA))) ASC, pb.CODIGO_BARRA ASC
      ) b
      WHERE UPPER(p.DESC_PRODUTO) LIKE @term
        OR LTRIM(RTRIM(CAST(p.PRODUTO AS VARCHAR))) = @termExato
        OR EXISTS (
          SELECT 1 FROM PRODUTOS_BARRA pb2 WITH (NOLOCK)
          WHERE pb2.PRODUTO = p.PRODUTO AND LTRIM(RTRIM(pb2.CODIGO_BARRA)) = @termExato
        )
      ORDER BY p.DESC_PRODUTO ASC
    `;
    const result = await request.query<{
      produto: string;
      descProduto: string;
      grupo: string;
      subgrupo: string;
      linha: string;
      colecao: string;
      ean: string;
    }>(query);
    return result.recordset
      .map((row) => ({
        produto: String(row.produto ?? "").trim(),
        descProduto: (row.descProduto ?? "").trim(),
        grupo: (row.grupo ?? "").trim(),
        subgrupo: (row.subgrupo ?? "").trim(),
        linha: (row.linha ?? "").trim(),
        colecao: (row.colecao ?? "").trim(),
        ean: (row.ean ?? "").trim(),
      }))
      .filter((r) => r.produto);
  });
}

/** EAN menor por cor (produto × COR_PRODUTO). */
async function fetchEanPorCor(produto: string): Promise<Map<string, string>> {
  const cod = String(produto ?? "").trim();
  const map = new Map<string, string>();
  if (!cod) return map;
  return withRequest(async (request: sql.Request | RequestLike) => {
    request.input("produto", sql.VarChar, cod);
    const query = `
      WITH ranked AS (
        SELECT
          ISNULL(pb.COR_PRODUTO, '') AS cor,
          LTRIM(RTRIM(pb.CODIGO_BARRA)) AS ean,
          ROW_NUMBER() OVER (
            PARTITION BY ISNULL(pb.COR_PRODUTO, '')
            ORDER BY LEN(LTRIM(RTRIM(pb.CODIGO_BARRA))) ASC, pb.CODIGO_BARRA ASC
          ) AS rn
        FROM PRODUTOS_BARRA pb WITH (NOLOCK)
        WHERE pb.PRODUTO = @produto
          AND LTRIM(RTRIM(ISNULL(pb.CODIGO_BARRA, ''))) <> ''
      )
      SELECT cor, ean FROM ranked WHERE rn = 1
    `;
    const result = await request.query<{ cor: string; ean: string }>(query);
    for (const row of result.recordset) {
      map.set((row.cor ?? "").trim(), (row.ean ?? "").trim());
    }
    return map;
  });
}

/**
 * Tamanhos disponíveis por cor (produto × COR_PRODUTO × TAMANHO), cada um com
 * o EAN exato da variação. Um mesmo produto×cor pode ter várias grades (P/M/G,
 * numeração etc.) — o EAN muda a cada tamanho, não só a cada cor.
 */
async function fetchTamanhosPorCor(produto: string): Promise<Map<string, ProdutoTamanhoLoja[]>> {
  const cod = String(produto ?? "").trim();
  const map = new Map<string, ProdutoTamanhoLoja[]>();
  if (!cod) return map;
  return withRequest(async (request: sql.Request | RequestLike) => {
    request.input("produto", sql.VarChar, cod);
    const query = `
      WITH ranked AS (
        SELECT
          ISNULL(pb.COR_PRODUTO, '') AS cor,
          ISNULL(NULLIF(LTRIM(RTRIM(CONVERT(VARCHAR, pb.TAMANHO))), ''), '') AS tamanho,
          LTRIM(RTRIM(pb.CODIGO_BARRA)) AS ean,
          ROW_NUMBER() OVER (
            PARTITION BY ISNULL(pb.COR_PRODUTO, ''), ISNULL(NULLIF(LTRIM(RTRIM(CONVERT(VARCHAR, pb.TAMANHO))), ''), '')
            ORDER BY LEN(LTRIM(RTRIM(pb.CODIGO_BARRA))) ASC, pb.CODIGO_BARRA ASC
          ) AS rn
        FROM PRODUTOS_BARRA pb WITH (NOLOCK)
        WHERE pb.PRODUTO = @produto
          AND LTRIM(RTRIM(ISNULL(pb.CODIGO_BARRA, ''))) <> ''
      )
      SELECT cor, tamanho, ean FROM ranked WHERE rn = 1
    `;
    const result = await request.query<{ cor: string; tamanho: string; ean: string }>(query);
    for (const row of result.recordset) {
      const cor = (row.cor ?? "").trim();
      const tamanho = (row.tamanho ?? "").trim();
      const ean = (row.ean ?? "").trim();
      // Barra sem tamanho definido (produto sem grade) não entra na lista de tamanhos —
      // vira só o fallback via fetchEanPorCor.
      if (!tamanho) continue;
      const list = map.get(cor) ?? [];
      list.push({ tamanho, ean });
      map.set(cor, list);
    }
    for (const [cor, list] of map) {
      list.sort((a, b) => {
        const na = Number(a.tamanho);
        const nb = Number(b.tamanho);
        const aNum = a.tamanho !== "" && !Number.isNaN(na);
        const bNum = b.tamanho !== "" && !Number.isNaN(nb);
        if (aNum && bNum) return na - nb;
        if (aNum !== bNum) return aNum ? -1 : 1;
        return a.tamanho.localeCompare(b.tamanho);
      });
      map.set(cor, list);
    }
    return map;
  });
}

/** Detalhe do produto para a página da loja: metadados + cores (com EAN por cor/tamanho). */
export async function fetchProdutoDetalheLoja(produto: string): Promise<ProdutoDetalheLoja | null> {
  const cod = String(produto ?? "").trim();
  if (!cod) return null;

  const [metaMap, cores, eanPorCor, tamanhosPorCor] = await Promise.all([
    fetchProdutosMeta([cod]),
    fetchProductAvailableColors(cod),
    fetchEanPorCor(cod),
    fetchTamanhosPorCor(cod),
  ]);

  const meta = metaMap.get(cod);
  if (!meta) return null;

  const coresLoja: ProdutoCorLoja[] = cores.map((c) => ({
    code: c.code,
    description: c.description,
    displayName: c.displayName,
    ean: eanPorCor.get(c.code) ?? "",
    tamanhos: tamanhosPorCor.get(c.code) ?? [],
  }));

  return { ...meta, cores: coresLoja };
}
