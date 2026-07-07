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
 * EAN "maior": entre os códigos de barra da variação, escolhemos o mais longo
 * (EAN-13 real) e, em empate, o de maior valor — foi o pedido do dono ("aquele maior").
 */

export interface ProdutoMeta {
  produto: string;
  descProduto: string;
  grupo: string;
  linha: string;
  colecao: string;
  ean: string;
}

export interface ProdutoCorLoja {
  code: string;
  description: string;
  displayName: string;
  /** EAN da variação (produto × cor), quando existe. */
  ean: string;
}

export interface ProdutoDetalheLoja extends ProdutoMeta {
  cores: ProdutoCorLoja[];
}

/** Metadados (desc, categoria, EAN maior) de vários produtos de uma vez. */
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
        ISNULL(p.LINHA, '') AS linha,
        ISNULL(p.COLECAO, '') AS colecao,
        ISNULL(b.ean, '') AS ean
      FROM PRODUTOS p WITH (NOLOCK)
      OUTER APPLY (
        SELECT TOP 1 LTRIM(RTRIM(pb.CODIGO_BARRA)) AS ean
        FROM PRODUTOS_BARRA pb WITH (NOLOCK)
        WHERE pb.PRODUTO = p.PRODUTO
          AND LTRIM(RTRIM(ISNULL(pb.CODIGO_BARRA, ''))) <> ''
        ORDER BY LEN(LTRIM(RTRIM(pb.CODIGO_BARRA))) DESC, pb.CODIGO_BARRA DESC
      ) b
      WHERE p.PRODUTO IN (${inList})
    `;
    const result = await request.query<{
      produto: string;
      descProduto: string;
      grupo: string;
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
        ISNULL(p.LINHA, '') AS linha,
        ISNULL(p.COLECAO, '') AS colecao,
        ISNULL(b.ean, '') AS ean
      FROM PRODUTOS p WITH (NOLOCK)
      OUTER APPLY (
        SELECT TOP 1 LTRIM(RTRIM(pb.CODIGO_BARRA)) AS ean
        FROM PRODUTOS_BARRA pb WITH (NOLOCK)
        WHERE pb.PRODUTO = p.PRODUTO
          AND LTRIM(RTRIM(ISNULL(pb.CODIGO_BARRA, ''))) <> ''
        ORDER BY LEN(LTRIM(RTRIM(pb.CODIGO_BARRA))) DESC, pb.CODIGO_BARRA DESC
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
      linha: string;
      colecao: string;
      ean: string;
    }>(query);
    return result.recordset
      .map((row) => ({
        produto: String(row.produto ?? "").trim(),
        descProduto: (row.descProduto ?? "").trim(),
        grupo: (row.grupo ?? "").trim(),
        linha: (row.linha ?? "").trim(),
        colecao: (row.colecao ?? "").trim(),
        ean: (row.ean ?? "").trim(),
      }))
      .filter((r) => r.produto);
  });
}

/** EAN maior por cor (produto × COR_PRODUTO). */
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
            ORDER BY LEN(LTRIM(RTRIM(pb.CODIGO_BARRA))) DESC, pb.CODIGO_BARRA DESC
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

/** Detalhe do produto para a página da loja: metadados + cores (com EAN por cor). */
export async function fetchProdutoDetalheLoja(produto: string): Promise<ProdutoDetalheLoja | null> {
  const cod = String(produto ?? "").trim();
  if (!cod) return null;

  const [metaMap, cores, eanPorCor] = await Promise.all([
    fetchProdutosMeta([cod]),
    fetchProductAvailableColors(cod),
    fetchEanPorCor(cod),
  ]);

  const meta = metaMap.get(cod);
  if (!meta) return null;

  const coresLoja: ProdutoCorLoja[] = cores.map((c) => ({
    code: c.code,
    description: c.description,
    displayName: c.displayName,
    ean: eanPorCor.get(c.code) ?? "",
  }));

  return { ...meta, cores: coresLoja };
}
