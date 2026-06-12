import "server-only";

import sql from "mssql";

import { withRequest } from "@/lib/db/connection";
import type { CompanyKey } from "@/lib/config/company";
import { FILIAIS } from "@/lib/config/filial-registry";
import { nameForId } from "@/lib/server/filial-resolver";

/**
 * Entradas físicas na MATRIZ por produto+cor+dia, usadas para reconciliar contra
 * as compras em trânsito. Une as duas fontes (ESTOQUE_PROD_ENT/_PROD1_ENT e
 * LOJA_ENTRADAS/_PRODUTO, com a mesma deduplicação por romaneio+filial usada em
 * logEntradas.ts). Cor fica crua aqui — a normalização '06'/'6' acontece no util
 * de reconciliação (buildReconcileKey), fonte única dessa regra.
 */
export interface MatrizEntryRow {
  produto: string;
  corProduto: string;
  /** Dia da entrada (YYYY-MM-DD). */
  dataEntrada: string;
  /** Nº do romaneio de entrada. */
  romaneio: string;
  responsavel: string;
  qtde: number;
  custoUnitario: number;
}

/** COD_FILIAL da matriz da empresa (fonte: registry). */
export function matrizIdForCompany(company: CompanyKey): string | null {
  const def = FILIAIS.find((f) => f.company === company && f.display === "MATRIZ");
  return def?.id ?? null;
}

/** Nome vivo da matriz no banco (resolvido por COD_FILIAL, com fallback do registry). */
export async function matrizNameForCompany(company: CompanyKey): Promise<string | null> {
  const id = matrizIdForCompany(company);
  if (!id) return null;
  return nameForId(id);
}

const PRODUTO_BATCH = 500;

/**
 * Busca as entradas na matriz para um conjunto de produtos, a partir de uma data
 * de corte (YYYY-MM-DD). Agrega por produto+cor+dia, somando quantidade e tirando
 * o custo médio. Loteia a lista de produtos para não estourar o limite de params.
 */
export async function fetchMatrizEntriesByColor(
  produtos: string[],
  matrizFilialName: string,
  cutoffIso: string
): Promise<MatrizEntryRow[]> {
  const fil = (matrizFilialName || "").trim().toUpperCase();
  const cutoff = (cutoffIso || "").trim().slice(0, 10);
  const uniqueProdutos = Array.from(
    new Set((produtos || []).map((p) => (p || "").trim()).filter(Boolean))
  );
  if (!fil || !cutoff || uniqueProdutos.length === 0) return [];

  const batches: string[][] = [];
  for (let i = 0; i < uniqueProdutos.length; i += PRODUTO_BATCH) {
    batches.push(uniqueProdutos.slice(i, i + PRODUTO_BATCH));
  }

  const all: MatrizEntryRow[] = [];
  for (const batch of batches) {
    const rows = await withRequest(async (req) => {
      req.input("fil", sql.VarChar, fil);
      req.input("cutoff", sql.VarChar, cutoff);
      const prodParams = batch.map((_, i) => `@prod${i}`).join(", ");
      batch.forEach((p, i) => req.input(`prod${i}`, sql.VarChar, p));

      const query = `
        SELECT
          PRODUTO,
          COR_PRODUTO,
          DATA_ENTRADA,
          ROMANEIO,
          MAX(RESPONSAVEL) AS RESPONSAVEL,
          SUM(QTDE) AS QTDE,
          AVG(CUSTO_UNIT) AS CUSTO_UNIT
        FROM (
          SELECT
            LTRIM(RTRIM(p.PRODUTO)) AS PRODUTO,
            LTRIM(RTRIM(ISNULL(p.COR_PRODUTO, ''))) AS COR_PRODUTO,
            CONVERT(VARCHAR(10), e.EMISSAO, 120) AS DATA_ENTRADA,
            LTRIM(RTRIM(ISNULL(e.ROMANEIO_PRODUTO, ''))) AS ROMANEIO,
            LTRIM(RTRIM(ISNULL(e.RESPONSAVEL, ''))) AS RESPONSAVEL,
            ISNULL(p.QTDE, 0) AS QTDE,
            NULLIF(p.CUSTO1, 0) AS CUSTO_UNIT
          FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
          JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK)
            ON e.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
          WHERE p.PRODUTO IN (${prodParams})
            AND UPPER(LTRIM(RTRIM(ISNULL(e.FILIAL, '')))) = @fil
            AND e.EMISSAO >= @cutoff

          UNION ALL

          SELECT
            LTRIM(RTRIM(lep.PRODUTO)) AS PRODUTO,
            LTRIM(RTRIM(ISNULL(lep.COR_PRODUTO, ''))) AS COR_PRODUTO,
            CONVERT(VARCHAR(10), le.EMISSAO, 120) AS DATA_ENTRADA,
            LTRIM(RTRIM(ISNULL(le.ROMANEIO_PRODUTO, ''))) AS ROMANEIO,
            LTRIM(RTRIM(ISNULL(le.RESPONSAVEL, ''))) AS RESPONSAVEL,
            ISNULL(lep.QTDE_ENTRADA, 0) AS QTDE,
            NULLIF(lep.PRECO1, 0) AS CUSTO_UNIT
          FROM LOJA_ENTRADAS le WITH (NOLOCK)
          JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
            ON le.FILIAL = lep.FILIAL AND le.ROMANEIO_PRODUTO = lep.ROMANEIO_PRODUTO
          WHERE lep.PRODUTO IN (${prodParams})
            AND UPPER(LTRIM(RTRIM(ISNULL(le.FILIAL, '')))) = @fil
            AND le.EMISSAO >= @cutoff
            AND (le.ENTRADA_CANCELADA = 0 OR le.ENTRADA_CANCELADA IS NULL)
            AND NOT EXISTS (
              SELECT 1 FROM ESTOQUE_PROD_ENT ee WITH (NOLOCK)
              WHERE ee.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO
                AND LTRIM(RTRIM(ISNULL(ee.FILIAL, ''))) = LTRIM(RTRIM(ISNULL(le.FILIAL, '')))
            )
        ) AS unificado
        GROUP BY PRODUTO, COR_PRODUTO, DATA_ENTRADA, ROMANEIO
        ORDER BY DATA_ENTRADA ASC
      `;

      const result = await req.query<{
        PRODUTO: string;
        COR_PRODUTO: string | null;
        DATA_ENTRADA: string;
        ROMANEIO: string | null;
        RESPONSAVEL: string | null;
        QTDE: number | null;
        CUSTO_UNIT: number | null;
      }>(query);

      return result.recordset.map((row) => ({
        produto: (row.PRODUTO ?? "").toString().trim(),
        corProduto: (row.COR_PRODUTO ?? "").toString().trim(),
        dataEntrada: (row.DATA_ENTRADA ?? "").toString().trim(),
        romaneio: (row.ROMANEIO ?? "").toString().trim(),
        responsavel: (row.RESPONSAVEL ?? "").toString().trim(),
        qtde: Number(row.QTDE ?? 0),
        custoUnitario: Number(row.CUSTO_UNIT ?? 0),
      }));
    });
    all.push(...rows);
  }

  return all;
}
