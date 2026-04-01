import { NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';
import sql from 'mssql';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const searchTerm = searchParams.get('q') || '';
  const filialOrigem = searchParams.get('filialOrigem');
  const corProduto = searchParams.get('corProduto'); // Para filtrar quando encontrado por código de barras
  const isEntrada = searchParams.get('entrada') === 'true';

  if (!searchTerm || searchTerm.trim().length < 2) {
    return NextResponse.json({ data: [] });
  }

  try {
    const produtos = await withRequest(async (req) => {
      const searchTermTrimmed = searchTerm.trim();
      
      // Buscar por código de barras primeiro, depois por produto/nome
      // Igual ao Python: busca código de barras, depois busca estoques do produto encontrado
      let query: string;
      
      if (corProduto) {
        // Quando tem cor (do código de barras), buscar direto por produto e cor (igual ao Python)
        // O Python mostra TODAS as filiais, não filtra por filial origem
        // Usar RTRIM para evitar falha quando PRODUTO/COR são CHAR com espaços
        query = `
          SELECT
            e.PRODUTO,
            e.COR_PRODUTO,
            e.FILIAL AS FILIAL,
            e.ESTOQUE,
            p.DESC_PRODUTO,
            ISNULL(c.DESC_COR, '') AS DESC_COR,
            e.FILIAL AS NOME_FILIAL,
            pb.CODIGO_BARRA
          FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = e.PRODUTO
          LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = e.COR_PRODUTO
          LEFT JOIN PRODUTOS_BARRA pb WITH (NOLOCK) ON pb.PRODUTO = e.PRODUTO AND pb.COR_PRODUTO = e.COR_PRODUTO
          WHERE RTRIM(LTRIM(CAST(e.PRODUTO AS VARCHAR(50)))) = RTRIM(LTRIM(@searchTerm))
            AND RTRIM(LTRIM(ISNULL(CAST(e.COR_PRODUTO AS VARCHAR(20)), ''))) = RTRIM(LTRIM(ISNULL(@corProduto, '')))
        `;
        req.input('searchTerm', sql.VarChar, searchTermTrimmed);
        req.input('corProduto', sql.VarChar, corProduto);
        // NÃO filtrar por filial quando tem corProduto - mostrar TODAS as filiais (igual ao Python)
      } else if (isEntrada) {
        // Para entrada: mostrar cores cadastradas mesmo sem estoque.
        // Regra: a origem confiável de "cores cadastradas" é `PRODUTOS_BARRA` (produto+cor),
        // e o estoque é opcional (LEFT JOIN) apenas para exibir saldo na filial selecionada.
        const searchPattern = `%${searchTermTrimmed}%`;
        query = `
          ;WITH base_produtos AS (
            SELECT DISTINCT TOP 80
              p.PRODUTO
            FROM PRODUTOS p WITH (NOLOCK)
            LEFT JOIN PRODUTOS_BARRA pb0 WITH (NOLOCK) ON pb0.PRODUTO = p.PRODUTO
            WHERE (
              p.DESC_PRODUTO LIKE @searchPattern
              OR RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))) LIKE @searchPattern
              OR LTRIM(RTRIM(CAST(pb0.CODIGO_BARRA AS VARCHAR(100)))) = LTRIM(RTRIM(@searchTermExato))
            )
          ),
          base_cores AS (
            -- cores cadastradas (prioridade)
            SELECT DISTINCT
              pb.PRODUTO,
              RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) AS COR_PRODUTO
            FROM PRODUTOS_BARRA pb WITH (NOLOCK)
            INNER JOIN base_produtos bp ON bp.PRODUTO = pb.PRODUTO
            WHERE pb.COR_PRODUTO IS NOT NULL
              AND RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) <> ''

            UNION

            -- fallback: cores que existem em estoque (mesmo zeradas)
            SELECT DISTINCT
              e.PRODUTO,
              RTRIM(LTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20)))) AS COR_PRODUTO
            FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
            INNER JOIN base_produtos bp ON bp.PRODUTO = e.PRODUTO
            WHERE e.COR_PRODUTO IS NOT NULL
              AND RTRIM(LTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20)))) <> ''
          )
          SELECT DISTINCT TOP 200
            p.PRODUTO,
            bc.COR_PRODUTO,
            ${filialOrigem ? `@filialOrigemParam` : `ISNULL(es.FILIAL, '')`} AS FILIAL,
            ISNULL(es.ESTOQUE, 0) AS ESTOQUE,
            p.DESC_PRODUTO,
            ISNULL(c.DESC_COR, '') AS DESC_COR,
            ${filialOrigem ? `@filialOrigemParam` : `ISNULL(es.FILIAL, '')`} AS NOME_FILIAL,
            pb.CODIGO_BARRA
          FROM base_produtos bp
          INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = bp.PRODUTO
          LEFT JOIN base_cores bc ON bc.PRODUTO = p.PRODUTO
          LEFT JOIN ESTOQUE_PRODUTOS es WITH (NOLOCK)
            ON es.PRODUTO = p.PRODUTO
            AND (
              (bc.COR_PRODUTO IS NULL AND es.COR_PRODUTO IS NULL)
              OR RTRIM(LTRIM(CAST(es.COR_PRODUTO AS VARCHAR(20)))) = ISNULL(bc.COR_PRODUTO, RTRIM(LTRIM(CAST(es.COR_PRODUTO AS VARCHAR(20)))))
            )
            ${filialOrigem ? `AND RTRIM(LTRIM(CAST(es.FILIAL AS VARCHAR(100)))) = RTRIM(LTRIM(@filialOrigem))` : ``}
          LEFT JOIN PRODUTOS_BARRA pb WITH (NOLOCK)
            ON pb.PRODUTO = p.PRODUTO
            AND RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) = ISNULL(bc.COR_PRODUTO, RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))))
          LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = bc.COR_PRODUTO
        `;
        req.input('searchPattern', sql.VarChar, searchPattern);
        req.input('searchTermExato', sql.VarChar, searchTermTrimmed);
        req.input('filialOrigemParam', sql.VarChar, filialOrigem?.trim() || '');
        if (filialOrigem) {
          req.input('filialOrigem', sql.VarChar, filialOrigem.trim());
        }
      } else {
        // Buscar por código de barras OU nome/código do produto
        // Usar RTRIM/LTRIM e CAST para garantir match com campos CHAR ou numéricos no banco
        const searchPattern = `%${searchTermTrimmed}%`;
        query = `
          SELECT DISTINCT TOP 50
            e.PRODUTO,
            e.COR_PRODUTO,
            e.FILIAL AS FILIAL,
            e.ESTOQUE,
            p.DESC_PRODUTO,
            ISNULL(c.DESC_COR, '') AS DESC_COR,
            e.FILIAL AS NOME_FILIAL,
            pb.CODIGO_BARRA
          FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = e.PRODUTO
          LEFT JOIN PRODUTOS_BARRA pb WITH (NOLOCK) ON pb.PRODUTO = e.PRODUTO AND pb.COR_PRODUTO = e.COR_PRODUTO
          LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = e.COR_PRODUTO
          WHERE (
            p.DESC_PRODUTO LIKE @searchPattern
            OR RTRIM(LTRIM(CAST(e.PRODUTO AS VARCHAR(50)))) LIKE @searchPattern
            OR LTRIM(RTRIM(CAST(pb.CODIGO_BARRA AS VARCHAR(100)))) = LTRIM(RTRIM(@searchTermExato))
          )
          AND e.ESTOQUE > 0
        `;
        req.input('searchPattern', sql.VarChar, searchPattern);
        req.input('searchTermExato', sql.VarChar, searchTermTrimmed);

        if (filialOrigem) {
          query += ` AND RTRIM(LTRIM(CAST(e.FILIAL AS VARCHAR(100)))) = RTRIM(LTRIM(@filialOrigem))`;
          req.input('filialOrigem', sql.VarChar, filialOrigem.trim());
        }
      }

      query += ` ORDER BY FILIAL, COR_PRODUTO`;

      console.log(`[PRODUTOS DEBUG] Query completa:`, query);
      console.log(`[PRODUTOS DEBUG] Params:`, { 
        searchTermTrimmed, 
        corProduto, 
        filialOrigem,
        searchTermLen: searchTermTrimmed.length,
        corProdutoLen: corProduto?.length
      });

      const result = await req.query<{
        PRODUTO: string;
        DESC_PRODUTO: string | null;
        CODIGO_BARRA: string | null;
        COR_PRODUTO: string | null;
        FILIAL: string | null;
        ESTOQUE: number | null;
        DESC_COR: string | null;
        NOME_FILIAL: string | null;
      }>(query);

        console.log(`[PRODUTOS DEBUG] Resultados brutos: ${result.recordset.length} linhas`);
        if (result.recordset.length > 0) {
          console.log(`[PRODUTOS DEBUG] Primeira linha:`, {
            PRODUTO: result.recordset[0].PRODUTO,
            COR_PRODUTO: result.recordset[0].COR_PRODUTO,
            FILIAL: result.recordset[0].FILIAL,
            FILIAL_LEN: result.recordset[0].FILIAL?.toString().length,
            FILIAL_TRIM: result.recordset[0].FILIAL?.toString().trim(),
            NOME_FILIAL: result.recordset[0].NOME_FILIAL,
            ESTOQUE: result.recordset[0].ESTOQUE
          });
          // Log das primeiras 5 linhas para ver padrões
          console.log(`[PRODUTOS DEBUG] Primeiras 5 linhas FILIAL:`, 
            result.recordset.slice(0, 5).map(r => ({
              FILIAL: r.FILIAL?.toString().trim(),
              NOME_FILIAL: r.NOME_FILIAL?.toString().trim() || '(null)'
            }))
          );
        }

      // Agrupar por produto e cor, somando estoques
      const produtosMap = new Map<string, {
        produto: string;
        descProduto: string;
        codigoBarra: string | null;
        corProduto: string | null;
        descCor: string;
        estoques: Array<{
          filial: string;
          nomeFilial: string;
          estoque: number;
        }>;
      }>();

      for (const row of result.recordset) {
        const produto = row.PRODUTO?.toString().trim() || '';
        const cor = row.COR_PRODUTO?.toString().trim() || '';
        const key = `${produto}::${cor}`;

        if (!produtosMap.has(key)) {
          produtosMap.set(key, {
            produto,
            descProduto: row.DESC_PRODUTO?.toString().trim() || '',
            codigoBarra: row.CODIGO_BARRA?.toString().trim() || null,
            corProduto: cor || null,
            descCor: row.DESC_COR?.toString().trim() || '',
            estoques: [],
          });
        }

        const produtoData = produtosMap.get(key)!;
        // Quando tem corProduto (do código de barras) ou é entrada, mostrar TODOS os estoques (incluindo 0)
        // Quando não tem corProduto e não é entrada, só mostrar estoques > 0
        if (row.FILIAL) {
          const estoque = row.ESTOQUE !== null ? row.ESTOQUE : 0;
          if (corProduto || isEntrada || estoque > 0) {
            // Usar COD_FILIAL se disponível, senão usar FILIAL (que deve ser o código)
            const codFilial = row.FILIAL?.toString().trim() || '';
            produtoData.estoques.push({
              filial: codFilial,
              nomeFilial: row.NOME_FILIAL?.toString().trim() || codFilial,
              estoque: estoque,
            });
          }
        }
      }

      const produtosArray = Array.from(produtosMap.values());
      console.log(`[PRODUTOS] Busca: "${searchTermTrimmed}", corProduto: ${corProduto || 'null'}, filialOrigem: ${filialOrigem || 'null'}, encontrados: ${produtosArray.length}`);
      if (produtosArray.length > 0) {
        console.log(`[PRODUTOS] Primeiro produto:`, {
          produto: produtosArray[0].produto,
          cor: produtosArray[0].corProduto,
          estoques: produtosArray[0].estoques.length
        });
      }
      return produtosArray;
    });

    return NextResponse.json({ data: produtos });
  } catch (error) {
    console.error('Erro ao buscar produtos', error);
    return NextResponse.json(
      { error: 'Erro ao buscar produtos' },
      { status: 500 }
    );
  }
}
