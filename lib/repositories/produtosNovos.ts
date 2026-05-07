import "server-only";

import sql from "mssql";

import { resolveCompany, type CompanyKey } from "@/lib/config/company";
import { withRequest } from "@/lib/db/connection";
import { syncProdutoLabelSet } from "@/lib/utils/produto-labels-store";

export const PRODUTO_NOVO_LABEL = "produto novo";
export const PRODUTOS_NOVOS_WINDOW_DAYS = 18;

export interface ProdutoNovoItem {
  produto: string;
  descricao: string;
  cor: string;
  corCodigo: string;
  linha?: string | null;
  dataCadastro: string | null;
}

interface ProdutoNovoRow {
  produto: string;
  descricao: string;
  corCodigo: string;
  cor: string;
  linha: string | null;
  dataCadastro: string | null;
}

function buildCompanyScopeFilter(request: sql.Request, company: CompanyKey): string {
  if (company === "nerd") {
    return `
      AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = 'ELETRONICOS'
    `;
  }

  const excludedLines = (resolveCompany(company)?.excludedLines ?? [])
    .map((line) => line.trim().toUpperCase())
    .filter((line) => line !== "ELETRONICOS")
    .filter(Boolean);

  excludedLines.forEach((line, index) => {
    request.input(`excludedLine${index}`, sql.VarChar, line);
  });

  const notInExcludedLine =
    excludedLines.length > 0
      ? `AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) NOT IN (${excludedLines
          .map((_, index) => `@excludedLine${index}`)
          .join(", ")})`
      : "";

  return `
    AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) <> ''
    ${notInExcludedLine}
  `;
}

export async function fetchProdutosNovosRecentes(
  company: CompanyKey
): Promise<ProdutoNovoItem[]> {
  return withRequest(async (request) => {
    request.input("windowDays", sql.Int, PRODUTOS_NOVOS_WINDOW_DAYS);

    const companyScopeFilter = buildCompanyScopeFilter(request as sql.Request, company);

    const query = `
      WITH base_produtos AS (
        SELECT
          RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))) AS produto,
          RTRIM(LTRIM(ISNULL(p.DESC_PRODUTO, ''))) AS descricao,
          p.DATA_CADASTRAMENTO AS dataCadastro
        FROM PRODUTOS p WITH (NOLOCK)
        WHERE p.DATA_CADASTRAMENTO IS NOT NULL
          AND p.DATA_CADASTRAMENTO >= DATEADD(DAY, -@windowDays, CAST(GETDATE() AS DATE))
          ${companyScopeFilter}
      )
      SELECT
        bp.produto,
        bp.descricao,
        ISNULL(color_source.corCodigo, '') AS corCodigo,
        ISNULL(c.DESC_COR, '') AS cor,
        ISNULL(p.LINHA, '') AS linha,
        CONVERT(VARCHAR(19), bp.dataCadastro, 120) AS dataCadastro
      FROM base_produtos bp
      INNER JOIN PRODUTOS p WITH (NOLOCK)
        ON RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))) = bp.produto
      OUTER APPLY (
        SELECT DISTINCT src.corCodigo
        FROM (
          SELECT RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) AS corCodigo
          FROM PRODUTOS_BARRA pb WITH (NOLOCK)
          WHERE RTRIM(LTRIM(CAST(pb.PRODUTO AS VARCHAR(50)))) = bp.produto
            AND pb.COR_PRODUTO IS NOT NULL
            AND RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) <> ''

          UNION

          SELECT RTRIM(LTRIM(CAST(pc.COR_PRODUTO AS VARCHAR(20)))) AS corCodigo
          FROM PRODUTO_CORES pc WITH (NOLOCK)
          WHERE RTRIM(LTRIM(CAST(pc.PRODUTO AS VARCHAR(50)))) = bp.produto
            AND pc.COR_PRODUTO IS NOT NULL
            AND RTRIM(LTRIM(CAST(pc.COR_PRODUTO AS VARCHAR(20)))) <> ''
        ) src

        UNION ALL

        SELECT ''
        WHERE NOT EXISTS (
          SELECT 1
          FROM (
            SELECT RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) AS corCodigo
            FROM PRODUTOS_BARRA pb WITH (NOLOCK)
            WHERE RTRIM(LTRIM(CAST(pb.PRODUTO AS VARCHAR(50)))) = bp.produto
              AND pb.COR_PRODUTO IS NOT NULL
              AND RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) <> ''

            UNION

            SELECT RTRIM(LTRIM(CAST(pc.COR_PRODUTO AS VARCHAR(20)))) AS corCodigo
            FROM PRODUTO_CORES pc WITH (NOLOCK)
            WHERE RTRIM(LTRIM(CAST(pc.PRODUTO AS VARCHAR(50)))) = bp.produto
              AND pc.COR_PRODUTO IS NOT NULL
              AND RTRIM(LTRIM(CAST(pc.COR_PRODUTO AS VARCHAR(20)))) <> ''
          ) fallback_cores
        )
      ) color_source
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK)
        ON c.COR = color_source.corCodigo
      ORDER BY bp.dataCadastro DESC, bp.produto ASC, color_source.corCodigo ASC
    `;

    const result = await request.query<ProdutoNovoRow>(query);

    return result.recordset
      .map((row) => ({
        produto: String(row.produto ?? "").trim(),
        descricao: String(row.descricao ?? "").trim(),
        corCodigo: String(row.corCodigo ?? "").trim(),
        cor: String(row.cor ?? "").trim() || "-",
        linha: String(row.linha ?? "").trim() || null,
        dataCadastro: row.dataCadastro ? String(row.dataCadastro) : null,
      }))
      .filter((row) => !(company === "scarfme" && (row.linha ?? "").toUpperCase() === "ELETRONICOS"));
  });
}

export async function syncProdutoNovoLabels(company: CompanyKey): Promise<{
  total: number;
  inserted: number;
  removed: number;
  produtos: ProdutoNovoItem[];
}> {
  const produtos = await fetchProdutosNovosRecentes(company);

  const syncResult = await syncProdutoLabelSet(
    company,
    PRODUTO_NOVO_LABEL,
    produtos.map((item) => ({
      produto: item.produto,
      cor: item.corCodigo,
    }))
  );

  return {
    ...syncResult,
    produtos,
  };
}

export async function fetchProdutosNovosPageData(company: CompanyKey): Promise<ProdutoNovoItem[]> {
  const result = await syncProdutoNovoLabels(company);
  return result.produtos;
}
