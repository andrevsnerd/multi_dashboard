import sql from 'mssql';

import { VAREJO_VALUE } from '@/lib/config/company';
import { resolveCompanyLive, liveNameForIncoming } from '@/lib/server/company-live';
import { withRequest } from '@/lib/db/connection';
import { getColorDescription, normalizeColor } from '@/lib/utils/colorMapping';

export interface EntryItem {
  ROMANEIO_PRODUTO: string;
  EMISSAO: Date | string;
  FILIAL: string;
  PRODUTO: string;
  COR_PRODUTO: string | null;
  QTDE_TOTAL: number;
}

export interface ProcessedEntry {
  EMISSAO: Date | string;
  FILIAL: string;
  ROMANEIO_PRODUTO: string;
  PRODUTO: string;
  DESC_PRODUTO?: string;
  COR_PRODUTO: string | null;
  DESC_COR_PRODUTO?: string;
  QTDE_TOTAL: number;
  GRUPO_PRODUTO?: string;
  SUBGRUPO_PRODUTO?: string;
  LINHA?: string;
  COLECAO?: string;
}

/**
 * Fetches all inventory entries
 */
export async function fetchEntries(): Promise<EntryItem[]> {
  return withRequest(async (request) => {
    const query = `
      SELECT E.ROMANEIO_PRODUTO,
             E.EMISSAO,
             E.FILIAL,
             P.PRODUTO,
             P.COR_PRODUTO,
             P.QTDE AS QTDE_TOTAL
      FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
      LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) 
        ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
      WHERE P.PRODUTO IS NOT NULL
    `;

    const result = await request.query<EntryItem>(query);
    return result.recordset;
  });
}

/**
 * Builds a map of entries by product+color+branch
 * Returns a Map where the key is "product|color|branch" and the value is true if there was an entry
 * 
 * IMPORTANT: This function searches the ENTIRE HISTORY of entries, not just a specific period.
 * This is used specifically for the purple color rule to detect products that NEVER had an entry
 * in a branch, regardless of the selected date range.
 */
export async function buildEntriesMap(
  company?: string,
  filial?: string | null
): Promise<Map<string, boolean>> {
  return withRequest(async (request) => {
    const companyConfig = await resolveCompanyLive(company);
    if (!companyConfig) {
      return new Map();
    }

    // Normaliza o nome vindo do front para o nome vivo do banco (match por COD_FILIAL).
    filial = await liveNameForIncoming(filial);

    // Build branch filter
    let filialFilter = '';
    const isScarfme = company === 'scarfme';
    const filiais = companyConfig.filialFilters['inventory'] ?? [];
    const ecommerceFilials = companyConfig.ecommerceFilials ?? [];

    if (filial && filial !== VAREJO_VALUE) {
      request.input('entryFilial', sql.VarChar, filial);
      filialFilter = 'AND E.FILIAL = @entryFilial';
    } else if (isScarfme && filial === VAREJO_VALUE) {
      const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
      if (normalFiliais.length > 0) {
        normalFiliais.forEach((f, index) => {
          request.input(`entryFilial${index}`, sql.VarChar, f);
        });
        const placeholders = normalFiliais.map((_, i) => `@entryFilial${i}`).join(', ');
        filialFilter = `AND E.FILIAL IN (${placeholders})`;
      }
    } else if (isScarfme && filial === null) {
      if (filiais.length > 0) {
        filiais.forEach((f, index) => {
          request.input(`entryFilial${index}`, sql.VarChar, f);
        });
        const placeholders = filiais.map((_, i) => `@entryFilial${i}`).join(', ');
        filialFilter = `AND E.FILIAL IN (${placeholders})`;
      }
    } else {
      const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
      if (normalFiliais.length > 0) {
        normalFiliais.forEach((f, index) => {
          request.input(`entryFilial${index}`, sql.VarChar, f);
        });
        const placeholders = normalFiliais.map((_, i) => `@entryFilial${i}`).join(', ');
        filialFilter = `AND E.FILIAL IN (${placeholders})`;
      }
    }

    const query = `
      SELECT DISTINCT
        P.PRODUTO,
        P.COR_PRODUTO,
        E.FILIAL,
        ISNULL(c.DESC_COR, '') AS corBanco
      FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
      LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) 
        ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
      LEFT JOIN (
        SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
        FROM PRODUTO_CORES WITH (NOLOCK)
        GROUP BY PRODUTO, COR_PRODUTO
      ) c ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(P.PRODUTO))
         AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(P.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, P.COR_PRODUTO))
      WHERE P.PRODUTO IS NOT NULL
        ${filialFilter}
    `;

    const result = await request.query<{
      PRODUTO: string;
      COR_PRODUTO: string | null;
      FILIAL: string;
      corBanco: string;
    }>(query);

    const entriesMap = new Map<string, boolean>();

    result.recordset.forEach((row) => {
      // Normalize product code (trim and uppercase for consistency)
      const produtoNormalizado = (row.PRODUTO || '').trim().toUpperCase();
      
      // Normalize color using the same mapping used in other places
      const corNormalizada = normalizeColor(
        getColorDescription(row.COR_PRODUTO, row.corBanco)
      );
      
      // Normalize branch
      const filialNormalizada = (row.FILIAL || '').trim().toUpperCase();
      
      // Key: product|color|branch (all normalized)
      const key = `${produtoNormalizado}|${corNormalizada}|${filialNormalizada}`;
      entriesMap.set(key, true);
    });

    return entriesMap;
  });
}

/**
 * Checks if a product+color had an entry in a specific branch
 */
export function hasEntry(
  produto: string,
  cor: string,
  filial: string,
  entriesMap: Map<string, boolean>
): boolean {
  const corNormalizada = normalizeColor(cor);
  const filialNormalizada = (filial || '').trim().toUpperCase();
  const key = `${produto}|${corNormalizada}|${filialNormalizada}`;
  return entriesMap.get(key) ?? false;
}

