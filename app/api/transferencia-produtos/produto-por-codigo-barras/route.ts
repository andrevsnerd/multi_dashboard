import { NextResponse } from 'next/server';
import sql from 'mssql';

import { resolveCompany } from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';
import { PRODUTO_NOVO_LABEL } from '@/lib/repositories/produtosNovos';
import { buildProdutoLabelLookupKey, listProdutoLabelLookupKeys } from '@/lib/utils/produto-labels-store';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const codigoBarras = searchParams.get('codigoBarras');
  const company = resolveCompany(searchParams.get('company') || undefined);

  if (!codigoBarras || !codigoBarras.trim()) {
    return NextResponse.json({ data: null });
  }

  try {
    const blockedLabelKeys = company?.key
      ? await listProdutoLabelLookupKeys(company.key, PRODUTO_NOVO_LABEL)
      : null;

    const produto = await withRequest(async (req) => {
      const codigoLimpo = codigoBarras.trim();

      console.log(`[CODIGO BARRAS] Buscando: "${codigoLimpo}" (len=${codigoLimpo.length}, original="${codigoBarras}")`);

      const baseSelect = `
        SELECT DISTINCT
          pb.PRODUTO,
          p.DESC_PRODUTO,
          p.GRUPO_PRODUTO,
          p.SUBGRUPO_PRODUTO,
          p.LINHA,
          pb.COR_PRODUTO,
          pb.TAMANHO,
          pb.CODIGO_BARRA
        FROM PRODUTOS_BARRA pb WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = pb.PRODUTO
      `;
      const queryExato = `
        ${baseSelect}
        WHERE LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) = LTRIM(RTRIM(@codigoBarras))
      `;
      const queryNum = `
        ${baseSelect}
        WHERE TRY_CONVERT(BIGINT, LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))) IS NOT NULL
          AND TRY_CONVERT(BIGINT, LTRIM(RTRIM(@codigoBarras))) IS NOT NULL
          AND TRY_CONVERT(BIGINT, LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100))))) = TRY_CONVERT(BIGINT, LTRIM(RTRIM(@codigoBarras)))
      `;

      req.input('codigoBarras', sql.VarChar, codigoLimpo.trim());

      let result = await req.query<{
        PRODUTO: string;
        DESC_PRODUTO: string | null;
        GRUPO_PRODUTO: string | null;
        SUBGRUPO_PRODUTO: string | null;
        LINHA: string | null;
        COR_PRODUTO: string | null;
        TAMANHO: string | null;
        CODIGO_BARRA: string | null;
      }>(queryExato);

      if (result.recordset.length > 1) {
        console.warn(`[CODIGO BARRAS] Ambiguo (match exato, ${result.recordset.length} linhas): "${codigoLimpo}"`);
        return null;
      }

      if (result.recordset.length === 0) {
        result = await req.query(queryNum);
        if (result.recordset.length > 1) {
          console.warn(`[CODIGO BARRAS] Ambiguo (match numerico, ${result.recordset.length} linhas): "${codigoLimpo}"`);
          return null;
        }
      }

      if (result.recordset.length === 0) {
        const queryDebug = `
          SELECT TOP 10 
            pb.CODIGO_BARRA,
            LEN(pb.CODIGO_BARRA) as LEN_CODIGO,
            pb.PRODUTO,
            p.DESC_PRODUTO,
            ASCII(LEFT(pb.CODIGO_BARRA, 1)) as FIRST_CHAR_ASCII,
            ASCII(RIGHT(pb.CODIGO_BARRA, 1)) as LAST_CHAR_ASCII
          FROM PRODUTOS_BARRA pb WITH (NOLOCK)
          INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = pb.PRODUTO
          WHERE pb.CODIGO_BARRA LIKE '%' + @codigoBarras + '%'
             OR LTRIM(RTRIM(pb.CODIGO_BARRA)) LIKE '%' + LTRIM(RTRIM(@codigoBarras)) + '%'
             OR REPLACE(pb.CODIGO_BARRA, ' ', '') LIKE '%' + REPLACE(@codigoBarras, ' ', '') + '%'
          ORDER BY 
            CASE 
              WHEN pb.CODIGO_BARRA = @codigoBarras THEN 1
              WHEN LTRIM(RTRIM(pb.CODIGO_BARRA)) = LTRIM(RTRIM(@codigoBarras)) THEN 2
              WHEN REPLACE(pb.CODIGO_BARRA, ' ', '') = REPLACE(@codigoBarras, ' ', '') THEN 3
              ELSE 4
            END
        `;

        try {
          const debugResult = await req.query(queryDebug);
          if (debugResult.recordset.length > 0) {
            console.log(`[DEBUG CODIGO BARRAS] Busca exata nao encontrou: "${codigoLimpo}" (len=${codigoLimpo.length})`);
            console.log(`[DEBUG CODIGO BARRAS] Codigos similares encontrados (${debugResult.recordset.length}):`);
            debugResult.recordset.forEach((r, idx) => {
              const codigo = r.CODIGO_BARRA?.toString() || '';
              console.log(`  ${idx + 1}. Codigo: "${codigo}" (len=${r.LEN_CODIGO}) | Produto: ${r.PRODUTO} | Desc: ${r.DESC_PRODUTO?.substring(0, 30)}`);
              console.log(`     Primeiro char ASCII: ${r.FIRST_CHAR_ASCII}, Ultimo char ASCII: ${r.LAST_CHAR_ASCII}`);
            });
          } else {
            console.log(`[DEBUG CODIGO BARRAS] Nenhum codigo similar encontrado para: "${codigoLimpo}"`);
          }
        } catch (e) {
          console.error('[DEBUG CODIGO BARRAS] Erro ao fazer debug:', e);
        }

        return null;
      }

      const row = result.recordset[0];
      const produtoCodigo = row.PRODUTO?.toString().trim() || '';
      const corCodigo = row.COR_PRODUTO?.toString().trim() || '';

      if (blockedLabelKeys?.has(buildProdutoLabelLookupKey(produtoCodigo, corCodigo))) {
        return null;
      }

      return {
        produto: produtoCodigo,
        descProduto: row.DESC_PRODUTO?.toString().trim() || '',
        grupoProduto: row.GRUPO_PRODUTO?.toString().trim() || null,
        subgrupoProduto: row.SUBGRUPO_PRODUTO?.toString().trim() || null,
        linha: row.LINHA?.toString().trim() || null,
        corProduto: corCodigo || null,
        tamanho: row.TAMANHO?.toString().trim() || null,
        codigoBarra: row.CODIGO_BARRA?.toString().trim() || null,
        produtosEncontrados: result.recordset.length,
        todosProdutos: result.recordset.map((r) => ({
          produto: r.PRODUTO?.toString().trim() || '',
          cor: r.COR_PRODUTO?.toString().trim() || '(sem cor)',
          tamanho: r.TAMANHO?.toString().trim() || '(sem tamanho)',
        })),
      };
    });

    return NextResponse.json({ data: produto });
  } catch (error) {
    console.error('Erro ao buscar produto por codigo de barras', error);
    return NextResponse.json(
      { error: 'Erro ao buscar produto por codigo de barras' },
      { status: 500 }
    );
  }
}
